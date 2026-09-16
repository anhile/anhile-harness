import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * Fires at scripts/audit-log.mjs, in a throwaway repository.
 *
 * The receipt was the only thing a closing commit had to show for its audit,
 * and it is git-ignored and overwritten by the next one. The log keeps every
 * verdict as a tracked file, so the questions here are the ones asked of any
 * record this repository keeps: is it appended and never edited, can a
 * machine that did not write it recompute what it names, and does a commit
 * that closes an entry carry the audit that let it through.
 */
const REPO = path.resolve(__dirname, '..', '..');
const SCRIPTS = ['verify-receipt.mjs', 'audit-receipt.mjs', 'audit-log.mjs', 'check-feature-list.mjs', 'harness-config.mjs'];
const SPEC = 'specs/2026-09-thing.md';
const OTHER = 'specs/2026-09-other.md';

let repo: string;
const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const node = (script: string, ...args: string[]) =>
  execFileSync('node', [path.join(repo, 'scripts', script), ...args], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

type Result = { status: number; out: string };
function run(script: string, ...args: string[]): Result {
  try {
    return { status: 0, out: node(script, ...args) };
  } catch (error) {
    const err = error as { status?: number; stdout?: string; stderr?: string };
    return { status: err.status ?? -1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

const list = (passes: boolean) =>
  `${JSON.stringify([{ id: 0, category: 'x', description: 'the one', steps: ['s'], passes, spec: SPEC }], null, 2)}\n`;

const audit = (over: Record<string, unknown> = {}) => ({
  spec: SPEC,
  verdict: 'READY',
  security: null,
  at: '2026-09-14T08:00:00.000Z',
  treeHash: 'sha256:aaa',
  verifyEvidence: null,
  commit: null,
  ...over,
});

function record(name: string, contents: string): void {
  mkdirSync(path.join(repo, 'audit-log'), { recursive: true });
  writeFileSync(path.join(repo, 'audit-log', name), contents);
}

beforeEach(() => {
  repo = mkdtempSync(path.join(tmpdir(), 'audit-log-'));
  mkdirSync(path.join(repo, 'scripts'));
  mkdirSync(path.join(repo, 'specs'));
  for (const s of SCRIPTS) copyFileSync(path.join(REPO, 'scripts', s), path.join(repo, 'scripts', s));
  copyFileSync(path.join(REPO, 'harness.config.json'), path.join(repo, 'harness.config.json'));
  writeFileSync(path.join(repo, '.gitignore'), '.generated/\n');
  writeFileSync(path.join(repo, SPEC), '# the contract\n');
  writeFileSync(path.join(repo, OTHER), '# another\n');
  writeFileSync(path.join(repo, 'feature_list.json'), list(false));
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  git('add', '-A');
  git('commit', '-qm', 'open');
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe('append: what the log keeps', () => {
  it('one file per verdict, named after the moment, with the receipt\'s fields', () => {
    node('audit-receipt.mjs', 'write', '--spec', SPEC, '--verdict', 'CANNOT_VERIFY');
    node('audit-receipt.mjs', 'write', '--spec', SPEC, '--verdict', 'READY');
    const names = readdirSync(path.join(repo, 'audit-log')).sort();
    expect(names).toHaveLength(2);
    const kept = names.map((n) => JSON.parse(readFileSync(path.join(repo, 'audit-log', n), 'utf8')));
    expect(kept.map((a) => a.verdict)).toEqual(['CANNOT_VERIFY', 'READY']);
    for (const [i, a] of kept.entries()) {
      // The name is the `at`, so a file cannot predate its own name.
      expect(names[i]).toBe(`${a.at.replace(/[-:]/gu, '')}.json`);
      expect(a.treeHash).toBe(node('verify-receipt.mjs', 'hash').trim());
    }
  });

  it('never a second file under one name: the log does not overwrite', () => {
    // Two audits in one millisecond would share a name. The second is
    // refused rather than written over the first, and the writer appends
    // before it leaves a receipt, so a refusal leaves nothing behind.
    const twice = [
      "import { appendAudit } from './scripts/audit-log.mjs';",
      "const a = { spec: 'specs/x.md', verdict: 'READY', security: null, at: '2026-09-14T08:00:00.123Z', treeHash: 'sha256:aaa', verifyEvidence: null, commit: null };",
      'appendAudit(a);',
      'appendAudit({ ...a, verdict: "NOT_READY" });',
    ].join('\n');
    const { status, out } = run('audit-log.mjs', 'tail');
    expect(status).toBe(0);
    expect(out).toBe('');
    let message = '';
    try {
      execFileSync('node', ['--input-type=module', '-e', twice], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      message = (error as { stderr: string }).stderr;
    }
    expect(message).toContain('audit-log/20260914T080000.123Z.json exists; an audit is never overwritten');
    const kept = JSON.parse(readFileSync(path.join(repo, 'audit-log', '20260914T080000.123Z.json'), 'utf8'));
    expect(kept.verdict).toBe('READY');
  });

  it('tells the story in order with tail', () => {
    node('audit-receipt.mjs', 'write', '--spec', SPEC, '--verdict', 'NOT_READY');
    node('audit-receipt.mjs', 'write', '--spec', SPEC, '--verdict', 'READY');
    const lines = node('audit-log.mjs', 'tail').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('NOT_READY');
    expect(lines[1]).toContain('READY');
    expect(lines[1]).toContain(SPEC);
  });
});

describe('what the log refuses', () => {
  const committed = () => {
    record('20260914T080000.000Z.json', `${JSON.stringify(audit({ verdict: 'NOT_READY' }))}\n`);
    git('add', '-A');
    git('commit', '-qm', 'an audit on record');
  };

  it('accepts a record that only grew', () => {
    committed();
    record('20260914T081500.000Z.json', `${JSON.stringify(audit({ at: '2026-09-14T08:15:00.000Z' }))}\n`);
    const { status, out } = run('audit-log.mjs', 'check');
    expect(status).toBe(0);
    expect(out).toContain('2 audit(s) recorded');
  });

  it('a rewritten audit — a NOT_READY that became READY', () => {
    committed();
    record('20260914T080000.000Z.json', `${JSON.stringify(audit({ verdict: 'READY' }))}\n`);
    const { status, out } = run('audit-log.mjs', 'check');
    expect(status).toBe(1);
    expect(out).toContain('20260914T080000.000Z.json was rewritten');
  });

  it('a removed audit', () => {
    committed();
    rmSync(path.join(repo, 'audit-log', '20260914T080000.000Z.json'));
    const { status, out } = run('audit-log.mjs', 'check');
    expect(status).toBe(1);
    expect(out).toContain('was removed');
  });

  it('a file that is not an audit', () => {
    committed();
    record('notes.txt', 'the auditor seemed happy\n');
    const { status, out } = run('audit-log.mjs', 'check');
    expect(status).toBe(1);
    expect(out).toContain('audit-log/notes.txt is not an audit');
  });

  it('an audit that does not parse, and one missing what a reader needs', () => {
    record('20260914T080000.000Z.json', '{ not json\n');
    record('20260914T080100.000Z.json', `${JSON.stringify({ verdict: 'READY', at: '2026-09-14T08:01:00.000Z' })}\n`);
    const { status, out } = run('audit-log.mjs', 'check');
    expect(status).toBe(1);
    expect(out).toContain('20260914T080000.000Z.json is not valid JSON');
    expect(out).toContain('20260914T080100.000Z.json is missing: spec, treeHash');
  });

  it('an audit dated before its name says it was written', () => {
    record('20260914T090000.000Z.json', `${JSON.stringify(audit({ at: '2026-09-14T08:00:00.000Z' }))}\n`);
    const { status, out } = run('audit-log.mjs', 'check');
    expect(status).toBe(1);
    expect(out).toContain('before its name says it was written');
  });

  it('reads the record at a commit with --at, so CI can walk pushed commits', () => {
    committed();
    record('20260914T080000.000Z.json', `${JSON.stringify(audit({ verdict: 'READY' }))}\n`);
    git('add', '-A');
    git('commit', '-qm', 'rewritten');
    expect(run('audit-log.mjs', 'check', '--at', 'HEAD', '--base', 'HEAD^').status).toBe(1);
    expect(run('audit-log.mjs', 'check', '--at', 'HEAD^', '--base', 'HEAD^').status).toBe(0);
  });
});

describe('the tree of a commit hashes as the receipt hashed it', () => {
  it('with a plain file, an executable and a symlink, and neither record counted', () => {
    // CI recomputes a committed closure's tree to compare it with the audit's;
    // that only means something if the recomputation is the receipt's own
    // arithmetic. Mode and link target are part of it, and both records are
    // left out of it.
    writeFileSync(path.join(repo, 'run.sh'), '#!/bin/sh\n', { mode: 0o755 });
    symlinkSync('run.sh', path.join(repo, 'alias'));
    mkdirSync(path.join(repo, 'verify-log'));
    writeFileSync(path.join(repo, 'verify-log', '20260914T080000Z.json'), '{}\n');
    record('20260914T080000.000Z.json', `${JSON.stringify(audit())}\n`);
    git('add', '-A');
    git('commit', '-qm', 'shapes');
    const fromWorkingTree = node('verify-receipt.mjs', 'hash').trim();
    expect(node('audit-log.mjs', 'tree', 'HEAD').trim()).toBe(fromWorkingTree);
    // And it is a hash of content: the parent differs.
    expect(node('audit-log.mjs', 'tree', 'HEAD^').trim()).not.toBe(fromWorkingTree);
  });
});

describe('what the tree of a commit leaves out', () => {
  it('is the two records and the journal, and nothing else, pinned on tree itself', () => {
    // The case above compares `tree` with the receipt's hasher, and a path
    // both skip would cancel out. This asks `tree` alone: a commit that adds
    // only records hashes as its parent did; a commit that adds anything
    // else does not.
    const before = node('audit-log.mjs', 'tree', 'HEAD').trim();
    mkdirSync(path.join(repo, 'verify-log'));
    writeFileSync(path.join(repo, 'verify-log', '20260914T080000Z.json'), '{}\n');
    record('20260914T080000.000Z.json', `${JSON.stringify(audit())}\n`);
    git('add', '-A');
    git('commit', '-qm', 'records only');
    expect(node('audit-log.mjs', 'tree', 'HEAD').trim()).toBe(before);
    // PROGRESS.md since 2026-09-16: the entry naming a closure's audit shares
    // the closure's commit, so the journal is outside the hash the audit and
    // the receipt agree on. The gate reads the journal itself instead.
    writeFileSync(path.join(repo, 'PROGRESS.md'), '# Progress\n\n## an entry written after the run\n');
    git('add', '-A');
    git('commit', '-qm', 'the journal only');
    expect(node('audit-log.mjs', 'tree', 'HEAD').trim()).toBe(before);
    writeFileSync(path.join(repo, 'verify-log-notes.txt'), 'not a record\n');
    git('add', '-A');
    git('commit', '-qm', 'one more file');
    expect(node('audit-log.mjs', 'tree', 'HEAD').trim()).not.toBe(before);
  });

  it('this repository\'s own HEAD is a tree some recorded run covers', () => {
    // The same arithmetic against the real record, not a fixture: HEAD here
    // was committed through the gate, so a run under verify-log/ names its
    // tree, and `tree HEAD` has to find it.
    const tree = execFileSync('node', [path.join(REPO, 'scripts', 'audit-log.mjs'), 'tree', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim();
    expect(tree).toMatch(/^sha256:[0-9a-f]{64}$/u);
    // The journal left the tree hash on 2026-09-16; every run recorded up to
    // the merge of pull request #24 (commit 029366a) hashed it, so `tree HEAD`
    // cannot reproduce those. The property holds for every HEAD committed
    // since — the same shape as PRE_RULE_COMMITS in check-feature-list.mjs: a
    // rule that names the commits it postdates rather than quietly excusing
    // them. At such a HEAD the case asserts the opposite, so the exemption is
    // shown to be needed and not decorative.
    const LAST_HEAD_WITH_THE_JOURNAL_HASHED = '029366a3d8f4ad98461882bdd35c802bf3c80d42';
    const predates = spawnSync('git', ['merge-base', '--is-ancestor', 'HEAD', LAST_HEAD_WITH_THE_JOURNAL_HASHED], { cwd: REPO }).status === 0;
    const recorded = readdirSync(path.join(REPO, 'verify-log'))
      .filter((n) => n.endsWith('.json'))
      .map((n) => JSON.parse(readFileSync(path.join(REPO, 'verify-log', n), 'utf8')).tree as string);
    if (predates) {
      expect(recorded).not.toContain(tree);
      return;
    }
    expect(recorded).toContain(tree);
  });
});

describe('a committed closure carries its audit', () => {
  /** Flip the entry, optionally audit, commit — what /verify-task and a commit do. */
  function close(verdict: string | null, spec = SPEC): void {
    writeFileSync(path.join(repo, 'feature_list.json'), list(true));
    if (verdict !== null) node('audit-receipt.mjs', 'write', '--spec', spec, '--verdict', verdict);
    git('add', '-A');
    git('commit', '-qm', 'close');
  }
  const walk = () => run('check-feature-list.mjs', '--at', 'HEAD', '--base', 'HEAD^');

  it('refuses the commit that closes with no audit at all, naming the entry', () => {
    close(null);
    const { status, out } = walk();
    expect(status).toBe(1);
    expect(out).toContain('entry #0 is closed at');
    expect(out).toContain('carries no audit of its own tree under audit-log/');
    // The same verdict from the module's own command.
    expect(run('audit-log.mjs', 'closures', '--at', 'HEAD', '--base', 'HEAD^').out).toContain('without a READY audit');
  });

  it('accepts the commit that carries a READY audit of its own tree under the contract', () => {
    close('READY');
    const { status, out } = walk();
    expect(status).toBe(0);
    expect(out).toContain('passes flipped false -> true');
    expect(run('audit-log.mjs', 'closures', '--at', 'HEAD', '--base', 'HEAD^').out).toContain('#0 closed at');
  });

  it('asks the audit of an entry born passing, as of a flip: the same commit opens and closes it', () => {
    const born = { id: 1, category: 'x', description: 'born closed', steps: ['s'], passes: true, spec: SPEC };
    const withBorn = () => `${JSON.stringify([...JSON.parse(list(false)), born], null, 2)}\n`;
    writeFileSync(path.join(repo, 'feature_list.json'), withBorn());
    git('add', '-A');
    git('commit', '-qm', 'born, no audit');
    const refused = walk();
    expect(refused.status).toBe(1);
    expect(refused.out).toContain("appended already passing (the commit's closure): 1");
    expect(refused.out).toContain('entry #1 is closed at');
    expect(refused.out).toContain('carries no audit of its own tree under audit-log/');
    git('reset', '-q', '--hard', 'HEAD^');
    writeFileSync(path.join(repo, 'feature_list.json'), withBorn());
    node('audit-receipt.mjs', 'write', '--spec', SPEC, '--verdict', 'READY');
    git('add', '-A');
    git('commit', '-qm', 'born, audited');
    expect(walk().status).toBe(0);
    expect(run('audit-log.mjs', 'closures', '--at', 'HEAD', '--base', 'HEAD^').out).toContain('#1 closed at');
  });

  it('refuses a NOT_READY audit, and says what the audit said', () => {
    close('NOT_READY');
    const { status, out } = walk();
    expect(status).toBe(1);
    expect(out).toContain('said NOT_READY, not READY');
  });

  it('refuses an audit of another contract', () => {
    close('READY', OTHER);
    const { status, out } = walk();
    expect(status).toBe(1);
    expect(out).toContain(`closes under ${SPEC}; the audit(s) of this tree are of ${OTHER}`);
  });

  it('refuses an audit of another tree — the code moved after the auditor looked', () => {
    writeFileSync(path.join(repo, 'feature_list.json'), list(true));
    node('audit-receipt.mjs', 'write', '--spec', SPEC, '--verdict', 'READY');
    writeFileSync(path.join(repo, 'source.ts'), 'export const answer = 43;\n');
    git('add', '-A');
    git('commit', '-qm', 'close, and a little more');
    const { status, out } = walk();
    expect(status).toBe(1);
    expect(out).toContain('carries no audit of its own tree');
  });

  it('closes an entry that records no contract on a READY audit of the tree under any', () => {
    // A list from before contracts has entries with `spec: null`; there is
    // no contract to hold the audit to, and the gate's receipt rule reads it
    // the same way. The audit of the tree still has to be there and READY.
    const noSpec = (passes: boolean) =>
      `${JSON.stringify([{ id: 0, category: 'x', description: 'from before', steps: ['s'], passes, spec: null }], null, 2)}\n`;
    writeFileSync(path.join(repo, 'feature_list.json'), noSpec(false));
    git('add', '-A');
    git('commit', '-qm', 'an entry with no contract');
    writeFileSync(path.join(repo, 'feature_list.json'), noSpec(true));
    node('audit-receipt.mjs', 'write', '--spec', OTHER, '--verdict', 'READY');
    git('add', '-A');
    git('commit', '-qm', 'close');
    expect(walk().status).toBe(0);
  });

  it('asks nothing of a commit that closes nothing, and nothing before the commit', () => {
    writeFileSync(path.join(repo, 'source.ts'), 'export const answer = 42;\n');
    git('add', '-A');
    git('commit', '-qm', 'work');
    expect(walk().status).toBe(0);
    // Before the commit the flip is in the working tree and the audit is
    // written after step 06 runs, so step 06 does not ask; the gate does.
    writeFileSync(path.join(repo, 'feature_list.json'), list(true));
    expect(run('check-feature-list.mjs').status).toBe(0);
  });
});
