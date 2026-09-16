/**
 * The append-only guard for feature_list.json, fired at.
 *
 * This is the oldest guard in the repository and the one the whole append-only
 * doctrine rests on, and until now it was the only one with no test handing it
 * a tampered file to check that it refuses. Every other guard here has one; the
 * gap was listed in CONTRIBUTING.md with a bold zero, which is where this came from.
 */
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const REPO = path.resolve(__dirname, '..', '..');
const FILE = 'feature_list.json';

let repo: string;

const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });

type Retraction = { spec: string; reason: string; supersededBy: number | null };
type Entry = {
  id?: number;
  category: string;
  description: string;
  steps: string[];
  passes: boolean;
  spec?: string | null;
  retracted?: Retraction;
};

const SPEC = 'specs/2026-09-withdrawal.md';

/** The contract a retraction points at. It has to exist on disk, so make one. */
function writeSpec(): void {
  mkdirSync(path.join(repo, 'specs'), { recursive: true });
  writeFileSync(path.join(repo, SPEC), '# the contract that withdraws it\n');
}

const retraction = (over: Partial<Retraction> = {}): Retraction => ({
  spec: SPEC,
  reason: 'the guarantee goes with the theme',
  supersededBy: null,
  ...over,
});

const entry = (n: number, passes = false): Entry => ({
  id: n,
  category: 'redirect',
  description: `feature number ${n}`,
  steps: [`do the thing for ${n}`, `assert the thing for ${n}`],
  passes,
  spec: SPEC,
});

function write(entries: Entry[]): void {
  writeFileSync(path.join(repo, FILE), `${JSON.stringify(entries, null, 2)}\n`);
}

type Verdict = { rejected: boolean; out: string };

function check(...args: string[]): Verdict {
  try {
    const out = execFileSync('node', [path.join(repo, 'scripts', 'check-feature-list.mjs'), ...args], {
      cwd: repo,
      encoding: 'utf8',
    });
    return { rejected: false, out };
  } catch (error) {
    const err = error as { status?: number; stdout?: string; stderr?: string };
    if (err.status !== 1) throw error;
    return { rejected: true, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

/**
 * The entry at a position, or a failure that names it. Under
 * noUncheckedIndexedAccess `list[2]` is `Entry | undefined`, and the fixture
 * has exactly three entries: a case that reaches for a fourth is wrong about
 * the fixture, and should say so rather than assign to undefined.
 */
function at(list: Entry[], i: number): Entry {
  const found = list[i];
  if (found === undefined) throw new Error(`the fixture has no entry ${i}`);
  return found;
}

/** Three committed entries: two closed, one still open. */
const committed = (): Entry[] => [entry(0, true), entry(1, true), entry(2, false)];

beforeEach(() => {
  repo = realpathSync(mkdtempSync(path.join(tmpdir(), 'feature-list-')));
  mkdirSync(path.join(repo, 'scripts'));
  copyFileSync(
    path.join(REPO, 'scripts', 'check-feature-list.mjs'),
    path.join(repo, 'scripts', 'check-feature-list.mjs'),
  );
  // The guard reads its exemptions from harness.config.json through the
  // loader, so the throwaway repository carries both. This repository's
  // configuration exempts nothing, which is what these cases assume.
  copyFileSync(path.join(REPO, 'scripts', 'harness-config.mjs'), path.join(repo, 'scripts', 'harness-config.mjs'));
  copyFileSync(path.join(REPO, 'harness.config.json'), path.join(repo, 'harness.config.json'));
  // With --at the guard asks a committed closure for its audit, through
  // audit-log.mjs and the receipt's hash; the writer is what a closing
  // commit in these cases runs first.
  for (const f of ['audit-log.mjs', 'audit-receipt.mjs', 'verify-receipt.mjs']) {
    copyFileSync(path.join(REPO, 'scripts', f), path.join(repo, 'scripts', f));
  }
  writeFileSync(path.join(repo, '.gitignore'), '.generated/\n');
  writeSpec();
  write(committed());
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('add', '-A');
  git('commit', '-qm', 'three features');
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe('the two permitted changes', () => {
  it('accepts the file exactly as committed', () => {
    expect(check().rejected).toBe(false);
  });

  it('accepts a new entry appended with passes false', () => {
    write([...committed(), entry(3)]);
    expect(check().rejected).toBe(false);
  });

  it('accepts one entry flipped false to true', () => {
    const list = committed();
    at(list, 2).passes = true;
    write(list);
    expect(check().rejected).toBe(false);
  });

  it('accepts appending several while flipping one', () => {
    const list = committed();
    at(list, 2).passes = true;
    write([...list, entry(3), entry(4)]);
    expect(check().rejected).toBe(false);
  });
});

describe('moving the goalposts', () => {
  it('refuses a reworded description, and names the field', () => {
    const list = committed();
    at(list, 1).description = 'something easier';
    write(list);

    const verdict = check();
    expect(verdict.rejected).toBe(true);
    expect(verdict.out).toContain('entry 1 was edited (description)');
  });

  it('refuses an edited step, and shows which step went', () => {
    const list = committed();
    at(list, 1).steps = at(list, 1).steps.slice(0, 1);
    write(list);

    const verdict = check();
    expect(verdict.rejected).toBe(true);
    expect(verdict.out).toContain('entry 1 was edited (steps)');
    expect(verdict.out).toContain('- removed: assert the thing for 1');
  });

  it('refuses a removed entry', () => {
    write(committed().slice(0, 2));
    const verdict = check();
    expect(verdict.rejected).toBe(true);
    expect(verdict.out).toContain('entries were removed');
  });

  it('refuses passes going back to false', () => {
    const list = committed();
    at(list, 0).passes = false;
    write(list);

    const verdict = check();
    expect(verdict.rejected).toBe(true);
    expect(verdict.out).toContain('went from true back to false');
  });

  it('accepts a new entry born passing, as the commit\'s one closure (since 2026-09-16)', () => {
    // Until then a new entry had to start false and flip in a later commit,
    // which is one of the three commits a small feature used to cost. The
    // audit is asked of a born-passing entry by the gate and by CI's walk,
    // not here: step 06 runs before the audit exists.
    write([...committed(), entry(3, true)]);
    const verdict = check();
    expect(verdict.rejected).toBe(false);
    expect(verdict.out).toContain("appended already passing (the commit's closure): 3");
  });

  it('refuses a born-passing entry beside a flip: two closures in one commit', () => {
    const list = committed();
    at(list, 2).passes = true;
    write([...list, entry(3, true)]);
    const verdict = check();
    expect(verdict.rejected).toBe(true);
    expect(verdict.out).toContain('2 entries close at once (2, 3; born passing: 3)');
  });

  it('refuses two entries born passing together', () => {
    write([...committed(), entry(3, true), entry(4, true)]);
    const verdict = check();
    expect(verdict.rejected).toBe(true);
    expect(verdict.out).toContain('2 entries close at once (3, 4; born passing: 3, 4)');
  });

  it('refuses an entry whose shape is not a claim at all', () => {
    const list = committed();
    (list[2] as unknown as { steps: unknown }).steps = [];
    write(list);

    const verdict = check();
    expect(verdict.rejected).toBe(true);
    expect(verdict.out).toContain('"steps" must be a non-empty array');
  });
});

describe('one feature per commit', () => {
  it('refuses two entries flipped to true at once', () => {
    // verify.sh gives one verdict for the whole tree, so two features closed
    // together share a single piece of evidence and neither can be attributed
    // when it later goes red.
    const list = [entry(0, true), entry(1, false), entry(2, false)];
    write(list);
    git('add', '-A');
    git('commit', '-qm', 'two still open');

    at(list, 1).passes = true;
    at(list, 2).passes = true;
    write(list);

    const verdict = check();
    expect(verdict.rejected).toBe(true);
    expect(verdict.out).toContain('2 entries close at once (1, 2). One feature per commit');
  });

  it('accepts them one commit at a time', () => {
    const list = [entry(0, true), entry(1, false), entry(2, false)];
    write(list);
    git('add', '-A');
    git('commit', '-qm', 'two still open');

    at(list, 1).passes = true;
    write(list);
    expect(check().rejected).toBe(false);

    git('add', '-A');
    git('commit', '-qm', 'close the first');

    at(list, 2).passes = true;
    write(list);
    expect(check().rejected).toBe(false);
  });
});

describe('the baselines', () => {
  it('reads the file at a commit with --at, and its parent with --base', () => {
    const list = committed();
    at(list, 2).passes = true;
    write(list);
    // A committed closure carries its audit (audit-log.spec.ts has the
    // refusals); this one is closed the way /verify-task closes it.
    execFileSync('node', [path.join(repo, 'scripts', 'audit-receipt.mjs'), 'write', '--spec', String(at(list, 2).spec), '--verdict', 'READY'], { cwd: repo, stdio: 'ignore' });
    git('add', '-A');
    git('commit', '-qm', 'close the third');

    // Auditing the commit itself, the way CI walks a pushed range.
    expect(check('--at', 'HEAD', '--base', 'HEAD^').rejected).toBe(false);
  });

  it('checks shape only when the baseline has no such file, and says so', () => {
    const verdict = check('--base', 'HEAD^');
    expect(verdict.rejected).toBe(false);
    expect(verdict.out).toContain('no baseline');
  });
});

describe('retracting a closed feature', () => {
  /** A committed baseline whose entry 1 is already retracted. */
  function withRetracted(): Entry[] {
    writeSpec();
    const list = committed();
    at(list, 1).retracted = retraction();
    write(list);
    git('add', '-A');
    git('commit', '-qm', 'retract the second');
    return list;
  }

  it('accepts a well-formed retraction', () => {
    writeSpec();
    const list = committed();
    at(list, 1).retracted = retraction();
    write(list);

    const verdict = check();
    expect(verdict.rejected).toBe(false);
    expect(verdict.out).toContain('retracted entry/entries: 1');
  });

  it('accepts one that names a successor', () => {
    writeSpec();
    const list = [...committed(), entry(3)];
    at(list, 1).retracted = retraction({ supersededBy: 3 });
    write(list);
    expect(check().rejected).toBe(false);
  });

  it.each([
    ['spec', { spec: undefined }, '"retracted.spec" must name'],
    ['reason', { reason: undefined }, '"retracted.reason" must be a non-empty string'],
    ['an empty reason', { reason: '   ' }, '"retracted.reason" must be a non-empty string'],
    ['supersededBy', { supersededBy: undefined }, '"retracted.supersededBy" is required'],
  ])('refuses one missing %s', (_label, over, expected) => {
    writeSpec();
    const list = committed();
    const r = { ...retraction(), ...over } as Record<string, unknown>;
    for (const [k, v] of Object.entries(over)) if (v === undefined) delete r[k];
    at(list, 1).retracted = r as unknown as Retraction;
    write(list);

    const verdict = check();
    expect(verdict.rejected).toBe(true);
    expect(verdict.out).toContain(expected);
  });

  it('refuses one whose contract does not exist', () => {
    const list = committed();
    at(list, 1).retracted = retraction({ spec: 'specs/never-written.md' });
    write(list);

    const verdict = check();
    expect(verdict.rejected).toBe(true);
    expect(verdict.out).toContain('specs/never-written.md, which does not exist');
  });

  it.each([[-1], [999], ['3']])('refuses a supersededBy of %p', (target) => {
    writeSpec();
    const list = committed();
    at(list, 1).retracted = retraction({ supersededBy: target as number });
    write(list);

    const verdict = check();
    expect(verdict.rejected).toBe(true);
    expect(verdict.out).toContain('must be null or the id of an entry in the list');
  });

  it('refuses one that points at itself', () => {
    writeSpec();
    const list = committed();
    at(list, 1).retracted = retraction({ supersededBy: 1 });
    write(list);

    const verdict = check();
    expect(verdict.rejected).toBe(true);
    expect(verdict.out).toContain('points at itself');
  });

  it('refuses a successor that is itself retracted', () => {
    // A chain of withdrawals carries nothing to the reader at the end of it.
    writeSpec();
    const list = committed();
    at(list, 0).retracted = retraction();
    at(list, 1).retracted = retraction({ supersededBy: 0 });
    write(list);

    const verdict = check();
    expect(verdict.rejected).toBe(true);
    expect(verdict.out).toContain('which is itself');
  });

  it('refuses an edited retraction', () => {
    const list = withRetracted();
    at(list, 1).retracted = retraction({ reason: 'actually it was fine all along' });
    write(list);

    const verdict = check();
    expect(verdict.rejected).toBe(true);
    expect(verdict.out).toContain('"retracted" was edited');
  });

  it('refuses a removed retraction', () => {
    const list = withRetracted();
    delete at(list, 1).retracted;
    write(list);

    const verdict = check();
    expect(verdict.rejected).toBe(true);
    expect(verdict.out).toContain('"retracted" was removed');
  });

  it.each([
    ['true to false', true, false],
    ['false to true', false, true],
  ])('refuses passes moving %s on a retracted entry', (_label, from, to) => {
    writeSpec();
    const list = committed();
    at(list, 1).passes = from;
    at(list, 1).retracted = retraction();
    write(list);
    git('add', '-A');
    git('commit', '-qm', 'retract the second');

    at(list, 1).passes = to;
    write(list);

    const verdict = check();
    expect(verdict.rejected).toBe(true);
    expect(verdict.out).toContain('"passes" changed on a retracted entry');
  });

  it('accepts several retractions under one contract', () => {
    // The unit is the contract, not the commit. A flip claims a feature works
    // and needs its own evidence; a withdrawal claims nothing works, and what
    // a reviewer reads is the contract that withdrew it.
    writeSpec();
    const list = committed();
    at(list, 0).retracted = retraction();
    at(list, 1).retracted = retraction();
    write(list);

    const verdict = check();
    expect(verdict.rejected).toBe(false);
    expect(verdict.out).toContain('retracted entry/entries: 0, 1');
  });

  it('refuses retractions citing two different contracts', () => {
    writeSpec();
    writeFileSync(path.join(repo, 'specs', 'other.md'), '# a second contract\n');
    const list = committed();
    at(list, 0).retracted = retraction();
    at(list, 1).retracted = retraction({ spec: 'specs/other.md' });
    write(list);

    const verdict = check();
    expect(verdict.rejected).toBe(true);
    expect(verdict.out).toContain('citing 2 different contracts');
  });

  it('refuses a retraction sharing a commit with a feature being closed', () => {
    writeSpec();
    const list = committed();
    at(list, 1).retracted = retraction();
    at(list, 2).passes = true;
    write(list);

    const verdict = check();
    expect(verdict.rejected).toBe(true);
    expect(verdict.out).toContain('may not both retract');
  });

  it('accepts them one commit at a time', () => {
    writeSpec();
    const list = committed();
    at(list, 1).retracted = retraction();
    write(list);
    expect(check().rejected).toBe(false);

    git('add', '-A');
    git('commit', '-qm', 'retract the second');

    at(list, 2).passes = true;
    write(list);
    expect(check().rejected).toBe(false);
  });

  it('refuses a new entry that arrives retracted', () => {
    writeSpec();
    const born = { ...entry(3), retracted: retraction() };
    write([...committed(), born]);

    const verdict = check();
    expect(verdict.rejected).toBe(true);
    expect(verdict.out).toContain('arrives retracted');
  });

  it('still refuses removing a retracted entry outright', () => {
    // Retraction marks; it never deletes. The record that a guarantee was held
    // and withdrawn is the point.
    const list = withRetracted();
    write(list.slice(0, 1));

    const verdict = check();
    expect(verdict.rejected).toBe(true);
    expect(verdict.out).toContain('entries were removed');
  });
});

describe('the documented rule matches the enforced one', () => {
  // A guard that permits three transitions while the prose promises two is a
  // guard nobody reads correctly.
  //
  // This list named CLAUDE.md until 2026-09-01, when the protocol moved to
  // INVARIANTS.md as I15 and CLAUDE.md kept a one-line pointer. Moving a rule
  // and its test together is the shape of change nothing mechanical catches, so
  // it is named here rather than left to a diff: what the test asks for is
  // stricter than before, not looser. Somewhere citable, under an ID.
  it.each(['docs/INVARIANTS.md', 'CONTRIBUTING.md'])('%s describes retraction', (doc) => {
    const text = readFileSync(path.join(REPO, doc), 'utf8');
    expect(text).toMatch(/retract/i);
  });

  it('the retraction protocol carries an invariant number, so it can be cited', () => {
    const invariants = readFileSync(path.join(REPO, 'docs', 'INVARIANTS.md'), 'utf8');
    const heading = invariants.match(/^## (I\d+) —[^\n]*append-only[^\n]*$/mu);
    expect(heading).not.toBeNull();
    const section = invariants.slice(invariants.indexOf(heading![0]));
    expect(section).toMatch(/supersededBy/);
    expect(section).toMatch(/retract/i);
  });

  it('the agent-facing entry point still points at it, so nobody is left to guess', () => {
    // AGENTS.md since 2026-09-11, CLAUDE.md before that. The rule moved when
    // the documents split by audience: AGENTS.md is what any agent reads and
    // CLAUDE.md carries only what is specific to Claude Code. The check
    // follows the rule rather than the filename.
    const text = readFileSync(path.join(REPO, 'AGENTS.md'), 'utf8');
    expect(text).toMatch(/feature_list\.json/);
    expect(text).toMatch(/append-only|one entry per commit/iu);
  });
});

describe('identity: an id that is its position, and the contract that introduced it', () => {
  // Added 2026-09-08 under specs/2026-09-feature-list-identity.md. Every
  // reference to an entry was a position; the id makes the number a fact of
  // the entry, and the spec makes "a feature has a contract" checkable.

  it('refuses an entry without an id', () => {
    const list = committed();
    delete at(list, 2).id;
    write(list);
    const verdict = check();
    expect(verdict.rejected).toBe(true);
    expect(verdict.out).toContain('entry 2: missing "id"');
  });

  it('refuses an id that is not its position', () => {
    write([...committed(), { ...entry(3), id: 7 }]);
    const verdict = check();
    expect(verdict.rejected).toBe(true);
    expect(verdict.out).toContain('entry 3: "id" is 7 but its position is 3');
  });

  it('refuses an id changed after the fact, even to a free number', () => {
    const list = committed();
    at(list, 2).id = 9;
    write(list);
    const verdict = check();
    expect(verdict.rejected).toBe(true);
    expect(verdict.out).toContain('"id" changed from 2 to 9');
  });

  it('refuses a new entry without a contract', () => {
    write([...committed(), { ...entry(3), spec: null }]);
    const verdict = check();
    expect(verdict.rejected).toBe(true);
    expect(verdict.out).toContain('entry 3 is new and must name its contract');
  });

  it('refuses a new entry with no spec field at all', () => {
    const born = entry(3);
    delete born.spec;
    write([...committed(), born]);
    const verdict = check();
    expect(verdict.rejected).toBe(true);
    expect(verdict.out).toContain('entry 3: "spec" must name the contract');
  });

  it('refuses a contract that does not exist', () => {
    write([...committed(), { ...entry(3), spec: 'specs/2026-09-nobody-wrote-this.md' }]);
    const verdict = check();
    expect(verdict.rejected).toBe(true);
    expect(verdict.out).toContain('which does not exist');
  });

  it('refuses a recorded contract changed after the fact', () => {
    mkdirSync(path.join(repo, 'specs'), { recursive: true });
    writeFileSync(path.join(repo, 'specs/2026-09-other.md'), '# another\n');
    const list = committed();
    at(list, 1).spec = 'specs/2026-09-other.md';
    write(list);
    const verdict = check();
    expect(verdict.rejected).toBe(true);
    expect(verdict.out).toContain('"spec" changed from specs/2026-09-withdrawal.md to specs/2026-09-other.md');
  });

  it('refuses a recorded contract going back to null', () => {
    const list = committed();
    at(list, 1).spec = null;
    write(list);
    const verdict = check();
    expect(verdict.rejected).toBe(true);
    expect(verdict.out).toContain('"spec" changed from specs/2026-09-withdrawal.md to null');
  });

  it('accepts an old entry whose contract is null, and its being recorded once', () => {
    const list = [{ ...entry(0, true), spec: null }, entry(1, true), entry(2)];
    write(list);
    git('add', '-A');
    git('commit', '-qm', 'one entry predates contracts');
    expect(check().rejected).toBe(false);

    at(list, 0).spec = SPEC;
    write(list);
    const recorded = check();
    expect(recorded.rejected).toBe(false);
    expect(recorded.out).toContain('entry 0: "spec" recorded as specs/2026-09-withdrawal.md');
  });

  it('accepts the reshape itself: a baseline without the two fields holds nothing against them', () => {
    const before = committed().map(({ id: _id, spec: _spec, ...rest }) => rest);
    write(before as Entry[]);
    git('add', '-A');
    git('commit', '-qm', 'before ids');
    write(committed());
    expect(check().rejected).toBe(false);
  });
});
