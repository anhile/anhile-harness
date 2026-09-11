#!/usr/bin/env node
/**
 * Migration runner.
 *
 * Applies every .sql file in migrations/ that is not yet recorded in the
 * schema_migrations ledger, in filename order, each inside a transaction.
 *
 * WORKING RULE (CLAUDE.md): migrations are never applied without explicit human
 * confirmation. Pending migrations therefore prompt on a TTY and refuse to run
 * non-interactively unless --yes is passed. verify.sh passes --yes because it
 * targets a database whose name ends in the configured test suffix.
 *
 * --yes is honoured only for a database whose name ends in `_test`. The flag
 * was safe because of where verify.sh pointed it, and verify.sh reads that
 * target from TEST_DATABASE_URL in .env — so a .env naming a real database
 * would have applied migrations to it with nobody asked. The name is the one
 * thing about the target this script can see, so the name is what it checks.
 * See docs/INVARIANTS.md I8.
 *
 * Usage:
 *   node scripts/migrate.mjs [--yes] [--database-url=<url>] [--status]
 */
import { readdir, readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './harness-config.mjs';
import pg from 'pg';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, '..', 'migrations');

const args = process.argv.slice(2);
const autoConfirm = args.includes('--yes');
const statusOnly = args.includes('--status');
const urlArg = args.find((a) => a.startsWith('--database-url='));
const databaseUrl = urlArg ? urlArg.slice('--database-url='.length) : process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error('migrate: no database URL. Set DATABASE_URL or pass --database-url=<url>.');
  process.exit(1);
}

/** The database name in a Postgres URL, or null when the URL does not parse. */
export function databaseName(url) {
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\/+/, '')) || null;
  } catch {
    return null;
  }
}

/**
 * --yes stands in for a human, and only a disposable database may accept it.
 *
 * The suffix comes from harness.config.json since 2026-09-11, because a project
 * naming its test databases differently would otherwise have to edit this file
 * — and editing the file that decides when a migration may run unattended is
 * exactly what should not be routine. The loader refuses a suffix short enough
 * to match a real database by accident.
 */
export function acceptsAutoConfirm(url, suffix = loadConfig().database.testSuffix) {
  const name = databaseName(url);
  return name !== null && name.endsWith(suffix);
}

if (autoConfirm && !acceptsAutoConfirm(databaseUrl)) {
  console.error(
    `migrate: refusing --yes for database "${databaseName(databaseUrl) ?? '(unparsable URL)'}".\n` +
      '         --yes stands in for a human, and only a database whose name ends in\n' +
      '         _test may take it (docs/INVARIANTS.md I8). Run interactively and\n' +
      '         answer the prompt, or point --database-url at a disposable database.',
  );
  process.exit(1);
}

const LEDGER = `
  create table if not exists schema_migrations (
    version     text primary key,
    applied_at  timestamptz not null default now()
  )
`;

async function listMigrationFiles() {
  let entries;
  try {
    entries = await readdir(migrationsDir);
  } catch {
    return [];
  }
  return entries.filter((f) => f.endsWith('.sql')).sort();
}

async function main() {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    // The ledger itself is infrastructure, not a domain migration, so it is
    // created unconditionally and needs no confirmation.
    await client.query(LEDGER);

    const files = await listMigrationFiles();
    const { rows } = await client.query('select version from schema_migrations');
    const applied = new Set(rows.map((r) => r.version));
    const pending = files.filter((f) => !applied.has(f));

    console.log(`migrate: ${files.length} migration file(s), ${applied.size} applied, ${pending.length} pending`);

    if (statusOnly) {
      for (const file of files) {
        console.log(`  ${applied.has(file) ? 'applied ' : 'PENDING '} ${file}`);
      }
      return;
    }

    if (pending.length === 0) {
      console.log('migrate: nothing to do.');
      return;
    }

    console.log('migrate: the following migrations will be applied:');
    for (const file of pending) console.log(`  - ${file}`);
    console.log(`migrate: target database: ${redact(databaseUrl)}`);

    if (!autoConfirm) {
      if (!process.stdin.isTTY) {
        console.error(
          'migrate: refusing to apply migrations without confirmation.\n' +
            '         Re-run interactively, or pass --yes if this is a disposable database.',
        );
        process.exit(1);
      }
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const answer = (await rl.question('Apply these migrations? [y/N] ')).trim().toLowerCase();
      rl.close();
      if (answer !== 'y' && answer !== 'yes') {
        console.error('migrate: aborted by user. No changes made.');
        process.exit(1);
      }
    }

    for (const file of pending) {
      const sql = await readFile(path.join(migrationsDir, file), 'utf8');
      console.log(`migrate: applying ${file}`);
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query('insert into schema_migrations (version) values ($1)', [file]);
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        console.error(`migrate: FAILED on ${file}, rolled back.`);
        throw error;
      }
    }

    console.log(`migrate: applied ${pending.length} migration(s).`);
  } finally {
    await client.end();
  }
}

function redact(url) {
  return url.replace(/\/\/([^:]+):[^@]+@/, '//$1:***@');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`migrate: ${error.message}`);
    process.exit(1);
  });
}
