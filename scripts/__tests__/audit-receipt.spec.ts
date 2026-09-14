/**
 * Fires at scripts/audit-receipt.mjs.
 *
 * The receipt is what links the spec-auditor to the commit gate: a closing
 * commit — one whose index flips an entry's passes from false to true — needs
 * an audit of the same tree the verify receipt names, of the contract the
 * entry's spec names, with the verdict READY. This suite drives the script in
 * a throwaway repository; the gate's own use of it is fired at in
 * commit-gate.spec.ts.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const REPO = path.resolve(__dirname, '..', '..');
const SCRIPTS = ['verify-receipt.mjs', 'audit-receipt.mjs', 'audit-log.mjs'];
const SPEC = 'specs/2026-09-thing.md';
const OTHER = 'specs/2026-09-other.md';

let repo: string;
const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const node = (script: string, ...args: string[]) =>
  execFileSync('node', [path.join(repo, 'scripts', script), ...args], { cwd: repo, encoding: 'utf8' });

type Result = { status: number; out: string };
function run(...args: string[]): Result {
  try {
    return { status: 0, out: node('audit-receipt.mjs', ...args) };
  } catch (error) {
    const err = error as { status?: number; stdout?: string; stderr?: string };
    return { status: err.status ?? -1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

const list = (open: boolean) =>
  JSON.stringify([
    { id: 0, category: 'x', description: 'closed already', steps: ['s'], passes: true, spec: SPEC },
    { id: 1, category: 'x', description: 'the one', steps: ['s'], passes: !open, spec: SPEC },
  ], null, 2) + '\n';

function writeVerifyReceipt(): void {
  const before = node('verify-receipt.mjs', 'hash').trim();
  node('verify-receipt.mjs', 'write', '--status', 'pass', '--evidence', '.generated/runs/t', '--tree-before', before, '--failed', '');
}

beforeEach(() => {
  repo = mkdtempSync(path.join(tmpdir(), 'audit-receipt-'));
  mkdirSync(path.join(repo, 'scripts'));
  mkdirSync(path.join(repo, 'specs'));
  for (const s of SCRIPTS) copyFileSync(path.join(REPO, 'scripts', s), path.join(repo, 'scripts', s));
  writeFileSync(path.join(repo, '.gitignore'), '.generated/\n');
  writeFileSync(path.join(repo, SPEC), '# the contract\n');
  writeFileSync(path.join(repo, OTHER), '# another\n');
  writeFileSync(path.join(repo, 'feature_list.json'), list(true));
  git('init', '-q');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  git('add', '-A');
  git('commit', '-qm', 'open');
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

/** Stage the flip of entry 1, which is what makes a commit a closing one. */
function stageClose(): void {
  writeFileSync(path.join(repo, 'feature_list.json'), list(false));
  git('add', '-A');
}

describe('write', () => {
  it('records the contract, the verdict and the current tree', () => {
    const { status, out } = run('write', '--spec', SPEC, '--verdict', 'READY', '--security', 'no findings');
    expect(status).toBe(0);
    const audit = JSON.parse(readFileSync(path.join(repo, '.generated', 'audit.json'), 'utf8'));
    expect(audit.spec).toBe(SPEC);
    expect(audit.verdict).toBe('READY');
    expect(audit.security).toBe('no findings');
    expect(audit.treeHash).toBe(node('verify-receipt.mjs', 'hash').trim());
    expect(out).toContain('READY');
  });

  it('appends the verdict to audit-log/, whatever it is', () => {
    // The receipt is overwritten by the next audit and git-ignored; once a
    // closing commit landed, nothing said an auditor ever looked. The log
    // keeps every verdict, NOT_READY included — a log of READYs only is a
    // highlight reel — named after the moment, with the receipt's fields.
    run('write', '--spec', SPEC, '--verdict', 'NOT_READY');
    run('write', '--spec', OTHER, '--verdict', 'READY', '--security', 'no findings');
    const names = readdirSync(path.join(repo, 'audit-log')).sort();
    expect(names).toHaveLength(2);
    for (const name of names) expect(name).toMatch(/^\d{8}T\d{6}\.\d{3}Z\.json$/u);
    const [first, second] = names.map((n) => JSON.parse(readFileSync(path.join(repo, 'audit-log', n), 'utf8')));
    expect(first.verdict).toBe('NOT_READY');
    expect(first.spec).toBe(SPEC);
    expect(second.verdict).toBe('READY');
    expect(second.security).toBe('no findings');
    expect(second.treeHash).toBe(node('verify-receipt.mjs', 'hash').trim());
    // The receipt and the log agree about the last audit.
    expect(second).toEqual(JSON.parse(readFileSync(path.join(repo, '.generated', 'audit.json'), 'utf8')));
  });

  it('leaves no receipt when the log refuses the append', () => {
    // The log is written first. A receipt left behind by a write that then
    // failed would let the gate through on an audit nothing recorded.
    writeFileSync(path.join(repo, 'audit-log'), 'not a directory\n');
    const { status } = run('write', '--spec', SPEC, '--verdict', 'READY');
    expect(status).not.toBe(0);
    expect(existsSync(path.join(repo, '.generated', 'audit.json'))).toBe(false);
  });

  it('refuses a verdict that is not one of the three', () => {
    const { status, out } = run('write', '--spec', SPEC, '--verdict', 'LOOKS FINE');
    expect(status).toBe(1);
    expect(out).toContain('READY, NOT_READY, CANNOT_VERIFY');
  });

  it('refuses to write without a contract', () => {
    expect(run('write', '--verdict', 'READY').status).toBe(1);
  });
});

describe('check', () => {
  it('requires nothing when the index closes no entry', () => {
    writeFileSync(path.join(repo, 'source.ts'), 'x');
    git('add', '-A');
    const { status, out } = run('check');
    expect(status).toBe(0);
    expect(out).toContain('closes no entry');
  });

  it('refuses a closing commit with no audit at all, naming the entry', () => {
    stageClose();
    writeVerifyReceipt();
    const { status, out } = run('check');
    expect(status).toBe(1);
    expect(out).toContain('closing #1 needs an audit');
    expect(out).toContain('no audit receipt');
  });

  it('accepts a closing commit audited READY on this tree for this contract', () => {
    stageClose();
    writeVerifyReceipt();
    run('write', '--spec', SPEC, '--verdict', 'READY');
    const { status, out } = run('check');
    expect(status).toBe(0);
    expect(out).toContain('#1 audited READY');
  });

  it('refuses a verdict other than READY', () => {
    stageClose();
    writeVerifyReceipt();
    run('write', '--spec', SPEC, '--verdict', 'NOT_READY');
    const { status, out } = run('check');
    expect(status).toBe(1);
    expect(out).toContain('was NOT_READY, not READY');
  });

  it('refuses an audit of another tree — the code moved after the auditor looked', () => {
    stageClose();
    writeVerifyReceipt();
    run('write', '--spec', SPEC, '--verdict', 'READY');
    writeFileSync(path.join(repo, 'source.ts'), 'changed after the audit');
    git('add', '-A');
    writeVerifyReceipt();
    const { status, out } = run('check');
    expect(status).toBe(1);
    expect(out).toContain('the audit was about tree');
  });

  it('refuses an audit of a different contract than the entry closes under', () => {
    stageClose();
    writeVerifyReceipt();
    run('write', '--spec', OTHER, '--verdict', 'READY');
    const { status, out } = run('check');
    expect(status).toBe(1);
    expect(out).toContain(`entry #1 closes under ${SPEC}, the audit was of ${OTHER}`);
  });

  it('looks at the index, not the working tree: an unstaged flip is not yet a closing commit', () => {
    writeFileSync(path.join(repo, 'feature_list.json'), list(false));
    expect(run('check').status).toBe(0);
  });
});
