import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * The first guarantee, run rather than reasoned about: a project the
 * generator writes passes its own gate on the first run.
 *
 * `harness-init.spec.ts` asserts the step list, the file set and the
 * configuration — everything that would make that run fail — and its header
 * says doing the run itself is "the wrong price on every commit". That was
 * written in a repository whose gate took minutes; here step 03 took
 * seventeen seconds, and the first audit of the harness's own list could not
 * confirm the guarantee from anything local, because the only end-to-end run
 * was the `generate` job in CI. Forty seconds is the price of the sentence
 * README opens with being checkable on a laptop. One variant here — nothing
 * chosen, the fastest to install — and five in CI.
 */
const REPO = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(REPO, 'scripts', 'harness-init.mjs');
const MINUTES = 60_000;

let dir: string;

beforeAll(() => {
  dir = path.join(mkdtempSync(path.join(tmpdir(), 'generated-project-')), 'probe');
  execFileSync('node', [SCRIPT, '--yes', '--name', 'probe', '--into', dir], { cwd: REPO, encoding: 'utf8' });
  execFileSync('git', ['init', '-q'], { cwd: dir });
  // From the store where it can be: everything the toolchain needs is
  // already there for this repository's own install.
  execFileSync('pnpm', ['install', '--prefer-offline'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}, 3 * MINUTES);

afterAll(() => {
  if (dir) rmSync(path.dirname(dir), { recursive: true, force: true });
});

describe('a generated project, on its first run', () => {
  it('passes its own gate, every step', () => {
    // The inner gate inherits this process's environment, EVIDENCE_DIR from
    // the outer gate included, and must write its own evidence under the
    // probe regardless: verify.sh assigns its own, and this run proves it.
    // Nothing else is set, so this is the first run as a person would make it.
    const out = execFileSync('./verify.sh', { cwd: dir, encoding: 'utf8' });
    expect(out).toContain('RESULT: PASS (6/6 steps)');
    const summary = readFileSync(path.join(dir, '.generated', 'runs', newestRun(dir), 'summary.txt'), 'utf8');
    expect(summary).toMatch(/^PASS  01 eslint/mu);
    expect(summary).toMatch(/^PASS  02 typecheck/mu);
    expect(summary).toMatch(/^PASS  03 unit/mu);
    expect(summary).toMatch(/^PASS  06 feature-list/mu);
    expect(summary).toMatch(/^PASS  07 verify-log/mu);
    expect(summary).toMatch(/^PASS  08 coverage/mu);
  }, 3 * MINUTES);

  it('records the run in its own log, so its first commit can be attested', () => {
    const log = readFileSync(path.join(dir, 'verify-log.jsonl'), 'utf8').trim().split('\n');
    expect(log).toHaveLength(1);
    expect(JSON.parse(log[0] ?? '{}').result).toBe('pass');
  });
});

function newestRun(root: string): string {
  const runs = execFileSync('ls', [path.join(root, '.generated', 'runs')], { encoding: 'utf8' })
    .split('\n')
    .filter((n) => /^\d{8}T\d{6}Z$/u.test(n))
    .sort();
  const last = runs[runs.length - 1];
  if (last === undefined) throw new Error('the probe wrote no evidence folder');
  return last;
}
