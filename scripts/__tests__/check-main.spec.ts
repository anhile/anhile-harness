import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Whether `main` is green, and where that answer appears.
 *
 * Nothing asked until 2026-09-11, when `main` was red for three merges while
 * four pull requests were opened on top of it. Each one's own checks were
 * watched; the branch they merged into was watched by nobody, because there
 * was no place the answer appeared.
 *
 * The cases below are about reading a run correctly, and the one that matters
 * is `cancelled`. A cancelled run on `main` is usually concurrency — a later
 * push superseded it — and calling that "fine" is how a genuine failure hides:
 * the last *completed* run can be a cancellation for weeks while nothing green
 * has run at all.
 */
const REPO = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(REPO, 'scripts', 'check-main.mjs');
const read = (...parts: string[]) => readFileSync(path.join(REPO, ...parts), 'utf8');

type Verdict = { known: boolean; ok: boolean; line: string | null; unclear?: boolean; running?: boolean };

/** Drives `describe` with a run of the caller's choosing, in its own process. */
function verdict(run: unknown): Verdict {
  const probe = `
    import { describe } from ${JSON.stringify(SCRIPT)};
    console.log(JSON.stringify(describe(${JSON.stringify(run)})));
  `;
  return JSON.parse(
    execFileSync('node', ['--input-type=module', '-e', probe], { encoding: 'utf8' }),
  ) as Verdict;
}

const run = (over: Record<string, unknown> = {}) => ({
  status: 'completed',
  conclusion: 'success',
  displayTitle: 'Merge pull request #1',
  url: 'https://github.com/o/r/actions/runs/1',
  createdAt: '2026-09-11T15:00:00Z',
  ...over,
});

describe('reading a run', () => {
  it('calls a successful run green, and says nothing louder', () => {
    const v = verdict(run());
    expect(v.ok).toBe(true);
    expect(v.line).toContain('green');
  });

  it('calls a failed run red, in capitals, because it is the oldest problem', () => {
    const v = verdict(run({ conclusion: 'failure' }));
    expect(v.ok).toBe(false);
    expect(v.line).toContain('IS RED');
  });

  it('names the commit and links the run, so the next step is one click', () => {
    const v = verdict(run({ conclusion: 'failure' }));
    expect(v.line).toContain('Merge pull request #1');
    expect(v.line).toContain('actions/runs/1');
  });

  it('says why it matters rather than only that it happened', () => {
    expect(verdict(run({ conclusion: 'failure' })).line).toContain('inherits its failure');
  });

  it('treats a cancelled run as unclear, not as fine', () => {
    // The failure mode this prevents: the last completed run is a cancellation
    // for weeks, nothing green has run, and every check reports no problem.
    const v = verdict(run({ conclusion: 'cancelled' }));
    expect(v.unclear).toBe(true);
    expect(v.line).toContain('nothing has actually passed');
  });

  it('treats a skipped run the same way, for the same reason', () => {
    expect(verdict(run({ conclusion: 'skipped' })).unclear).toBe(true);
  });

  it('says a run is still going rather than guessing how it ends', () => {
    const v = verdict(run({ status: 'in_progress', conclusion: null }));
    expect(v.running).toBe(true);
    expect(v.ok).toBe(true);
  });

  it('says nothing at all when it could not ask', () => {
    // No gh, no network, no permission, no CI. Every one means this cannot
    // answer, and a guard that invents an answer is worse than a quiet one.
    const v = verdict(null);
    expect(v.known).toBe(false);
    expect(v.line).toBeNull();
  });

  it('survives a run with fields missing, rather than printing undefined', () => {
    const v = verdict({ status: 'completed', conclusion: 'failure' });
    expect(v.line).not.toContain('undefined');
  });
});

describe('where the answer appears', () => {
  it('the session-start ritual asks, because that is the first thing read', () => {
    const start = read('scripts', 'session-start.mjs');
    expect(start).toContain("from './check-main.mjs'");
    expect(start).toContain('latestRun()');
  });

  it('the branch gate asks, because that is the last thing read before a pull request', () => {
    expect(read('scripts', 'check-pr-ready.mjs')).toContain("from './check-main.mjs'");
  });

  it('the branch gate reports it and does not refuse on it', () => {
    // A red main is often exactly why somebody is opening a pull request, and a
    // guard that blocks the fix for the thing it complains about is removed.
    const gate = read('scripts', 'check-pr-ready.mjs');
    const refusals = gate.slice(gate.indexOf('export function refusals'), gate.indexOf('function gather'));
    expect(refusals).not.toContain('check-main');
    expect(refusals).not.toContain('IS RED');
  });

  it('the script itself exits zero whatever it found', () => {
    // It reports. Exiting non-zero would make it a gate, and it is not one.
    expect(execFileSync('node', [SCRIPT], { cwd: REPO, encoding: 'utf8', timeout: 20_000 })).toBeDefined();
  });

  it('session-start stays quiet when main is plainly green', () => {
    // Otherwise the ritual grows a line that is always there and therefore
    // never read, which is how the useful one gets missed.
    const start = read('scripts', 'session-start.mjs');
    expect(start).toMatch(/state\.ok && !state\.unclear && !state\.running/u);
  });
});
