/**
 * Upgrade: a project init wrote earlier takes this version's harness files,
 * and nothing of its own moves. Fired at through the shipped command on a
 * real scaffold, aged by hand into what an earlier version would have left.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const REPO = path.resolve(__dirname, '..', '..');
const INIT = path.join(REPO, 'scripts', 'harness-init.mjs');
const UPGRADE = path.join(REPO, 'scripts', 'harness-upgrade.mjs');

const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function scaffold(extra: string[] = []): string {
  const dir = path.join(mkdtempSync(path.join(tmpdir(), 'harness-upgrade-')), 'probe');
  made.push(path.dirname(dir));
  execFileSync('node', [INIT, '--yes', '--name', 'probe', '--into', dir, ...extra], { cwd: REPO, encoding: 'utf8' });
  return dir;
}

type Result = { status: number; out: string };
function upgrade(dir: string, ...args: string[]): Result {
  const result = spawnSync('node', [UPGRADE, '--into', dir, ...args], { cwd: REPO, encoding: 'utf8' });
  return { status: result.status ?? -1, out: `${result.stdout}${result.stderr}` };
}

const read = (dir: string, rel: string) => readFileSync(path.join(dir, rel), 'utf8');
const aboveBlock = (text: string) => text.slice(0, text.indexOf('run_step 01 '));
const blockOf = (text: string) => text.split('\n').filter((l) => /^run_step \d\d /u.test(l));

/** What an earlier version would have left: a file missing, another older, the old step line, a package and a key gone. */
function age(dir: string): { agents: string; list: string; config: string; pkg: string; steps: string[] } {
  unlinkSync(path.join(dir, '.claude', 'agents', 'design-review.md'));
  writeFileSync(path.join(dir, 'scripts', 'verify-receipt.mjs'), '// an earlier version\n');
  const gate = read(dir, 'verify.sh')
    .replace(/^run_step 03 unit\s+unit_suites$/mu, 'run_step 03 unit         pnpm exec jest --config jest.config.cjs')
    .replace(/^FULL_ONLY=.*\n/mu, '');
  writeFileSync(path.join(dir, 'verify.sh'), gate);
  const pkg = JSON.parse(read(dir, 'package.json')) as { devDependencies: Record<string, string> };
  delete pkg.devDependencies['tailwind-merge'];
  writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
  const config = JSON.parse(read(dir, 'harness.config.json')) as Record<string, unknown>;
  delete config.ui;
  writeFileSync(path.join(dir, 'harness.config.json'), `${JSON.stringify(config, null, 2)}\n`);
  return { agents: read(dir, 'AGENTS.md'), list: read(dir, 'feature_list.json'), config: read(dir, 'harness.config.json'), pkg: read(dir, 'package.json'), steps: blockOf(gate) };
}

describe('upgrade', () => {
  it('refuses a directory that is not a project this harness wrote', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'harness-upgrade-not-'));
    made.push(dir);
    const result = upgrade(dir);
    expect(result.status).toBe(1);
    expect(result.out).toContain('has no harness.config.json');
    expect(existsSync(path.join(dir, 'verify.sh'))).toBe(false);
  });

  it('finds nothing to write on a project this version just wrote', () => {
    const dir = scaffold(['--web']);
    const before = read(dir, 'verify.sh');
    const result = upgrade(dir);
    expect(result.status).toBe(0);
    expect(result.out).toContain('project: database no, api no, web yes');
    expect(result.out).toMatch(/files: [1-9]\d* harness file\(s\) — [1-9]\d* same, 0 to update, 0 new/u);
    expect(result.out).toContain('verify.sh: same');
    expect(result.out).toContain('packages: every one the manifest names is at its version');
    expect(result.out).toContain('config: harness.config.json has every optional key');
    expect(result.out).toContain('Nothing to write. The files are this version already.');
    expect(read(dir, 'verify.sh')).toBe(before);

    // The other answers, read from the configuration and the API's directory:
    // migrate.mjs and pg travel with a database, and the count still closes.
    const other = upgrade(scaffold(['--database', '--api']));
    expect(other.status).toBe(0);
    expect(other.out).toContain('project: database yes, api yes, web no');
    expect(other.out).toMatch(/[1-9]\d* same, 0 to update, 0 new/u);
    expect(other.out).toContain('packages: every one the manifest names is at its version');
    expect(other.out).toContain('Nothing to write.');
  });

  it('plans what an older project lacks, and writes nothing without --yes', () => {
    const dir = scaffold(['--web']);
    age(dir);
    const result = upgrade(dir);
    expect(result.status).toBe(0);
    expect(result.out).toContain('project: database no, api no, web yes');
    expect(result.out).toMatch(/files: \d+ harness file\(s\) — \d+ same, 1 to update, 1 new/u);
    expect(result.out).toContain('new     .claude/agents/design-review.md');
    expect(result.out).toContain('update  scripts/verify-receipt.mjs');
    expect(result.out).toContain("verify.sh: to update — the mechanism from this version, the project's 6 step(s) kept (03 unit → unit_suites)");
    expect(result.out).toMatch(/pnpm add -D tailwind-merge@\S+/u);
    expect(result.out).toContain('tailwind-merge: absent →');
    expect(result.out).toContain('ui.paths: the generator would write ["apps/web/src/"]');
    expect(result.out).toContain('Dry run. Nothing written; run again with --yes');
    expect(existsSync(path.join(dir, '.claude', 'agents', 'design-review.md'))).toBe(false);
    expect(read(dir, 'scripts/verify-receipt.mjs')).toBe('// an earlier version\n');
    expect(read(dir, 'verify.sh')).toContain('run_step 03 unit         pnpm exec jest');
  });

  it('--yes writes the harness files and the gate, and leaves the project\'s own files alone', () => {
    const dir = scaffold(['--web']);
    const was = age(dir);
    const result = upgrade(dir, '--yes');
    expect(result.status).toBe(0);
    expect(result.out).toContain('Wrote 3 file(s). Now ./verify.sh, and commit what it passed.');
    expect(read(dir, '.claude/agents/design-review.md')).toBe(readFileSync(path.join(REPO, '.claude', 'agents', 'design-review.md'), 'utf8'));
    expect(read(dir, 'scripts/verify-receipt.mjs')).toBe(readFileSync(path.join(REPO, 'scripts', 'verify-receipt.mjs'), 'utf8'));
    const gate = read(dir, 'verify.sh');
    expect(aboveBlock(gate)).toBe(aboveBlock(readFileSync(path.join(REPO, 'verify.sh'), 'utf8')));
    expect(blockOf(gate).map((l) => l.replace(/\s+/gu, ' '))).toEqual(
      was.steps.map((l) => l.replace(/\s+/gu, ' ').replace('pnpm exec jest --config jest.config.cjs', 'unit_suites')),
    );
    expect(execFileSync('test', ['-x', path.join(dir, 'verify.sh')], { encoding: 'utf8' })).toBe('');
    // The project's own files, byte for byte as before.
    expect(read(dir, 'AGENTS.md')).toBe(was.agents);
    expect(read(dir, 'feature_list.json')).toBe(was.list);
    expect(read(dir, 'harness.config.json')).toBe(was.config);
    expect(read(dir, 'package.json')).toBe(was.pkg);
    // A second run: the files are this version now; the package and the key are still the project's to add.
    const again = upgrade(dir);
    expect(again.out).toMatch(/\d+ same, 0 to update, 0 new/u);
    expect(again.out).toContain('verify.sh: same');
    expect(again.out).toContain('tailwind-merge: absent →');
    expect(again.out).toContain('ui.paths');
  });

  it('keeps a step the table does not know, re-renders a deferred one it does, and refuses a gate with no steps', () => {
    const dir = scaffold();
    const gate = read(dir, 'verify.sh').replace(
      /^run_step 08 coverage.*$/mu,
      (line) => `${line}\nrun_step 09 migrations   node scripts/check-migrations.mjs --old-flag\nrun_step 10 licence      ./scripts/licence-check.sh`,
    );
    writeFileSync(path.join(dir, 'verify.sh'), gate);
    const result = upgrade(dir, '--yes');
    expect(result.status).toBe(0);
    expect(result.out).toContain("the project's 8 step(s) kept (09 migrations → node scripts/check-migrations.mjs)");
    const block = blockOf(read(dir, 'verify.sh')).map((l) => l.replace(/\s+/gu, ' '));
    expect(block).toContain('run_step 09 migrations node scripts/check-migrations.mjs');
    expect(block).toContain('run_step 10 licence ./scripts/licence-check.sh');

    writeFileSync(path.join(dir, 'verify.sh'), '#!/usr/bin/env bash\n');
    const refused = upgrade(dir);
    expect(refused.status).toBe(1);
    expect(refused.out).toContain('no run_step block');
  });

  it('travels in the manifest\'s core, and the bin names the command', () => {
    const manifest = JSON.parse(readFileSync(path.join(REPO, 'harness.manifest.json'), 'utf8')) as { core: { scripts: string[] } };
    expect(manifest.core.scripts).toContain('scripts/harness-upgrade.mjs');
    const bin = readFileSync(path.join(REPO, 'bin', 'harness.mjs'), 'utf8');
    expect(bin).toContain("command === 'upgrade'");
    expect(bin).toContain('  upgrade [--into <dir>] [--yes]');
    expect(bin).not.toContain('Not yet here');
    const usage = execFileSync('node', [path.join(REPO, 'bin', 'harness.mjs'), '--help'], { encoding: 'utf8' });
    expect(usage).toContain('upgrade [--into <dir>] [--yes]');
    // And the README no longer lists upgrading under what this does not do.
    const readme = readFileSync(path.join(REPO, 'README.md'), 'utf8');
    expect(readme).toContain('## Upgrading');
    expect(readme).not.toContain('keeps the snapshot it was given');
  });
});
