/**
 * check-attestation.mjs is the only thing in this project that a machine other
 * than the author's can use to contradict a claim. Locally, verify-log/ is
 * a session's report about itself. Recomputed from a pristine clone by CI —
 * which did not write it — the tree hash either matches the committed content
 * or it does not, and no amount of prose changes which.
 *
 * So the cases that matter are the refusals: a commit no run covers, and a
 * commit whose only run was red.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const REPO = path.resolve(__dirname, '..', '..');
const SCRIPTS = ['verify-receipt.mjs', 'verify-log.mjs', 'audit-log.mjs', 'check-attestation.mjs'];

let repo: string;

function node(script: string, ...args: string[]): string {
  return execFileSync('node', [path.join(repo, 'scripts', script), ...args], {
    cwd: repo,
    encoding: 'utf8',
  });
}

/** The hash the record has to name for a run to count as covering this tree. */
function currentTree(): string {
  return node('verify-receipt.mjs', 'hash').trim();
}

let recorded = 0;

/** One file per run, named as verify.sh names an evidence folder. */
function recordRun(entry: Record<string, unknown>): void {
  recorded += 1;
  mkdirSync(path.join(repo, 'verify-log'), { recursive: true });
  writeFileSync(
    path.join(repo, 'verify-log', `20260830T1000${String(recorded).padStart(2, '0')}Z.json`),
    `${JSON.stringify({
      at: `2026-08-30T10:00:${String(recorded).padStart(2, '0')}.000Z`,
      result: 'pass',
      head: 'a'.repeat(40),
      steps: { '01-eslint': { exit: 0, seconds: 1 } },
      ...entry,
    })}\n`,
  );
}

type Verdict = { rejected: boolean; out: string };

function attest(): Verdict {
  try {
    return { rejected: false, out: node('check-attestation.mjs') };
  } catch (error) {
    const err = error as { status?: number; stdout?: string; stderr?: string };
    if (err.status !== 1) throw error;
    return { rejected: true, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

beforeEach(() => {
  repo = mkdtempSync(path.join(tmpdir(), 'attestation-'));
  mkdirSync(path.join(repo, 'scripts'));
  for (const script of SCRIPTS) {
    copyFileSync(path.join(REPO, 'scripts', script), path.join(repo, 'scripts', script));
  }
  writeFileSync(path.join(repo, '.gitignore'), '.generated/\n');
  writeFileSync(path.join(repo, 'source.ts'), 'export const answer = 42;\n');
  execFileSync('git', ['init', '-q'], { cwd: repo });
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe('what the tree hash leaves out', () => {
  it('is verify-log/ and audit-log/, and nothing else', () => {
    // The records must sit outside the hash, or recording a run would change
    // the tree the run is about, and recording an audit the tree the audit
    // names. Since 2026-09-12 that is a directory prefix rather than one
    // file name, and since 2026-09-14 two of them; this pins that nothing
    // wider slipped in.
    const before = currentTree();
    recordRun({ tree: 'sha256:whatever' });
    expect(currentTree()).toBe(before);
    mkdirSync(path.join(repo, 'audit-log'), { recursive: true });
    writeFileSync(path.join(repo, 'audit-log', '20260914T080000.000Z.json'), '{}\n');
    expect(currentTree()).toBe(before);
    writeFileSync(path.join(repo, 'verify-log-notes.txt'), 'not the record\n');
    expect(currentTree()).not.toBe(before);
  });
});

describe('a commit no run covers', () => {
  it('is refused when the record is missing entirely', () => {
    const verdict = attest();
    expect(verdict.rejected).toBe(true);
    expect(verdict.out).toContain('is missing');
  });

  it('is refused when every recorded run was against different content', () => {
    recordRun({ tree: 'sha256:some-other-tree' });
    const verdict = attest();
    expect(verdict.rejected).toBe(true);
    expect(verdict.out).toContain('No recorded ./verify.sh run was against this tree');
  });

  it('is refused once the content changes after the run that covered it', () => {
    recordRun({ tree: currentTree() });
    expect(attest().rejected).toBe(false);

    writeFileSync(path.join(repo, 'source.ts'), 'export const answer = 43;\n');
    expect(attest().rejected).toBe(true);
  });
});

describe('a commit whose run was red', () => {
  it('is refused, and the failing step is named', () => {
    recordRun({
      tree: currentTree(),
      result: 'fail',
      steps: { '01-eslint': { exit: 0, seconds: 1 }, '02-typecheck': { exit: 2, seconds: 3 } },
    });
    const verdict = attest();
    expect(verdict.rejected).toBe(true);
    expect(verdict.out).toContain('02-typecheck');
  });

  it('is accepted once a later run of the same content passed', () => {
    const tree = currentTree();
    recordRun({ at: '2026-08-30T10:00:00.000Z', tree, result: 'fail' });
    recordRun({ at: '2026-08-30T11:00:00.000Z', tree, result: 'pass' });
    expect(attest().rejected).toBe(false);
  });

  it('is refused again if the newest run of that content went red', () => {
    const tree = currentTree();
    recordRun({ at: '2026-08-30T10:00:00.000Z', tree, result: 'pass' });
    recordRun({ at: '2026-08-30T11:00:00.000Z', tree, result: 'fail' });
    expect(attest().rejected).toBe(true);
  });
});

describe('what it says out loud without failing', () => {
  it('calls out identical content that has both passed and failed', () => {
    // The cheapest flakiness detector this project has: same bytes, different
    // verdicts. It passes — the tree does verify — but staying quiet about it
    // would waste the only signal the record was kept for.
    const tree = currentTree();
    recordRun({ at: '2026-08-30T10:00:00.000Z', tree, result: 'fail' });
    recordRun({ at: '2026-08-30T11:00:00.000Z', tree, result: 'pass' });

    const verdict = attest();
    expect(verdict.rejected).toBe(false);
    expect(verdict.out).toContain('flaky step');
  });

  it('says nothing about flakiness when every run of the content was green', () => {
    recordRun({ tree: currentTree() });
    expect(attest().out).not.toContain('flaky');
  });
});
