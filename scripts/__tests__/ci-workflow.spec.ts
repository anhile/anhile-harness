import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs';
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

describe('a pull request from a spike branch is refused before the walk (I16)', () => {
  it('the attest job runs spike.mjs check on the head branch of a pull request, first', () => {
    const workflow = readFileSync(path.join(REPO, '.github', 'workflows', 'verify.yml'), 'utf8');
    const refusal = workflow.indexOf('node scripts/spike.mjs check --branch "${{ github.head_ref }}" --base "${{ github.base_ref }}"');
    const attestation = workflow.indexOf('node scripts/check-attestation.mjs');
    expect(refusal).toBeGreaterThan(-1);
    expect(attestation).toBeGreaterThan(-1);
    expect(refusal).toBeLessThan(attestation);
    expect(workflow).toContain("if: github.event_name == 'pull_request'");
  });
});

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
    for (const guard of ['check-feature-list.mjs', 'verify-log.mjs check', 'check-migrations.mjs', 'progress.mjs check']) {
      expect(workflow).toContain(`${guard} --at "$commit" --base "$parent"`);
    }
  });
});

describe('the guard, on the shape that went red', () => {
  // A branch that appends seven entries and closes them one per commit, then
  // a merge commit of that branch into a main that has none of it.
  let repo: string;
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
  const walk = (argv: string[], at: string, base: string): boolean => {
    try {
      execFileSync('node', [path.join(repo, 'scripts', argv[0]!), ...argv.slice(1), '--at', at, '--base', base], {
        cwd: repo,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return true;
    } catch {
      return false;
    }
  };
  const guard = (at: string, base: string) => walk(['check-feature-list.mjs'], at, base);
  const journal = (at: string, base: string) => walk(['progress.mjs', 'check'], at, base);
  const RUN = '20260916T100000Z';
  const entry = (title: string, evidence: string) =>
    `## 2026-09-16 — ${title}\n\n- **Feature**: none closed\n- **Result**: passing\n- **Verified by**: x\n- **Evidence**: ${evidence}\n- **Contract changes**: none\n- **Notes**:\n\n  n.\n`;
  const closing = (title: string, evidence: string) => entry(title, evidence).replace('none closed', 'closed #3');

  beforeAll(() => {
    repo = mkdtempSync(path.join(tmpdir(), 'attest-merge-'));
    mkdirSync(path.join(repo, 'scripts'));
    mkdirSync(path.join(repo, 'specs'));
    // The guard asks a committed closure for its audit, so the fixture needs
    // the receipt's writer and what it imports, and a closing commit here
    // does what /verify-task does: writes the audit, then commits it.
    for (const f of ['check-feature-list.mjs', 'harness-config.mjs', 'audit-log.mjs', 'audit-receipt.mjs', 'verify-receipt.mjs', 'progress.mjs', 'verify-log.mjs', 'check-migrations.mjs']) {
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
    // The journal the walk reads too, since 2026-09-16: a prose entry from
    // before the rule at the seed, an entry naming the run the branch's
    // first closing commit carries, and a last commit whose entry points at
    // nothing, for the refusal.
    writeFileSync(path.join(repo, 'PROGRESS.md'), `# Progress\n\n${entry('before the rule', 'the run recorded for this tree')}`);
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
      if (id === 0) {
        mkdirSync(path.join(repo, 'verify-log'), { recursive: true });
        writeFileSync(path.join(repo, 'verify-log', `${RUN}.json`), '{"at":"2026-09-16T10:00:00.000Z","result":"pass","tree":"sha256:a","steps":{}}\n');
        writeFileSync(path.join(repo, 'PROGRESS.md'), `# Progress\n\n${entry('before the rule', 'the run recorded for this tree')}\n${entry('the work', `verify-log/${RUN}`)}`);
      }
      execFileSync('node', [path.join(repo, 'scripts', 'audit-receipt.mjs'), 'write', '--spec', 'specs/c.md', '--verdict', 'READY'], { cwd: repo, stdio: 'ignore' });
      git('add', '-A');
      git('commit', '-qm', `close #${id}`);
    }
    // One commit that opens, closes, audits and journals #3 — the shape a
    // small feature takes since 2026-09-16 — walked like the others.
    entries.push({ id: 3, category: 'x', description: 'born closed', steps: ['s'], passes: true, spec: 'specs/c.md' });
    write(entries);
    execFileSync('node', [path.join(repo, 'scripts', 'audit-receipt.mjs'), 'write', '--spec', 'specs/c.md', '--verdict', 'READY'], { cwd: repo, stdio: 'ignore' });
    const auditId = readdirSync(path.join(repo, 'audit-log')).map((n) => n.replace(/\.json$/u, '')).sort().pop() ?? '';
    writeFileSync(path.join(repo, 'PROGRESS.md'), `# Progress\n\n${entry('before the rule', 'the run recorded for this tree')}\n${entry('the work', `verify-log/${RUN}`)}\n${closing('closed #3 in one commit', `verify-log/${RUN}; audit-log/${auditId}`)}`);
    git('add', '-A');
    git('commit', '-qm', 'open and close #3 in one commit');
    writeFileSync(path.join(repo, 'PROGRESS.md'), `# Progress\n\n${entry('before the rule', 'the run recorded for this tree')}\n${entry('the work', `verify-log/${RUN}`)}\n${closing('closed #3 in one commit', `verify-log/${RUN}; audit-log/${auditId}`)}\n${entry('pointing nowhere', 'the log')}`);
    git('add', '-A');
    git('commit', '-qm', 'a journal entry pointing nowhere');
    git('checkout', '-q', 'main');
    git('merge', '-q', '--no-ff', '-m', 'merge work', 'work');
  });

  it('accepts the commit that opened, closed, audited and journaled #3 at once, under every guard of the walk', () => {
    // The four lines the workflow runs per commit, each on this one.
    const commit = git('rev-list', '-1', '--grep', 'open and close #3', 'HEAD^2');
    expect(commit).not.toBe('');
    expect(guard(commit, `${commit}^`)).toBe(true);
    expect(walk(['verify-log.mjs', 'check'], commit, `${commit}^`)).toBe(true);
    expect(walk(['check-migrations.mjs'], commit, `${commit}^`)).toBe(true);
    expect(journal(commit, `${commit}^`)).toBe(true);
  });

  it('runs the journal check on each commit the way the workflow does: the entry naming its run passes, the one pointing nowhere is refused', () => {
    // The workflow names `progress.mjs check --at --base` in its walk; this
    // is the same command on the same shape of commits, so the walk is shown
    // to run and to refuse, not only to be written down.
    const commits = git('rev-list', '--reverse', 'HEAD^..HEAD^2').trim().split('\n');
    const last = commits[commits.length - 1]!;
    expect(git('log', '-1', '--format=%s', last)).toBe('a journal entry pointing nowhere');
    for (const commit of commits.slice(0, -1)) {
      // Run it by hand here so a refusal says why, instead of a bare false.
      const out = execFileSync('node', [path.join(repo, 'scripts', 'progress.mjs'), 'check', '--at', commit, '--base', `${commit}^`], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      expect(out).toContain('evidence on record');
    }
    expect(journal(last, `${last}^`)).toBe(false);
    // The seed's prose entry is old at every baseline the walk uses.
    expect(journal('HEAD', 'HEAD^2')).toBe(true);
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
