import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * The append-only walk in CI, held to the one shape it got wrong.
 *
 * The `attest` job walks every pushed commit against its parent, because
 * append-only is a property of each commit and not of a span. On the first
 * merge that closed anything — seven entries, one per commit — it compared
 * the merge commit with its first parent, `main`, and seven legal commits
 * collapsed into "an entry born passing". Main went red on 2026-09-11 for a
 * rule every commit on the branch had kept.
 *
 * verify.yml is protected, so this reads it rather than editing it: the
 * walk must compare a merge commit with the branch it merged, and the guard
 * must accept that comparison for the shape that failed.
 */
const REPO = path.resolve(__dirname, '..', '..');
const workflow = readFileSync(path.join(REPO, '.github', 'workflows', 'verify.yml'), 'utf8');

describe('the append-only walk in CI', () => {
  it('walks every pushed commit, one against its parent', () => {
    expect(workflow).toContain('git rev-list --reverse "${base}..${CHECKOUT_REF}"');
    expect(workflow).toMatch(/for commit in \$commits; do/u);
  });

  it('compares a merge commit with the branch it merged, not with the main it landed on', () => {
    // The second parent of a merge is the branch tip. Against the first
    // parent the whole branch is one diff, and one-closure-per-commit reads
    // as seven closures in one.
    expect(workflow).toMatch(/git rev-parse --verify --quiet "\$\{commit\}\^2"/u);
    expect(workflow).toMatch(/parent="\$\{commit\}\^2"/u);
    for (const guard of ['check-feature-list.mjs', 'verify-log.mjs check', 'check-migrations.mjs']) {
      expect(workflow).toContain(`${guard} --at "$commit" --base "$parent"`);
    }
  });
});

describe('the guard, on the shape that went red', () => {
  // A branch that appends seven entries and closes them one per commit, then
  // a merge commit of that branch into a main that has none of it.
  let repo: string;
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
  const guard = (at: string, base: string): boolean => {
    try {
      execFileSync('node', [path.join(repo, 'scripts', 'check-feature-list.mjs'), '--at', at, '--base', base], {
        cwd: repo,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return true;
    } catch {
      return false;
    }
  };

  beforeAll(() => {
    repo = mkdtempSync(path.join(tmpdir(), 'attest-merge-'));
    mkdirSync(path.join(repo, 'scripts'));
    mkdirSync(path.join(repo, 'specs'));
    // The guard asks a committed closure for its audit, so the fixture needs
    // the receipt's writer and what it imports, and a closing commit here
    // does what /verify-task does: writes the audit, then commits it.
    for (const f of ['check-feature-list.mjs', 'harness-config.mjs', 'audit-log.mjs', 'audit-receipt.mjs', 'verify-receipt.mjs']) {
      copyFileSync(path.join(REPO, 'scripts', f), path.join(repo, 'scripts', f));
    }
    copyFileSync(path.join(REPO, 'harness.config.json'), path.join(repo, 'harness.config.json'));
    writeFileSync(path.join(repo, '.gitignore'), '.generated/\n');
    writeFileSync(path.join(repo, 'specs', 'c.md'), '# the contract\n');
    const write = (entries: object[]) =>
      writeFileSync(path.join(repo, 'feature_list.json'), `${JSON.stringify(entries, null, 2)}\n`);
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    write([]);
    git('add', '-A');
    git('commit', '-qm', 'seed');
    git('checkout', '-qb', 'work');
    const entries = [0, 1, 2].map((id) => ({
      id,
      category: 'c',
      description: `guarantee ${id}`,
      steps: ['a step'],
      passes: false,
      spec: 'specs/c.md',
    }));
    write(entries);
    git('add', '-A');
    git('commit', '-qm', 'open three');
    for (const id of [0, 1, 2]) {
      entries[id]!.passes = true;
      write(entries);
      execFileSync('node', [path.join(repo, 'scripts', 'audit-receipt.mjs'), 'write', '--spec', 'specs/c.md', '--verdict', 'READY'], { cwd: repo, stdio: 'ignore' });
      git('add', '-A');
      git('commit', '-qm', `close #${id}`);
    }
    git('checkout', '-q', 'main');
    git('merge', '-q', '--no-ff', '-m', 'merge work', 'work');
  });

  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  it('refuses the merge against its first parent, which is the collapse that went red', () => {
    expect(guard('HEAD', 'HEAD^')).toBe(false);
  });

  it('accepts the merge against its second parent, the branch each commit of which it accepted', () => {
    expect(guard('HEAD', 'HEAD^2')).toBe(true);
    for (const commit of git('rev-list', '--reverse', 'HEAD^..HEAD^2').split('\n')) {
      expect(guard(commit, `${commit}^`)).toBe(true);
    }
  });
});
