#!/usr/bin/env node
// @ts-check
/**
 * verify-log.jsonl — the durable record of what ./verify.sh concluded.
 *
 * The raw evidence under .generated/runs/ stays out of git: 110 runs of this project
 * weigh 64 MB, most of it Playwright reports, and none of it survives a clone.
 * What goes into history instead is one line per run: the verdict, every step's
 * exit code and duration, and the hash of the tree it ran against.
 *
 * **Every run is appended, including failures.** A record that keeps only the
 * green runs lies by omission, and this repository has the failure mode to
 * prove it: two commits made on a red verify.sh left no durable trace at all.
 * Red runs are also where the useful signal is -- a step that fails one run in
 * five is invisible until someone can count.
 *
 * Append-only, on the same reasoning as feature_list.json: a session that can
 * rewrite the record of its own verification can say anything about it. The
 * file at HEAD must remain a line-for-line prefix of the working file.
 *
 * Usage:
 *   node scripts/verify-log.mjs append --evidence <dir>
 *   node scripts/verify-log.mjs check [--base <ref>] [--at <ref>]
 *   node scripts/verify-log.mjs tail [n]
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { readReceipt } from './verify-receipt.mjs';

/**
 * One line of verify-log.jsonl: a run, as the receipt described it.
 * @typedef {{
 *   at: string,
 *   result: 'pass' | 'fail' | 'stale' | string,
 *   tree: string | null,
 *   head: string | null,
 *   branch: string | null,
 *   node: string,
 *   evidence: string,
 *   steps: Record<string, { exit: number, seconds: number }>,
 * }} Run
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';

export const root = realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
export const LOG_FILE = 'verify-log.jsonl';

const REQUIRED = ['at', 'result', 'tree', 'steps'];

function logPath() {
  return path.join(root, LOG_FILE);
}

/**
 * The non-empty lines of the log, each one a JSON record.
 * @param {string} text
 * @returns {string[]}
 */
export function readLines(text) {
  return text.split('\n').filter((line) => line.trim() !== '');
}

export function currentLines() {
  if (!existsSync(logPath())) return [];
  return readLines(readFileSync(logPath(), 'utf8'));
}

/**
 * The log as it stood at a commit, or empty if it did not exist yet.
 * @param {string} ref
 */
function showAt(ref) {
  try {
    return execFileSync('git', ['show', `${ref}:${LOG_FILE}`], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return '';
  }
}

/** @param {string} base */
function baselineLines(base) {
  try {
    return readLines(
      execFileSync('git', ['show', `${base}:${LOG_FILE}`], {
        cwd: root,
        encoding: 'utf8',
        // git narrates a missing path on stderr; that is an expected state here.
        stdio: ['ignore', 'pipe', 'ignore'],
      }),
    );
  } catch {
    // Not in the baseline at all: the file is new, and every line is an append.
    return [];
  }
}

/**
 * Reads the per-step results verify.sh recorded for one run.
 * @param {string} evidenceDir
 * @returns {Run['steps']}
 */
function readSteps(evidenceDir) {
  const file = path.join(root, evidenceDir, 'steps.jsonl');
  if (!existsSync(file)) return {};
  /** @type {Run['steps']} */
  const steps = {};
  for (const line of readLines(readFileSync(file, 'utf8'))) {
    const { step, exit, seconds } = JSON.parse(line);
    steps[step] = { exit, seconds };
  }
  return steps;
}

/**
 * @param {string[]} args
 * @param {string} name
 * @param {string} [fallback]
 */
function flag(args, name, fallback = '') {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : (args[i + 1] ?? fallback);
}

/** @param {string[]} args */
function append(args) {
  const evidence = path.relative(root, path.resolve(flag(args, 'evidence')));
  // The verdict and the tree come from the receipt rather than from arguments,
  // so the durable record and the thing the commit gate reads cannot disagree
  // -- including when the receipt downgraded the run to `stale`.
  const receipt = readReceipt();
  /** @type {Run} */
  const entry = {
    at: new Date().toISOString(),
    result: receipt?.status ?? 'unknown',
    tree: receipt?.treeHash ?? null,
    // The commit this run was based on. The run's own result is not yet in any
    // commit, so this is a starting point, not an identity.
    head: (() => {
      try {
        return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      } catch {
        return null;
      }
    })(),
    branch: (() => {
      try {
        return (
          execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() ||
          null
        );
      } catch {
        return null;
      }
    })(),
    node: process.version,
    evidence,
    steps: readSteps(evidence),
  };
  appendFileSync(logPath(), `${JSON.stringify(entry)}\n`);
  process.stdout.write(`${entry.result} ${entry.tree}\n`);
}

/** @param {string[]} args */
function check(args) {
  const base = flag(args, 'base', 'HEAD');
  // See check-feature-list.mjs: --at reads the file at a commit rather than from
  // the working tree, so CI can walk pushed commits one at a time.
  const at = flag(args, 'at');
  const current = at ? readLines(showAt(at)) : currentLines();
  const baseline = baselineLines(base);
  /** @type {string[]} */
  const problems = [];

  if (current.length < baseline.length) {
    problems.push(
      `${LOG_FILE} has ${current.length} line(s); ${base} has ${baseline.length}. ` +
      'Runs are never removed from the record.',
    );
  }

  for (let i = 0; i < Math.min(baseline.length, current.length); i += 1) {
    if (baseline[i] !== current[i]) {
      problems.push(`line ${i + 1} was rewritten. Recorded runs are not edited.`);
      break;
    }
  }

  /** @type {string | null} */
  let previousAt = null;
  current.forEach((line, i) => {
    /** @type {any} */
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      problems.push(`line ${i + 1} is not valid JSON`);
      return;
    }
    const missing = REQUIRED.filter((key) => entry[key] === undefined);
    if (missing.length) problems.push(`line ${i + 1} is missing: ${missing.join(', ')}`);
    if (previousAt && entry.at < previousAt) {
      problems.push(`line ${i + 1} is dated before the line above it`);
    }
    previousAt = entry.at;
  });

  const appended = current.length - baseline.length;
  console.log(`check-verify-log: ${current.length} run(s) recorded, baseline ${base}`);
  if (appended > 0) console.log(`  note: ${appended} run(s) appended`);

  if (problems.length) {
    console.error('check-verify-log: REJECTED');
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  console.log('check-verify-log: ok');
}

/** @param {string[]} args */
function tail(args) {
  const n = Number(args[0] ?? 10);
  for (const line of currentLines().slice(-n)) {
    const e = JSON.parse(line);
    const failed = Object.entries(e.steps ?? {})
      .filter(([, s]) => s.exit !== 0)
      .map(([name]) => name);
    console.log(
      `${e.at}  ${e.result.toUpperCase().padEnd(4)}  ${(e.head ?? '').slice(0, 7)}  ` +
      `${failed.length ? failed.join(',') : 'all steps green'}`,
    );
  }
}

/**
 * Flakiness, from the record. A step that failed on some tree and passed on
 * that same tree — identical content, different verdicts — did not fail
 * because of the code. Failing runs are kept in the log precisely so this can
 * be counted; until 2026-09-08 nothing counted it.
 *
 * Returns one row per flaky step: how many trees it flaked on, how many times,
 * and when it last did. A tree with only failures is a real failure and is not
 * counted; a tree with only passes has nothing to say.
 * @param {Run[]} entries
 * @param {{ since?: string | null }} [options]
 */
export function flakes(entries, { since = null } = {}) {
  /** @type {Map<string, Run[]>} */
  const byTree = new Map();
  for (const e of entries) {
    if (!e.tree || (since && e.at < since)) continue;
    const runs = byTree.get(e.tree) ?? [];
    runs.push(e);
    byTree.set(e.tree, runs);
  }
  /** @type {Map<string, { step: string, trees: Set<string>, times: number, last: string }>} */
  const rows = new Map();
  for (const [tree, runs] of byTree) {
    if (!runs.some((r) => r.result === 'pass')) continue;
    for (const r of runs) {
      if (r.result === 'pass') continue;
      for (const [step, s] of Object.entries(r.steps ?? {})) {
        if (s.exit === 0) continue;
        const row = rows.get(step) ?? { step, trees: new Set(), times: 0, last: '' };
        row.trees.add(tree);
        row.times += 1;
        if (r.at > row.last) row.last = r.at;
        rows.set(step, row);
      }
    }
  }
  return [...rows.values()]
    .map((r) => ({ step: r.step, trees: r.trees.size, times: r.times, last: r.last }))
    .sort((a, b) => b.times - a.times || a.step.localeCompare(b.step));
}

/** @param {string[]} args */
function report(args) {
  const days = Number(args[0] ?? 30);
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  /** @type {Run[]} */
  const entries = currentLines().map((line) => JSON.parse(line));
  const rows = flakes(entries, { since });
  const window = entries.filter((e) => e.at >= since).length;
  console.log(`verify-log flakes: last ${days} day(s), ${window} run(s) on record`);
  if (rows.length === 0) {
    console.log('  no step has both failed and passed on the same tree');
    return;
  }
  console.log('  step            trees  times  last');
  for (const r of rows) {
    console.log(`  ${r.step.padEnd(16)}${String(r.trees).padStart(5)}  ${String(r.times).padStart(5)}  ${r.last}`);
  }
  console.log('  a step listed here failed on content that also passed: the code is not why');
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'append') return append(args);
  if (command === 'check') return check(args);
  if (command === 'tail') return tail(args);
  if (command === 'flakes') return report(args);
  process.stderr.write('usage: verify-log.mjs append|check|tail|flakes [days]\n');
  process.exit(2);
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main();
}
