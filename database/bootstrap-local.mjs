import {readFile,readdir} from 'node:fs/promises';
import pg from 'pg';
import {applyMigrationFile} from './migrate.ts';
import {fileURLToPath} from 'node:url';

// Test/preview setup only. Production taxonomy ingestion is a separate operation.
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:1}),client=await pool.connect();
try{
 const info=await client.query('SELECT current_database() AS name');
 if(!info.rows[0].name.endsWith('_test'))throw new Error('Local bootstrap requires a dedicated database ending in _test');
 await client.query('CREATE SCHEMA IF NOT EXISTS praxis');
 await client.query('CREATE TABLE IF NOT EXISTS praxis.schema_migrations(filename text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())');
 const directory=fileURLToPath(new URL('./migrations/',import.meta.url)),files=(await readdir(directory)).filter(f=>f.endsWith('.sql')).sort();
 for(const file of files.filter(f=>Number(f.slice(0,3))<=28))await applyMigrationFile(client,directory,file);
 const prerequisites=JSON.parse(await readFile(new URL('./local-esco-prerequisites.json',import.meta.url),'utf8'));
 const manifest=JSON.stringify({'official-rdf-archive':prerequisites.archiveSha256});
 await client.query(`INSERT INTO praxis.source_releases(source,version,language,source_uri,source_checksum,source_checksums,license_name,is_active)
   VALUES ('esco','ESCO-1.2.0-local-role-prerequisites','fr','https://esco.ec.europa.eu/en/classification',$1,$2::jsonb,'European Commission ESCO terms',false)
   ON CONFLICT(source,version,language) DO NOTHING`,[prerequisites.archiveSha256,manifest]);
 const canonical=await client.query("SELECT id FROM praxis.source_releases WHERE source='esco' AND version='ESCO-1.2.0-local-role-prerequisites' AND language='fr'");
 const release=await client.query(`INSERT INTO praxis.esco_releases(version,language,source_uri,source_checksum,source_checksums,is_active,source_release_id)
   VALUES ('ESCO-1.2.0-local-role-prerequisites','fr','https://esco.ec.europa.eu/en/classification',$1,$2::jsonb,false,$3)
   ON CONFLICT(version,language) DO UPDATE SET source_uri=EXCLUDED.source_uri RETURNING id`,[prerequisites.archiveSha256,manifest,canonical.rows[0].id]);
 for(const concept of prerequisites.concepts){
  if(concept.type==='skill'){
   await client.query('INSERT INTO praxis.esco_skills(concept_uri,concept_id,first_seen_release_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',[concept.uri,concept.uri.split('/').at(-1),release.rows[0].id]);
   await client.query(`INSERT INTO praxis.esco_skill_versions(skill_uri,release_id,preferred_label,source_payload,language)
    VALUES ($1,$2,$3,$4::jsonb,'fr') ON CONFLICT DO NOTHING`,[concept.uri,release.rows[0].id,concept.labels.fr,JSON.stringify(concept)]);
   await client.query(`INSERT INTO praxis.skill(id,label_fr,label_en,esco_skill_uri,status,esco_mapping_status,esco_mapping_note)
    VALUES ($1,$2,$3,$4,'published','anchored','Verified from local official ESCO 1.2.0 RDF archive') ON CONFLICT DO NOTHING`,['skill_esco_'+concept.uri.split('/').at(-1).replaceAll('-',''),concept.labels.fr,concept.labels.en??null,concept.uri]);
   continue;
  }
  await client.query('INSERT INTO praxis.esco_occupations(concept_uri,concept_id,first_seen_release_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',[concept.uri,concept.uri.split('/').at(-1),release.rows[0].id]);
  await client.query(`INSERT INTO praxis.esco_occupation_versions(occupation_uri,release_id,preferred_label,source_payload,language)
    VALUES ($1,$2,$3,$4::jsonb,'fr') ON CONFLICT DO NOTHING`,[concept.uri,release.rows[0].id,concept.labels.fr,JSON.stringify({importScope:'local-role-prerequisites-only',archiveSha256:prerequisites.archiveSha256,concept})]);
 }
 const analyst=prerequisites.concepts.find(c=>c.uri.endsWith('d3edb8f8-3a06-47a0-8fb9-9b212c006aa2'));
 await client.query(`INSERT INTO praxis.occupation(id,label_fr,esco_occupation_uri,sector_code,status,esco_mapping_status,esco_mapping_note)
   VALUES ('occupation_esco_d3edb8f83a0647a08fb99b212c006aa2',$1,$2,'digital_it_telecom','published','anchored','Verified from local official ESCO 1.2.0 RDF archive') ON CONFLICT DO NOTHING`,[analyst.labels.fr,analyst.uri]);
 for(const file of files.filter(f=>Number(f.slice(0,3))>28))await applyMigrationFile(client,directory,file);
 console.log('Full local schema verified; partial ESCO import is intentionally not an active complete release.');
}finally{client.release();await pool.end();}
