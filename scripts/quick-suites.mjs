#!/usr/bin/env node
// @ts-check
/**
 * Which suites a quick run runs.
 *
 * `./verify.sh --quick` was born on 2026-09-16 asking jest for the suites
 * related to what changed since the base, and jest answers from the import
 * graph. In this repository no guard suite imports the script it fires at:
 * every one copies it into a throwaway repository, spawns it, or reads it
 * from disk. So the graph related nothing to a changed script, and every
 * quick run that day selected exactly the spec files the session had edited
 * — which passed trees the full gate then failed, three closures in a row.
 *
 * A suite is selected here on any of three grounds, and the log says which:
 *
 *   by import   jest's own answer, `--listTests --changedSince <base>`;
 *   itself      the suite is among the changed paths;
 *   by name     the suite's text names a changed path, or its basename —
 *               a suite that copies `verify-receipt.mjs` into a fixture, or
 *               reads `harness.manifest.json`, says so in its source.
 *
 * Over-selection is the cheap direction: a suite that names `package.json`
 * runs when any package.json changes, and that costs seconds. Under-selection
 * is the expensive one, and the reason this exists.
 *
 *   node scripts/quick-suites.mjs [--base <ref>]     # paths, one per line; the why on stderr
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));

/** What a suite's file is called, in either project of jest.config.cjs. */
export const SUITE = /\.spec\.[cm]?[jt]sx?$/u;

/**
 * @param {string[]} args
 * @param {string} cwd
 */
function gitLines(args, cwd) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\n')
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * The paths that differ from the base: committed since the merge base,
 * staged, unstaged, and untracked but not ignored — the same set the tree
 * hash covers, against the same base jest is asked about.
 * @param {string} base
 * @param {string} [cwd]
 */
export function changedSince(base, cwd = root) {
  const set = new Set();
  const [mergeBase] = gitLines(['merge-base', base, 'HEAD'], cwd);
  if (mergeBase) for (const p of gitLines(['diff', '--name-only', mergeBase], cwd)) set.add(p);
  for (const p of gitLines(['diff', '--name-only', '--cached'], cwd)) set.add(p);
  for (const p of gitLines(['ls-files', '-o', '--exclude-standard'], cwd)) set.add(p);
  return [...set].sort();
}

/**
 * Every suite jest would run: its own list first, since jest.config.cjs
 * decides which files are suites here (a template's spec under templates/
 * is not one); when jest gives no answer, every `*.spec.*` file in the
 * tree, tracked or not.
 * @param {string} [cwd]
 */
export function allSuites(cwd = root) {
  const result = spawnSync('pnpm', ['exec', 'jest', '--listTests'], { cwd, encoding: 'utf8' });
  const listed = result.status === 0 ? result.stdout.split('\n').filter((l) => l.trim() !== '').map((abs) => path.relative(cwd, abs.trim())) : [];
  if (listed.length > 0) return listed.sort();
  return gitLines(['ls-files', '-c', '-o', '--exclude-standard'], cwd).filter((p) => SUITE.test(p)).sort();
}

/**
 * jest's own answer, relative to the root. Empty when jest refuses to answer
 * — before the first commit, or with no suite at all — and the other two
 * grounds still stand.
 * @param {string} base
 * @param {string} [cwd]
 */
export function relatedByImport(base, cwd = root) {
  const result = spawnSync('pnpm', ['exec', 'jest', '--listTests', '--changedSince', base], { cwd, encoding: 'utf8' });
  if (result.status !== 0) return [];
  return result.stdout
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((abs) => path.relative(cwd, abs.trim()));
}

/**
 * @typedef {{ selected: string[], byImport: string[], itself: string[], byName: Map<string, string[]> }} Selection
 */

/**
 * The three grounds, over what is given: pure, so the rule can be fired at
 * without a repository.
 * @param {{ changed: string[], suites: string[], related: string[], textOf: (suite: string) => string }} input
 * @returns {Selection}
 */
export function selectSuites({ changed, suites, related, textOf }) {
  const known = new Set(suites);
  const byImport = related.filter((s) => known.has(s));
  const itself = suites.filter((s) => changed.includes(s));
  /** @type {Map<string, string[]>} */
  const byName = new Map();
  for (const suite of suites) {
    if (changed.includes(suite)) continue;
    const text = textOf(suite);
    const hits = changed.filter((p) => text.includes(p) || text.includes(path.basename(p)));
    if (hits.length > 0) byName.set(suite, hits);
  }
  const selected = [...new Set([...byImport, ...itself, ...byName.keys()])].sort();
  return { selected, byImport, itself, byName };
}

/**
 * @param {Selection} selection
 * @param {{ base: string, total: number }} about
 */
export function describe(selection, { base, total }) {
  const { selected, byImport, itself, byName } = selection;
  const lines = [
    `quick-suites: ${selected.length} of ${total} suite(s) since ${base} — ${byImport.length} by import, ${itself.length} changed themselves, ${byName.size} by name`,
  ];
  for (const [suite, hits] of byName) lines.push(`  by name: ${suite} ← ${hits.join(', ')}`);
  if (selected.length === 0) lines.push(`  nothing changed since ${base} that any suite imports, is, or names`);
  return lines.join('\n');
}

function main() {
  const args = process.argv.slice(2);
  const i = args.indexOf('--base');
  const base = i === -1 ? 'main' : (args[i + 1] ?? 'main');
  const suites = allSuites();
  const selection = selectSuites({
    changed: changedSince(base),
    suites,
    related: relatedByImport(base),
    textOf: (suite) => readFileSync(path.join(root, suite), 'utf8'),
  });
  process.stderr.write(`${describe(selection, { base, total: suites.length })}\n`);
  if (selection.selected.length > 0) process.stdout.write(`${selection.selected.join('\n')}\n`);
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main();
}
