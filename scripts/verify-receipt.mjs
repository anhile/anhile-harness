#!/usr/bin/env node
// @ts-check
/**
 * The verify receipt: what `./verify.sh` last concluded, and about which tree.
 *
 * A green run is only evidence about the exact bytes it ran against. This file
 * pairs the verdict with a content hash of the working tree, so a later reader
 * can tell whether that verdict still describes what is on disk.
 *
 * The hashed set is `git ls-files -c -o --exclude-standard`: everything in the
 * index plus everything untracked that is not ignored. That set is deliberately
 * *stable across `git add`* -- staging a new file moves it from "other" to
 * "cached" without changing the set or any content, so the hash a verify run
 * recorded still matches at commit time. Hashing the index alone would make
 * every commit of a new file look like an unverified tree.
 *
 * The receipt is git-ignored. It is a statement about a working tree, and a
 * working tree is not a thing a commit can carry.
 *
 * Usage:
 *   node scripts/verify-receipt.mjs hash
 *   node scripts/verify-receipt.mjs show
 *   node scripts/verify-receipt.mjs write --status pass|fail \
 *        --evidence <dir> --tree-before <hash> [--failed a,b]
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, readlinkSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Derived from this file's own location, never from the caller's cwd or an
 * environment variable. A root that the caller can point elsewhere is a root
 * that can be pointed at a directory holding a forged receipt.
 */
export const root = realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
export const RECEIPT_FILE = '.generated/receipt.json';

/**
 * Files that describe the tree and therefore cannot be part of it. verify.sh
 * records a run under verify-log/ at the end of every run, so hashing it would make
 * each run invalidate its own receipt. It is tracked, so it cannot simply be
 * ignored either -- which is why the commit gate runs the log's own append-only
 * guard instead of relying on this hash to notice tampering.
 */
export const UNHASHED = ['verify-log/'];

function listPaths() {
  const out = execFileSync(
    'git',
    ['ls-files', '-c', '-o', '--exclude-standard', '-z'],
    { cwd: root, maxBuffer: 256 * 1024 * 1024 },
  );
  return [...new Set(out.toString('utf8').split('\0').filter(Boolean))]
    .filter((rel) => !UNHASHED.some((prefix) => rel.startsWith(prefix)))
    .sort();
}

/** A short, stable description of one path's content. */
/**
 * What the receipt records per path, so the hash of the tree is the hash of
 * these and nothing else.
 * @typedef {Record<string, string>} TreeFiles
 */

/**
 * The receipt verify.sh writes and the commit gate reads.
 * @typedef {{
 *   status: string,
 *   failedSteps: string[],
 *   finishedAt: string,
 *   evidence: string,
 *   commit: string | null,
 *   treeHashBefore: string | null,
 *   treeHash: string,
 *   files: TreeFiles,
 * }} Receipt
 */

/** @param {string} rel */
function digestOf(rel) {
  const abs = path.join(root, rel);
  let stat;
  try {
    stat = lstatSync(abs);
  } catch {
    // Tracked in the index but gone from disk. A deletion is a change like any
    // other, so it has to hash differently from the file still being there.
    return 'absent';
  }
  if (stat.isSymbolicLink()) {
    return `link:${createHash('sha256').update(readlinkSync(abs)).digest('hex').slice(0, 16)}`;
  }
  if (!stat.isFile()) return 'other';
  const sha = createHash('sha256').update(readFileSync(abs)).digest('hex').slice(0, 16);
  // The executable bit is part of what is committed, so it is part of the hash.
  return `file:${sha}:${stat.mode & 0o111 ? 'x' : '-'}`;
}

/** Per-path digests. Kept in the receipt so a mismatch can name the files. */
/** @returns {TreeFiles} */
export function treeFiles() {
  /** @type {TreeFiles} */
  const files = {};
  for (const rel of listPaths()) files[rel] = digestOf(rel);
  return files;
}

/** @param {TreeFiles} files */
export function hashFiles(files) {
  const total = createHash('sha256');
  for (const rel of Object.keys(files).sort()) {
    total.update(rel);
    total.update('\0');
    total.update(files[rel] ?? '');
    total.update('\n');
  }
  return `sha256:${total.digest('hex')}`;
}

export function treeHash() {
  return hashFiles(treeFiles());
}

/** @returns {Receipt | null} */
export function readReceipt() {
  try {
    return JSON.parse(readFileSync(path.join(root, RECEIPT_FILE), 'utf8'));
  } catch {
    return null;
  }
}

/** Paths whose digest differs between a recorded tree and the current one. */
/**
 * @param {TreeFiles | null | undefined} recorded
 * @param {TreeFiles} current
 */
export function changedPaths(recorded, current) {
  /** @type {string[]} */
  const changed = [];
  for (const rel of new Set([...Object.keys(recorded ?? {}), ...Object.keys(current)])) {
    if ((recorded ?? {})[rel] !== current[rel]) changed.push(rel);
  }
  return changed.sort();
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

function main() {
  const [command, ...args] = process.argv.slice(2);

  if (command === 'hash') {
    process.stdout.write(`${treeHash()}\n`);
    return;
  }

  if (command === 'show') {
    const receipt = readReceipt();
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
    process.exit(receipt ? 0 : 1);
  }

  if (command === 'write') {
    const files = treeFiles();
    const after = hashFiles(files);
    const before = flag(args, 'tree-before');
    const failed = flag(args, 'failed').split(',').filter(Boolean);
    let status = flag(args, 'status');

    // The tree moved while the steps were running, so the steps did not all see
    // the same code and the verdict is about no single tree. Not a pass.
    if (before && before !== after) status = 'stale';

    /** @type {Receipt} */
    const receipt = {
      status,
      failedSteps: failed,
      finishedAt: new Date().toISOString(),
      evidence: path.relative(root, path.resolve(flag(args, 'evidence'))),
      commit: (() => {
        try {
          // stderr ignored: before the first commit git says "ambiguous argument
          // 'HEAD'" on every run, and the null below is the whole answer.
          return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
            .toString()
            .trim();
        } catch {
          return null;
        }
      })(),
      treeHashBefore: before || null,
      treeHash: after,
      files,
    };
    const receiptPath = path.join(root, RECEIPT_FILE);
    mkdirSync(path.dirname(receiptPath), { recursive: true });
    writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    process.stdout.write(`${after}\n`);
    return;
  }

  process.stderr.write('usage: verify-receipt.mjs hash|show|write\n');
  process.exit(2);
}

// Compared through realpath: Node resolves symlinks in `import.meta.url` but
// leaves argv[1] as typed, and on macOS /var is a link to /private/var. A plain
// string comparison silently never matches, and the script does nothing at all.
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main();
}
