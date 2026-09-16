import { execFileSync } from 'node:child_process';
import path from 'node:path';


// A spike branch proves nothing and cannot reach main (docs/INVARIANTS.md I16).
// The hooks and the guards each carry their own case in their own suite; this
// one pins the shape they share, and the CI form of the refusal.

const REPO = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(REPO, 'scripts', 'spike.mjs');

// The suites here drive scripts as processes, the way the hooks and CI do;
// the module's exports are reached through node so the suite stays a suite
// of the shipped file and not of a type declaration.
function exported<T>(expression: string): T {
  const out = execFileSync('node', ['--input-type=module', '-e', `import * as m from ${JSON.stringify(SCRIPT)}; console.log(JSON.stringify(${expression}));`], { encoding: 'utf8' });
  return JSON.parse(out) as T;
}
const isSpike = (branch: string | null | undefined) => exported<boolean>(`m.isSpike(${JSON.stringify(branch ?? null)})`);
const spikeNote = (branch: string) => exported<string>(`m.spikeNote(${JSON.stringify(branch)})`);
const spikeRefusal = (branch: string, base: string) => exported<string>(`m.spikeRefusal(${JSON.stringify(branch)}, ${JSON.stringify(base)})`);

function check(...args: string[]): { status: number; out: string } {
  try {
    return { status: 0, out: execFileSync('node', [SCRIPT, 'check', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (error) {
    const err = error as { status?: number; stderr?: string; stdout?: string };
    return { status: err.status ?? -1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

describe('what a spike is', () => {
  it('is any branch under spike/, and nothing else', () => {
    expect(isSpike('spike/try-sqlite')).toBe(true);
    expect(isSpike('spike/')).toBe(true);
    expect(isSpike('spikes/no')).toBe(false);
    expect(isSpike('feature/spike')).toBe(false);
    expect(isSpike('main')).toBe(false);
    expect(isSpike(null)).toBe(false);
  });

  it('says, in one note, what is not asked and where the work goes when it survives', () => {
    const note = spikeNote('spike/x');
    expect(note).toContain('I16');
    expect(note).toContain('no receipt is asked at commit time');
    expect(note).toContain('no journal entry at session end');
    expect(note).toContain('protected files stay protected');
    expect(note).toContain('git checkout -b <name> main');
    expect(note).toContain('deleted, not merged');
  });
});

describe('the CI form: node scripts/spike.mjs check --branch', () => {
  it('refuses a spike with the same sentence check-pr-ready gives, and exits 3', () => {
    const result = check('--branch', 'spike/try-sqlite', '--base', 'main');
    expect(result.status).toBe(3);
    expect(result.out).toContain(spikeRefusal('spike/try-sqlite', 'main'));
    expect(result.out).toContain('cannot reach main');
  });

  it('lets any other branch through, saying so', () => {
    const result = check('--branch', 'feature/x');
    expect(result.status).toBe(0);
    expect(result.out).toContain('feature/x is not a spike branch');
  });

  it('refuses with no subcommand, so a typo in the workflow is a red job, not a pass', () => {
    let status = 0;
    try {
      execFileSync('node', [SCRIPT], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      status = (error as { status?: number }).status ?? -1;
    }
    expect(status).toBe(1);
  });
});
