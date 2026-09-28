import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PDFDocument} from 'pdf-lib';
import pg from 'pg';
import {createLearnerServer} from '../learner/server.mjs';
import {seedDevelopmentActivities,enableDevelopmentPilots} from '../database/development-activities.mjs';

async function poolForTest(){assert.ok(process.env.PRAXIS_LEARNER_TEST_DATABASE_URL,'Dedicated test DB required');const p=new pg.Pool({connectionString:process.env.PRAXIS_LEARNER_TEST_DATABASE_URL});assert.match((await p.query('select current_database() as name')).rows[0].name,/_test$/);return p;}

test('report migration works before occupations or learner data are loaded',async()=>{
 const p=await poolForTest(),c=await p.connect();try{await c.query('BEGIN');await c.query('CREATE SCHEMA report_migration_probe;CREATE TABLE report_migration_probe.learner(id uuid PRIMARY KEY)');
  const sql=await readFile(new URL('../database/migrations/069_career_reports.sql',import.meta.url),'utf8');await c.query(sql.replaceAll('praxis.','report_migration_probe.'));
  assert.equal((await c.query('select count(*)::int as n from report_migration_probe.career_report')).rows[0].n,0);
 }finally{await c.query('ROLLBACK');c.release();await p.end();}
});

test('report HTTP captures every scoped candidate and skill, renders the same saved facts in HTML/PDF, and isolates sessions',async()=>{
 const pool=await poolForTest();await enableDevelopmentPilots(pool,await seedDevelopmentActivities(pool));
 const server=createLearnerServer({pool,example:true});await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port,sessions=[];
 try{
  const session=async()=>{const r=await fetch(origin+'/api/bootstrap'),s={cookie:r.headers.get('set-cookie').split(';')[0],data:await r.json()};sessions.push(s);return s;};
  const first=await session(),other=await session();
  const post=(s,path,body,extra={})=>fetch(origin+path,{method:'POST',headers:{Origin:origin,Cookie:s.cookie,'Content-Type':'application/json','X-Praxis-CSRF':s.data.csrf,...extra},body:JSON.stringify(body)});
  const get=(s,path)=>fetch(origin+path,{headers:{Cookie:s.cookie}});
  for(const s of sessions){assert.equal((await post(s,'/api/profile',{currentRomeCode:'C1302',preferredDomainCode:'C13',confirmedInterestCodes:[]})).status,200);await post(s,'/api/career/preferences',{marketCode:'FR',trackCode:null});}
  const exploration=await (await post(first,'/api/explore',{})).json(),catalog=exploration.possibilities.filter(c=>c.romeCode);
  const selected=['C1301','C1302'];const call=()=>post(first,'/api/reports',{targetCodes:selected});const [a,b]=await Promise.all([call(),call()]);assert.equal(a.status,200,await a.clone().text());assert.equal(b.status,200,await b.clone().text());
  const report=await a.json(),duplicate=await b.json();assert.equal(report.id,duplicate.id);assert.equal(report.snapshot.candidates.length,catalog.length);
  for(const candidate of catalog){const inReport=report.snapshot.candidates.find(x=>x.code===candidate.romeCode);assert.ok(inReport);assert.equal(inReport.requirements.length,candidate.requirements.length);assert.deepEqual(inReport.requirements.map(x=>x.label),candidate.requirements.map(x=>x.label));assert.ok(inReport.domains.some(d=>d.code==='C13'));}
  assert.deepEqual(report.snapshot.targets.map(t=>t.code),selected);assert.ok(report.snapshot.targets.every(t=>t.plan.readiness==='not_assessed'&&t.plan.masteryEstablished===false));
  assert.ok(report.snapshot.targets.every(t=>!t.plan.gaps.some(g=>g.kind==='career_level')),'real framework drafts stay hidden');
  assert.equal((await post(first,'/api/reports',{targetCodes:[]})).status,400);assert.equal((await post(first,'/api/reports',{targetCodes:['C1302','C1302']})).status,400);
  assert.equal((await post(first,'/api/reports',{targetCodes:['C1207']})).status,404);assert.equal((await post(first,'/api/reports',{targetCodes:selected,learnerId:randomUUID()})).status,400);
  assert.equal((await post(first,'/api/reports',{targetCodes:selected},{'X-Praxis-CSRF':'bad'})).status,403);
  assert.equal((await get(other,'/api/reports/'+report.id)).status,404);assert.equal((await get(other,'/reports/'+report.id)).status,404);assert.equal((await get(other,'/api/reports/'+report.id+'/pdf')).status,404);
  const rendered=await get(first,'/reports/'+report.id);assert.equal(rendered.status,200);const html=await rendered.text();assert.ok(html.includes('Annexe complète'));for(const c of report.snapshot.candidates)assert.ok(html.includes(c.title.replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]))));assert.ok(html.includes('Aucun référentiel de niveaux revu'));
  const pdfResponse=await get(first,'/api/reports/'+report.id+'/pdf');assert.equal(pdfResponse.status,200,await pdfResponse.clone().text().then(t=>t.slice(0,200)));assert.match(pdfResponse.headers.get('content-type'),/application\/pdf/);
  const bytes=new Uint8Array(await pdfResponse.arrayBuffer()),pdf=await PDFDocument.load(bytes);assert.ok(bytes.length>10000);assert.ok(pdf.getPageCount()>2);assert.match(pdf.getSubject(),new RegExp(report.contentHash));
  const verify=await post(first,'/api/reports/verify',{reportId:report.id});assert.equal(verify.status,200);assert.equal((await verify.json()).verified,true);
  const before=report.snapshot.candidates.length;await post(first,'/api/career/preferences',{marketCode:'MA',trackCode:null});await post(first,'/api/profile',{currentRomeCode:'C1202',preferredDomainCode:'C12',confirmedInterestCodes:[]});
  assert.equal((await get(first,'/api/reports/'+report.id)).status,200);assert.equal((await (await get(first,'/api/reports/'+report.id)).json()).snapshot.candidates.length,before);
  assert.ok(!(await (await post(first,'/api/reports',{targetCodes:['C1202']})).json()).snapshot.candidates.some(c=>c.domains.some(d=>d.code==='C13')));
  const history=await (await get(first,'/api/reports/history')).json();assert.equal(history.reports.length,2);assert.equal((await get(other,'/api/reports/history')).status,200);assert.equal((await (await get(other,'/api/reports/history')).json()).reports.length,0);
  const client=await pool.connect();try{await client.query('BEGIN');await assert.rejects(()=>client.query('UPDATE praxis.career_report SET content_hash=$2 WHERE id=$1',[report.id,'a'.repeat(64)]),/immutable/);await client.query('ROLLBACK');}finally{client.release();}
 }finally{
  await new Promise(r=>server.close(r));for(const s of sessions){const key=createHash('sha256').update(s.cookie.split('=')[1]).digest('hex');const owner=(await pool.query('SELECT learner_id FROM praxis.learner_session WHERE session_key=$1',[key])).rows[0]?.learner_id;
   if(owner){await pool.query('DELETE FROM praxis.learner WHERE id=$1',[owner]);assert.equal((await pool.query('select count(*)::int as n from praxis.career_report where learner_id=$1',[owner])).rows[0].n,0);}}
  await pool.end();
 }
});
