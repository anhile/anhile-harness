#!/usr/bin/env node
/**
 * Guard for migrations/.
 *
 * docs/INVARIANTS.md I8: a `.sql` file that has been applied anywhere is never
 * edited; a schema change is a new file. Until now that was a review gate, and
 * a weak one — the `schema_migrations` ledger makes re-running an applied
 * migration a no-op, so an edit to one changes nothing and fails nothing. It
 * would simply be wrong on every database that had already run it.
 *
 * The ledger lives in a database this cannot see, so "applied" is not
 * observable here. "Committed" is, and it is the honest proxy: a migration is
 * authored once, committed, and frozen from then on. Iterating on a new file
 * before its first commit stays free.
 *
 * Same shape as the feature_list.json guard, deliberately. Adding a file is
 * always fine; changing or removing one that the baseline already has is not.
 *
 * Usage:
 *   node scripts/check-migrations.mjs [--base <ref>] [--at <ref>]
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from './harness-config.mjs';
import { fileURLToPath } from 'node:url';

const root = realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
const DIR = loadConfig().migrations.directory;

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const base = flag('base', 'HEAD');
const at = flag('at');

const problems = [];
const notes = [];
const digest = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16);

/** The `.sql` files and their digests, either at a commit or on disk. */
function readTree(ref) {
  const files = {};
  if (ref) {
    let listing;
    try {
      listing = execFileSync('git', ['ls-tree', '--name-only', `${ref}:${DIR}`], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      // The directory did not exist at that commit.
      return null;
    }
    for (const name of listing.split('\n').filter((n) => n.endsWith('.sql'))) {
      files[name] = digest(
        execFileSync('git', ['show', `${ref}:${DIR}/${name}`], { cwd: root, encoding: 'utf8' }),
      );
    }
    return files;
  }
  for (const name of readdirSync(path.join(root, DIR))) {
    if (!name.endsWith('.sql')) continue;
    files[name] = digest(readFileSync(path.join(root, DIR, name), 'utf8'));
  }
  return files;
}

const current = readTree(at) ?? {};
const baseline = readTree(base);

if (baseline === null) {
  notes.push(`no baseline at ${base} — every migration here is new`);
} else {
  for (const [name, hash] of Object.entries(baseline)) {
    if (current[name] === undefined) {
      problems.push(
        `${name} was removed. An applied migration is never deleted — the ledger ` +
          'still records it, and every database that ran it keeps the change.',
      );
    } else if (current[name] !== hash) {
      problems.push(
        `${name} was edited (${hash} -> ${current[name]}). An applied migration is ` +
          'immutable; a schema change is a new file. See docs/INVARIANTS.md I8.',
      );
    }
  }
  const added = Object.keys(current).filter((name) => baseline[name] === undefined);
  if (added.length > 0) notes.push(`${added.length} new migration(s): ${added.join(', ')}`);
}

console.log(`check-migrations: ${Object.keys(current).length} migration(s), baseline ${base}`);
for (const note of notes) console.log(`  note: ${note}`);

if (problems.length > 0) {
  console.error(`check-migrations: ${problems.length} problem(s)`);
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error(
    '\n  Migrations are append-only once committed. Add a new .sql file rather than\n' +
      '  changing one that already exists.',
  );
  process.exit(1);
}
console.log('check-migrations: ok');
