import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import type { PoolClient } from 'pg';
import dotenv from 'dotenv';

// Load .env from current directory or parent directory
dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const PENDING_MIGRATION_MARKER = '-- praxis:pending';
const PENDING_MARKER_SCAN_BYTES = 200;

type MigrationClient = Pick<PoolClient, 'query'>;
type MigrationOutcome = 'applied' | 'already-applied' | 'skipped-pending';

export async function applyMigrationFile(
  client: MigrationClient,
  migrationDirectory: string,
  filename: string,
  log: (message: string) => void = (message) => process.stdout.write(message),
): Promise<MigrationOutcome> {
  const contents = await readFile(resolve(migrationDirectory, filename));
  const header = contents
    .subarray(0, PENDING_MARKER_SCAN_BYTES)
    .toString('utf8');

  if (header.includes(PENDING_MIGRATION_MARKER)) {
    log(`Skipped pending migration ${filename}\n`);
    return 'skipped-pending';
  }

  const sql = contents.toString('utf8');
  const checksum = createHash('sha256').update(sql).digest('hex');
  const existing = await client.query<{ checksum: string }>(
    'SELECT checksum FROM praxis.schema_migrations WHERE filename = $1',
    [filename],
  );

  if (existing.rowCount) {
    const appliedMigration = existing.rows[0];
    if (!appliedMigration) {
      throw new Error(`Migration registry returned no row: ${filename}`);
    }
    if (appliedMigration.checksum !== checksum) {
      throw new Error(`Migration checksum changed: ${filename}`);
    }
    return 'already-applied';
  }

  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query(
      'INSERT INTO praxis.schema_migrations (filename, checksum) VALUES ($1, $2)',
      [filename, checksum],
    );
    await client.query('COMMIT');
    log(`Applied ${filename}\n`);
    return 'applied';
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

export async function runMigrations(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('Set DATABASE_URL to the standalone database before migrating');

  const migrationDirectory = resolve(__dirname, 'migrations');
  const pool = new Pool({
    connectionString,
    max: 1,
    ssl:
      process.env.DATABASE_SSL === 'true'
        ? { rejectUnauthorized: true }
        : undefined,
  });
  const client = await pool.connect();

  try {
    await client.query('SELECT pg_advisory_lock($1)', [801_425_119]);
    await client.query('CREATE SCHEMA IF NOT EXISTS praxis');
    await client.query(`
      CREATE TABLE IF NOT EXISTS praxis.schema_migrations (
        filename text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const files = (await readdir(migrationDirectory))
      .filter((file) => file.endsWith('.sql'))
      .sort();

    console.log(`Checking ${files.length} migrations in ${migrationDirectory}...`);
    let appliedCount = 0;
    for (const filename of files) {
      const outcome = await applyMigrationFile(client, migrationDirectory, filename);
      if (outcome === 'applied') appliedCount++;
    }
    console.log(`Migration run complete: ${appliedCount} applied, ${files.length - appliedCount} up-to-date.`);
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [801_425_119]);
    client.release();
    await pool.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runMigrations().catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
  });
}
