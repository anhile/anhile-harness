#!/usr/bin/env node
// @ts-check
/**
 * The audit receipt: what the spec-auditor concluded, and about which tree.
 *
 * Until 2026-09-08 the two reviewers in .claude/agents/ had never run.
 * `/verify-task` was disable-model-invocation and a person had to remember to
 * type it; across ninety feature entries nobody did. CONTRIBUTING named that as
 * the same failure the commit gate was built to end, one level up.
 *
 * This is the link. `/verify-task <spec>` ends by writing this receipt — the
 * contract it audited, the auditor's verdict, the security reviewer's when the
 * surface moved, and the hash of the tree all of that was about. The commit
 * gate reads it before a *closing* commit: one whose index flips an entry's
 * `passes` from false to true. The receipt must name the tree the verify
 * receipt names, the contract the flipped entry's `spec` names, and a verdict
 * of READY. Any other commit is untouched.
 *
 * Every verdict is also appended to `audit-log/`, one file per audit, which
 * is tracked and append-only (audit-log.mjs): the receipt is overwritten by
 * the next audit, and without the log nothing on record said an auditor
 * ever looked once the closing commit had landed.
 *
 * Forgeable, like the verify receipt: a session can run `write` itself. The
 * defence is the same — that is a deliberate act on a named file, in a
 * session whose transcript shows no audit ran — and the gate raises the cost
 * from "forgot" to "lied". See CONTRIBUTING, "What falls through to review".
 *
 * Usage:
 *   node scripts/audit-receipt.mjs write --spec <path> --verdict READY|NOT_READY|CANNOT_VERIFY [--security "<summary>"]
 *   node scripts/audit-receipt.mjs show
 *   node scripts/audit-receipt.mjs check          exit 0 when a closing commit may proceed
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isQuick, readReceipt, root, treeHash } from './verify-receipt.mjs';
import { appendAudit } from './audit-log.mjs';

export const AUDIT_FILE = '.generated/audit.json';
export const VERDICTS = ['READY', 'NOT_READY', 'CANNOT_VERIFY'];

/**
 * The audit receipt /verify-task writes and the commit gate reads.
 * @typedef {{ spec: string, verdict: string, security: string | null, at: string, treeHash: string, verifyEvidence: string | null, commit: string | null }} Audit
 */

/** An entry the index flips to passing, as the gate names it. */
/** @typedef {{ id: number, spec: string | null, description: string }} Closing */

/** @param {...string} args */
function git(...args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

/**
 * @param {string} ref
 * @returns {any[] | null}
 */
function listAt(ref) {
  const raw = git('show', `${ref}:feature_list.json`);
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Entries the index closes: `passes` false at HEAD, true in what is staged.
 * The index rather than the working tree, because the index is what the
 * commit will contain. Nothing to compare gives nothing, not a guess.
 */
/** @returns {Closing[]} */
export function closingEntries() {
  const before = listAt('HEAD');
  const after = listAt(''); // the index
  if (!before || !after) return [];
  /** @type {Closing[]} */
  const closing = [];
  for (let i = 0; i < after.length; i += 1) {
    // Flipped, or born passing: an entry the index appends with `passes`
    // already true closes in the same commit that opens it (I15, since
    // 2026-09-16), and is asked for its audit like any closure.
    const flipped = i < before.length && before[i]?.passes === false && after[i]?.passes === true;
    const born = i >= before.length && after[i]?.passes === true;
    if (flipped || born) {
      closing.push({ id: after[i].id ?? i, spec: after[i].spec ?? null, description: after[i].description ?? '' });
    }
  }
  return closing;
}

/** @returns {Audit | null} */
export function readAudit() {
  try {
    return JSON.parse(readFileSync(path.join(root, AUDIT_FILE), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Why a closing commit may not proceed, as a list; empty when it may.
 * `expectedTree` is the tree the verify receipt names — the audit has to be
 * about the same bytes verify.sh passed.
 */
/**
 * @param {string | null} expectedTree
 * @param {Closing[]} closing
 */
export function auditProblems(expectedTree, closing) {
  const audit = readAudit();
  /** @type {string[]} */
  const problems = [];
  if (!audit) {
    problems.push(`no audit receipt at ${AUDIT_FILE}`);
    return problems;
  }
  if (audit.verdict !== 'READY') {
    problems.push(`the auditor's verdict was ${audit.verdict ?? '(none)'}, not READY`);
  }
  if (audit.treeHash !== expectedTree) {
    problems.push(`the audit was about tree ${String(audit.treeHash ?? '(none)').slice(0, 19)}…, the verify receipt names ${String(expectedTree).slice(0, 19)}…`);
  }
  for (const entry of closing) {
    if (entry.spec && audit.spec !== entry.spec) {
      problems.push(`entry #${entry.id} closes under ${entry.spec}, the audit was of ${audit.spec ?? '(none)'}`);
    }
  }
  return problems;
}

/**
 * @param {string[]} args
 * @param {string} name
 * @param {string | null} [fallback]
 * @returns {string | null}
 */
function flag(args, name, fallback = '') {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : (args[i + 1] ?? fallback);
}

/** @param {string[]} args */
function write(args) {
  const spec = flag(args, 'spec');
  const verdict = flag(args, 'verdict');
  const security = flag(args, 'security', null);
  if (!spec) {
    process.stderr.write('audit-receipt: --spec <path> is required\n');
    process.exit(1);
  }
  if (verdict === null || !VERDICTS.includes(verdict)) {
    process.stderr.write(`audit-receipt: --verdict must be one of ${VERDICTS.join(', ')}\n`);
    process.exit(1);
  }
  const verify = readReceipt();
  // An audit is about the full gate. A --quick run left api-e2e, browser-e2e
  // and coverage to CI and ran only the suites it found affected, so its
  // evidence folder cannot back a verdict about the contract, READY or not
  // (docs/INVARIANTS.md I11).
  if (isQuick(verify)) {
    process.stderr.write(
      `audit-receipt: the verify receipt is from ./verify.sh --quick (since ${verify?.quickBase ?? 'main'}); ` +
        'an audit is about the full gate. Run ./verify.sh, then the audit\n',
    );
    process.exit(1);
  }
  /** @type {Audit} */
  const receipt = {
    spec,
    verdict,
    security,
    at: new Date().toISOString(),
    treeHash: treeHash(),
    verifyEvidence: verify?.evidence ?? null,
    commit: (git('rev-parse', 'HEAD') ?? '').trim() || null,
  };
  // The log first, then the receipt. The receipt is for the next commit; the
  // log is for everyone after it, and every verdict goes in, so the closing
  // commit carries the audit that let it through and CI can ask for it
  // (audit-log.mjs closures). Log first because the append can be refused —
  // a name already taken, a directory that cannot be written — and a receipt
  // left behind by a write that then failed is a receipt nothing recorded.
  const logged = appendAudit(receipt);
  mkdirSync(path.join(root, path.dirname(AUDIT_FILE)), { recursive: true });
  writeFileSync(path.join(root, AUDIT_FILE), `${JSON.stringify(receipt, null, 2)}\n`);
  process.stdout.write(`${verdict} ${receipt.treeHash} ${spec}\n${logged}\n`);
}

function check() {
  const closing = closingEntries();
  if (closing.length === 0) {
    process.stdout.write('audit-receipt: the index closes no entry; no audit is required\n');
    return;
  }
  const verify = readReceipt();
  const problems = auditProblems(verify?.treeHash ?? null, closing);
  if (problems.length === 0) {
    process.stdout.write(`audit-receipt: ok — ${closing.map((e) => `#${e.id}`).join(', ')} audited READY on this tree\n`);
    return;
  }
  process.stderr.write(`audit-receipt: closing ${closing.map((e) => `#${e.id}`).join(', ')} needs an audit of this tree\n`);
  for (const p of problems) process.stderr.write(`  - ${p}\n`);
  process.exit(1);
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'write') return write(args);
  if (command === 'check') return check();
  if (command === 'show') {
    const audit = readAudit();
    process.stdout.write(`${JSON.stringify(audit, null, 2)}\n`);
    process.exit(audit ? 0 : 1);
  }
  process.stderr.write('usage: audit-receipt.mjs write --spec <path> --verdict <v> [--security <s>] | show | check\n');
  process.exit(2);
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main();
}
