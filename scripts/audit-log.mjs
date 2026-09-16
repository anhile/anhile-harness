#!/usr/bin/env node
// @ts-check
/**
 * The record of audits: one file per verdict, under `audit-log/`, tracked.
 *
 * `.generated/audit.json` is the receipt `/verify-task` writes and the commit
 * gate reads before a closing commit. It is git-ignored and overwritten by
 * the next audit, so the moment a closing commit lands, nothing on record
 * says an auditor ever looked: the READY that let the flip through survived
 * only in a session's transcript. The review of 0.1.0 wrote that down as a
 * debt — "audit receipts that no log keeps".
 *
 * This is the log. `audit-receipt.mjs write` appends here as well as writing
 * the receipt, one file per audit named after the moment it was written,
 * carrying the same fields: the contract, the verdict, the security line,
 * the tree it was about, the evidence folder and the commit it was based on.
 * A file is never edited and never removed; NOT_READY and CANNOT_VERIFY are
 * recorded too, because a log of only the READY verdicts is a highlight reel.
 *
 * Two things follow. The commit gate runs `check` before every commit, as it
 * runs verify-log's, since the directory is outside the tree hash for the
 * same reason verify-log/ is: an audit is written after the run it judges.
 * And CI, walking each pushed commit, can now ask of a commit that flips an
 * entry to passing whether the commit itself carries a READY audit of its
 * own tree under that entry's contract — which is I15's rule, checkable
 * off the author's machine for the first time.
 *
 *   node scripts/audit-log.mjs check [--base <ref>] [--at <ref>]
 *   node scripts/audit-log.mjs closures --at <ref> --base <ref>   # a committed flip needs a committed READY audit
 *   node scripts/audit-log.mjs tail [n]
 *   node scripts/audit-log.mjs tree <ref>                         # the hash a committed tree would have had
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { hashFiles, unhashed } from './verify-receipt.mjs';

/**
 * An audit as the receipt records it and this log keeps it.
 * @typedef {{
 *   spec: string,
 *   verdict: string,
 *   security: string | null,
 *   at: string,
 *   treeHash: string,
 *   verifyEvidence: string | null,
 *   commit: string | null,
 * }} Audit
 */

export const root = realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
export const AUDIT_DIR = 'audit-log';

/**
 * An audit's file is named after the moment it was written, UTC, to the
 * millisecond: `20260914T081500.123Z.json`. A run's name stops at the second
 * because a run takes longer than one; two audits can be written a moment
 * apart — the suite does exactly that — and the log never overwrites.
 */
export const AUDIT_FILE = /^(\d{8}T\d{6}\.\d{3}Z)\.json$/u;

const REQUIRED = ['spec', 'verdict', 'at', 'treeHash'];

/** The moment an audit was written, from its id. */
const writtenAt = (/** @type {string} */ id) =>
  new Date(`${id.slice(0, 4)}-${id.slice(4, 6)}-${id.slice(6, 8)}T${id.slice(9, 11)}:${id.slice(11, 13)}:${id.slice(13, 15)}${id.slice(15)}`);

/**
 * The id an audit's `at` gives it: `20260914T081500.123Z` for 2026-09-14T08:15:00.123Z.
 * @param {string} at
 */
export function idFor(at) {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) throw new Error(`audit-log: "${at}" is not a date`);
  return d.toISOString().replace(/[-:]/gu, '');
}

const auditDir = () => path.join(root, AUDIT_DIR);

/** @param {string[]} names */
const auditFiles = (names) => names.filter((n) => AUDIT_FILE.test(n)).sort();

/**
 * The log as it stands in the working tree: file name to contents.
 * @returns {Map<string, string>}
 */
export function currentFiles() {
  if (!existsSync(auditDir())) return new Map();
  return new Map(auditFiles(readdirSync(auditDir())).map((n) => [n, readFileSync(path.join(auditDir(), n), 'utf8')]));
}

/**
 * The log as it stood at a commit. Empty when the directory did not exist there.
 * @param {string} ref
 * @returns {Map<string, string>}
 */
export function filesAt(ref) {
  let listing;
  try {
    listing = execFileSync('git', ['ls-tree', '--name-only', `${ref}:${AUDIT_DIR}`], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return new Map();
  }
  return new Map(
    auditFiles(listing.split('\n')).map((n) => [
      n,
      execFileSync('git', ['show', `${ref}:${AUDIT_DIR}/${n}`], { cwd: root, encoding: 'utf8' }),
    ]),
  );
}

/**
 * The recorded audits, oldest first, from the working tree or from a commit.
 * A file that does not parse is skipped here and refused by `check`.
 * @param {string} [ref]
 * @returns {Audit[]}
 */
export function readAudits(ref) {
  /** @type {Audit[]} */
  const audits = [];
  for (const text of (ref === undefined ? currentFiles() : filesAt(ref)).values()) {
    try {
      audits.push(JSON.parse(text));
    } catch {
      /* the guard's business */
    }
  }
  return audits;
}

/**
 * Appends one audit. Refuses an audit missing what a reader needs, and a
 * second audit in the same second, because two files cannot share a name
 * and the log never overwrites.
 * @param {Audit} audit
 * @returns {string} the path written, relative to the root
 */
export function appendAudit(audit) {
  const missing = REQUIRED.filter((key) => audit[/** @type {keyof Audit} */ (key)] === undefined || audit[/** @type {keyof Audit} */ (key)] === null);
  if (missing.length > 0) throw new Error(`audit-log: an audit needs ${missing.join(', ')}`);
  const name = `${idFor(audit.at)}.json`;
  // `at` is what the name is made from, so an audit cannot arrive predating
  // its own name; the guard's date rule catches a file somebody else wrote.
  const target = path.join(auditDir(), name);
  if (existsSync(target)) throw new Error(`audit-log: ${AUDIT_DIR}/${name} exists; an audit is never overwritten`);
  mkdirSync(auditDir(), { recursive: true });
  writeFileSync(target, `${JSON.stringify(audit, null, 2)}\n`);
  return `${AUDIT_DIR}/${name}`;
}

/**
 * Why the log is not append-only, as a list; empty when it is. The same
 * questions verify-log's guard asks of runs: nothing removed, nothing
 * rewritten, nothing under the directory that is not an audit, every file
 * parsing and carrying its fields, none dated before the moment its name
 * says it was written.
 * @param {{ base?: string, at?: string | null }} [where]
 * @returns {string[]}
 */
export function logProblems({ base = 'HEAD', at = null } = {}) {
  const current = at ? filesAt(at) : currentFiles();
  const baseline = filesAt(base);
  /** @type {string[]} */
  const problems = [];

  for (const [name, text] of baseline) {
    const now = current.get(name);
    if (now === undefined) problems.push(`audit ${name} was removed. Recorded audits are never removed.`);
    else if (now !== text) problems.push(`audit ${name} was rewritten. Recorded audits are not edited.`);
  }

  const listing = at
    ? (() => {
        try {
          return execFileSync('git', ['ls-tree', '--name-only', `${at}:${AUDIT_DIR}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
            .split('\n')
            .filter(Boolean);
        } catch {
          return [];
        }
      })()
    : existsSync(auditDir())
      ? readdirSync(auditDir())
      : [];
  for (const name of listing) {
    if (!AUDIT_FILE.test(name)) problems.push(`${AUDIT_DIR}/${name} is not an audit: an audit's file is named after the moment it was written, <yyyymmdd>T<hhmmss>.<ms>Z.json`);
  }

  for (const [name, text] of current) {
    /** @type {any} */
    let entry;
    try {
      entry = JSON.parse(text);
    } catch {
      problems.push(`audit ${name} is not valid JSON`);
      continue;
    }
    const missing = REQUIRED.filter((key) => entry[key] === undefined);
    if (missing.length) problems.push(`audit ${name} is missing: ${missing.join(', ')}`);
    const recorded = Date.parse(String(entry.at));
    const match = AUDIT_FILE.exec(name);
    if (match && !Number.isNaN(recorded) && recorded < writtenAt(match[1] ?? '').getTime()) {
      problems.push(`audit ${name} is dated ${entry.at}, before its name says it was written`);
    }
  }
  return problems;
}

/**
 * The hash a committed tree has, computed the way verify-receipt computes it
 * for the working tree: the same digest per path, the same paths left out,
 * the same fold. A commit made through the gate has no untracked files, so
 * the two agree; `audit-log.spec.ts` holds them to each other.
 * @param {string} ref
 */
export function treeHashAt(ref) {
  const out = execFileSync('git', ['ls-tree', '-r', '-z', ref], { cwd: root, maxBuffer: 256 * 1024 * 1024 }).toString('utf8');
  /** @type {Record<string, string>} */
  const files = {};
  for (const line of out.split('\0').filter(Boolean)) {
    const [meta, rel] = line.split('\t');
    if (meta === undefined || rel === undefined) continue;
    const [mode, , blob] = meta.split(' ');
    if (unhashed(rel)) continue;
    const content = execFileSync('git', ['cat-file', 'blob', blob ?? ''], { cwd: root, maxBuffer: 256 * 1024 * 1024 });
    const sha = createHash('sha256').update(content).digest('hex').slice(0, 16);
    if (mode === '120000') files[rel] = `link:${sha}`;
    else if (mode === '100644' || mode === '100755') files[rel] = `file:${sha}:${mode === '100755' ? 'x' : '-'}`;
    else files[rel] = 'other';
  }
  return hashFiles(files);
}

/**
 * Entries whose `passes` is false at `base` and true at `at`, by position,
 * and entries that exist only at `at` with `passes` already true.
 * @param {string} base
 * @param {string} at
 * @returns {{ id: number, spec: string | null, description: string }[]}
 */
export function closedBetween(base, at) {
  /** @param {string} ref */
  const listAt = (ref) => {
    try {
      const parsed = JSON.parse(execFileSync('git', ['show', `${ref}:feature_list.json`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };
  const before = listAt(base);
  const after = listAt(at);
  /** @type {{ id: number, spec: string | null, description: string }[]} */
  const closed = [];
  for (let i = 0; i < after.length; i += 1) {
    // Flipped between the two, or born passing at `at`: since 2026-09-16 an
    // entry may be appended already closed, and it is then the commit's one
    // closure, asked for its audit like a flip (I15).
    const flipped = i < before.length && before[i]?.passes === false && after[i]?.passes === true;
    const born = i >= before.length && after[i]?.passes === true;
    if (flipped || born) {
      closed.push({ id: after[i].id ?? i, spec: after[i].spec ?? null, description: after[i].description ?? '' });
    }
  }
  return closed;
}

/**
 * Why a commit that closes an entry may not stand, as a list; empty when it
 * may: the commit's own log must carry an audit of the commit's own tree,
 * under the entry's contract, saying READY. The gate asked this of the
 * receipt before the commit; this asks it of the commit, anywhere.
 * @param {string} base
 * @param {string} at
 * @returns {string[]}
 */
export function closureProblems(base, at) {
  const closed = closedBetween(base, at);
  if (closed.length === 0) return [];
  const tree = treeHashAt(at);
  const audits = readAudits(at).filter((a) => a.treeHash === tree);
  /** @type {string[]} */
  const problems = [];
  for (const entry of closed) {
    const ofSpec = audits.filter((a) => entry.spec === null || a.spec === entry.spec);
    if (audits.length === 0) {
      problems.push(`entry #${entry.id} is closed at ${at.slice(0, 7)} and the commit carries no audit of its own tree under ${AUDIT_DIR}/`);
    } else if (ofSpec.length === 0) {
      problems.push(`entry #${entry.id} closes under ${entry.spec}; the audit(s) of this tree are of ${[...new Set(audits.map((a) => a.spec))].join(', ')}`);
    } else if (!ofSpec.some((a) => a.verdict === 'READY')) {
      problems.push(`entry #${entry.id}: the audit of this tree under ${entry.spec} said ${ofSpec.map((a) => a.verdict).join(', ')}, not READY`);
    }
  }
  return problems;
}

/**
 * @param {string[]} args
 * @param {string} name
 * @param {string | null} [fallback]
 */
function flag(args, name, fallback = null) {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : (args[i + 1] ?? fallback);
}

/** @param {string[]} args */
function check(args) {
  const base = flag(args, 'base', 'HEAD') ?? 'HEAD';
  const at = flag(args, 'at');
  const problems = logProblems({ base, at });
  const count = (at ? filesAt(at) : currentFiles()).size;
  console.log(`check-audit-log: ${count} audit(s) recorded, baseline ${base}`);
  if (problems.length) {
    console.error('check-audit-log: REJECTED');
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log('check-audit-log: ok');
}

/** @param {string[]} args */
function closures(args) {
  const at = flag(args, 'at');
  const base = flag(args, 'base');
  if (!at || !base) {
    console.error('usage: audit-log.mjs closures --at <ref> --base <ref>');
    process.exit(2);
  }
  const closed = closedBetween(base, at);
  if (closed.length === 0) {
    console.log(`audit-log: ${at.slice(0, 7)} closes no entry against ${base.slice(0, 7)}`);
    return;
  }
  const problems = closureProblems(base, at);
  if (problems.length) {
    console.error(`audit-log: REJECTED — ${at.slice(0, 7)} closes ${closed.map((e) => `#${e.id}`).join(', ')} without a READY audit of its own tree (docs/INVARIANTS.md I15)`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`audit-log: ok — ${closed.map((e) => `#${e.id}`).join(', ')} closed at ${at.slice(0, 7)} on a READY audit the commit carries`);
}

/** @param {string[]} args */
function tail(args) {
  const n = Number(args[0] ?? 10);
  for (const a of readAudits().slice(-n)) {
    console.log(`${a.at}  ${a.verdict.padEnd(14)} ${String(a.treeHash).slice(0, 19)}…  ${a.spec}`);
  }
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'check') return check(args);
  if (command === 'closures') return closures(args);
  if (command === 'tail') return tail(args);
  if (command === 'tree') {
    console.log(treeHashAt(args[0] ?? 'HEAD'));
    return;
  }
  console.error('usage: audit-log.mjs check [--base <ref>] [--at <ref>] | closures --at <ref> --base <ref> | tail [n] | tree [<ref>]');
  process.exit(2);
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main();
}
