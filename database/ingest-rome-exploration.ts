// Loads the ROME v61 exploration files (migration 059) into the ROME release
// already in the database: mobility, RIASEC, centres d'intérêt, activity
// sectors and job texts.
//
// The archive must be the one that release was built from: its SHA-256 is
// checked against the checksum recorded at the original ROME ingest. Each
// file's checksum is recorded in source_release_supplements, and re-running
// only re-verifies.
//
// Usage: npm run rome:exploration -- --source-zip path/to/RefRomeCsv.zip

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';
import { unzipSync } from 'fflate';
import { Pool } from 'pg';
import type { PoolClient } from 'pg';

import {
  EXPLORATION_FILES,
  buildExplorationRows,
  type ExplorationFileKind,
  type ExplorationRows,
} from '../src/exploration/rome-exploration-source.js';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOADER_VERSION = 'praxis-rome-exploration-ingest-v1';

type Options = { version: string; language: string; sourceZip: string };

export function parseArguments(argv: readonly string[]): Options {
  const options: Options = {
    version: '61',
    language: 'fr',
    sourceZip: '',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') continue;
    if (!argument || !['--version', '--language', '--source-zip'].includes(argument)) {
      throw new Error(`Unknown argument: ${argument}`);
    }
    const value = argv[++index];
    if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value`);
    if (argument === '--version') options.version = value;
    if (argument === '--language') options.language = value;
    if (argument === '--source-zip') options.sourceZip = resolve(process.cwd(), value);
  }
  if (!options.sourceZip) throw new Error('--source-zip is required');
  return options;
}

function sha256(buffer: Uint8Array): string {
  return createHash('sha256').update(buffer).digest('hex');
}

type LoadedCounts = Record<keyof ExplorationRows, number>;

async function countLoaded(client: PoolClient, releaseId: string): Promise<LoadedCounts> {
  const result = await client.query<LoadedCounts>(
    `SELECT
      (SELECT count(*)::integer FROM praxis.rome_mobility WHERE release_id=$1) AS mobility,
      (SELECT count(*)::integer FROM praxis.rome_occupation_riasec WHERE release_id=$1) AS "occupationRiasec",
      (SELECT count(*)::integer FROM praxis.rome_macro_competence_riasec WHERE release_id=$1) AS "macroRiasec",
      (SELECT count(*)::integer FROM praxis.rome_interest_centre_versions WHERE release_id=$1) AS centres,
      (SELECT count(*)::integer FROM praxis.rome_occupation_interest_centres WHERE release_id=$1) AS "centreLinks",
      (SELECT count(*)::integer FROM praxis.rome_activity_sector_versions WHERE release_id=$1) AS sectors,
      (SELECT count(*)::integer FROM praxis.rome_occupation_activity_sectors WHERE release_id=$1) AS "sectorLinks",
      (SELECT count(*)::integer FROM praxis.rome_occupation_texts WHERE release_id=$1) AS texts`,
    [releaseId],
  );
  const counts = result.rows[0];
  if (!counts) throw new Error('Count query returned no row');
  return counts;
}

function assertCounts(loaded: LoadedCounts, rows: ExplorationRows) {
  for (const name of Object.keys(rows) as (keyof ExplorationRows)[]) {
    if (loaded[name] !== rows[name].length) {
      throw new Error(`${name}: source has ${rows[name].length} rows, database has ${loaded[name]}`);
    }
  }
}

async function insertRows(client: PoolClient, releaseId: string, rows: ExplorationRows) {
  await client.query(
    `INSERT INTO praxis.rome_mobility (release_id, code_rome, target_code_rome, display_order)
     SELECT $1, source, target, display_order
     FROM unnest($2::text[], $3::text[], $4::smallint[]) AS t(source, target, display_order)`,
    [releaseId, rows.mobility.map((r) => r.source), rows.mobility.map((r) => r.target), rows.mobility.map((r) => r.order)],
  );
  await client.query(
    `INSERT INTO praxis.rome_occupation_riasec (release_id, code_rome, riasec_major, riasec_minor)
     SELECT $1, code, major, minor FROM unnest($2::text[], $3::text[], $4::text[]) AS t(code, major, minor)`,
    [releaseId, rows.occupationRiasec.map((r) => r.code), rows.occupationRiasec.map((r) => r.major), rows.occupationRiasec.map((r) => r.minor)],
  );
  await client.query(
    `INSERT INTO praxis.rome_macro_competence_riasec (release_id, code_ogr, riasec_major, riasec_minor)
     SELECT $1, ogr, major, minor FROM unnest($2::bigint[], $3::text[], $4::text[]) AS t(ogr, major, minor)`,
    [releaseId, rows.macroRiasec.map((r) => r.ogr), rows.macroRiasec.map((r) => r.major), rows.macroRiasec.map((r) => r.minor)],
  );
  await client.query(
    `INSERT INTO praxis.rome_interest_centres (centre_code, first_seen_release_id)
     SELECT code, $1 FROM unnest($2::integer[]) AS t(code) ON CONFLICT DO NOTHING`,
    [releaseId, rows.centres.map((r) => r.code)],
  );
  await client.query(
    `INSERT INTO praxis.rome_interest_centre_versions (release_id, centre_code, label, definition)
     SELECT $1, code, label, definition FROM unnest($2::integer[], $3::text[], $4::text[]) AS t(code, label, definition)`,
    [releaseId, rows.centres.map((r) => r.code), rows.centres.map((r) => r.label), rows.centres.map((r) => r.definition)],
  );
  await client.query(
    `INSERT INTO praxis.rome_occupation_interest_centres (release_id, centre_code, code_rome, is_principal)
     SELECT $1, centre, code, principal FROM unnest($2::integer[], $3::text[], $4::boolean[]) AS t(centre, code, principal)`,
    [releaseId, rows.centreLinks.map((r) => r.centre), rows.centreLinks.map((r) => r.code), rows.centreLinks.map((r) => r.principal)],
  );
  // Every code first, so a sub-sector's parent exists when its version lands.
  await client.query(
    `INSERT INTO praxis.rome_activity_sectors (sector_code, first_seen_release_id)
     SELECT code, $1 FROM unnest($2::integer[]) AS t(code) ON CONFLICT DO NOTHING`,
    [releaseId, rows.sectors.map((r) => r.code)],
  );
  await client.query(
    `INSERT INTO praxis.rome_activity_sector_versions (release_id, sector_code, label, definition, parent_sector_code)
     SELECT $1, code, label, definition, parent
     FROM unnest($2::integer[], $3::text[], $4::text[], $5::integer[]) AS t(code, label, definition, parent)`,
    [releaseId, rows.sectors.map((r) => r.code), rows.sectors.map((r) => r.label), rows.sectors.map((r) => r.definition), rows.sectors.map((r) => r.parent)],
  );
  await client.query(
    `INSERT INTO praxis.rome_occupation_activity_sectors (release_id, sector_code, code_rome, is_principal)
     SELECT $1, sector, code, principal FROM unnest($2::integer[], $3::text[], $4::boolean[]) AS t(sector, code, principal)`,
    [releaseId, rows.sectorLinks.map((r) => r.sector), rows.sectorLinks.map((r) => r.code), rows.sectorLinks.map((r) => r.principal)],
  );
  await client.query(
    `INSERT INTO praxis.rome_occupation_texts (release_id, code_rome, text_kind, position, composition_bloc_code, sentence)
     SELECT $1, code, kind, position, bloc, sentence
     FROM unnest($2::text[], $3::text[], $4::smallint[], $5::text[], $6::text[]) AS t(code, kind, position, bloc, sentence)`,
    [releaseId, rows.texts.map((r) => r.code), rows.texts.map((r) => r.kind), rows.texts.map((r) => r.position), rows.texts.map((r) => r.bloc), rows.texts.map((r) => r.sentence)],
  );
}

export async function ingestRomeExploration(options: Options): Promise<LoadedCounts> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('Set DATABASE_URL to the standalone database before loading ROME');
  const zip = await readFile(options.sourceZip);
  const zipChecksum = sha256(zip);
  const archive = unzipSync(new Uint8Array(zip));
  const files = {} as Record<ExplorationFileKind, { file: string; checksum: string }>;
  const texts = {} as Record<ExplorationFileKind, string>;
  for (const kind of Object.keys(EXPLORATION_FILES) as ExplorationFileKind[]) {
    const { file } = EXPLORATION_FILES[kind];
    const content = archive[file];
    if (!content) throw new Error(`Missing ${file} in ${options.sourceZip}`);
    files[kind] = { file, checksum: sha256(content) };
    texts[kind] = new TextDecoder('utf-8', { fatal: true }).decode(content);
  }
  const { rows, fileRecords } = buildExplorationRows(texts);

  const pool = new Pool({ connectionString, max: 1 });
  const client = await pool.connect();
  try {
    const release = await client.query<{ id: string; zip_checksum: string | null }>(
      `SELECT id, source_checksums->>$3 AS zip_checksum FROM praxis.source_releases
       WHERE source='rome' AND version=$1 AND language=$2`,
      [options.version, options.language, basename(options.sourceZip)],
    );
    const releaseRow = release.rows[0];
    if (!releaseRow) {
      throw new Error(`ROME release ${options.version}/${options.language} is not loaded`);
    }
    if (releaseRow.zip_checksum !== zipChecksum) {
      throw new Error('This archive is not the one the ROME release was built from (checksum mismatch)');
    }
    const releaseId = releaseRow.id;

    const supplements = await client.query<{ file_name: string; file_sha256: string }>(
      'SELECT file_name, file_sha256 FROM praxis.source_release_supplements WHERE release_id=$1',
      [releaseId],
    );
    if (supplements.rowCount) {
      for (const { file, checksum } of Object.values(files)) {
        const recorded = supplements.rows.find((row) => row.file_name === file);
        if (!recorded || recorded.file_sha256 !== checksum) {
          throw new Error(`${file}: recorded supplement differs from the archive; source rows are immutable`);
        }
      }
      const loaded = await countLoaded(client, releaseId);
      assertCounts(loaded, rows);
      console.table(Object.entries(loaded).map(([table, count]) => ({ table, rows: count })));
      return loaded;
    }

    await client.query('BEGIN');
    try {
      await insertRows(client, releaseId, rows);
      for (const kind of Object.keys(files) as ExplorationFileKind[]) {
        await client.query(
          `INSERT INTO praxis.source_release_supplements (release_id, file_name, file_sha256, row_count, loader_version)
           VALUES ($1, $2, $3, $4, $5)`,
          [releaseId, files[kind].file, files[kind].checksum, fileRecords[kind], LOADER_VERSION],
        );
      }
      const loaded = await countLoaded(client, releaseId);
      assertCounts(loaded, rows);
      await client.query('COMMIT');
      console.table(Object.entries(loaded).map(([table, count]) => ({ table, rows: count })));
      return loaded;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  } finally {
    client.release();
    await pool.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  ingestRomeExploration(parseArguments(process.argv.slice(2))).catch((error: unknown) => {
    console.error('ROME exploration ingest failed:', error);
    process.exit(1);
  });
}
