/**
 * The quick run: `./verify.sh --quick [--base <ref>]` runs lint, types, the
 * suites affected since the base and the guards, leaves api-e2e, browser-e2e
 * and coverage to the full gate, and is recorded as quick. What takes a quick
 * run and what does not is fired at where each reader lives (commit-gate,
 * audit-receipt, feature-list); here is the gate itself, and the receipt and
 * record that carry the mode.
 *
 * The gate is run for real, in a throwaway repository, with `pnpm` shimmed
 * to a script that logs what it was asked and exits 0. What is asserted is
 * what the gate wrote: the summary, steps.jsonl, the receipt, the record.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const REPO = path.resolve(__dirname, '..', '..');
const SCRIPTS = ['verify-receipt.mjs', 'verify-log.mjs', 'audit-log.mjs'];

let repo: string;
let shims: string;

const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const node = (script: string, ...args: string[]) =>
  execFileSync('node', [path.join(repo, 'scripts', script), ...args], { cwd: repo, encoding: 'utf8' });

/** The gate as copied, with its step block replaced: the steps a case wants and nothing that needs a database. */
function writeGate(block: string[]): void {
  const source = readFileSync(path.join(REPO, 'verify.sh'), 'utf8').split('\n');
  const first = source.findIndex((l) => /^run_step 01 /u.test(l));
  const last = source.reduce((at, l, i) => (/^run_step \d\d /u.test(l) ? i : at), -1);
  const gate = path.join(repo, 'verify.sh');
  writeFileSync(gate, [...source.slice(0, first), ...block, ...source.slice(last + 1)].join('\n'));
  chmodSync(gate, 0o755);
}

type Run = { status: number; stderr: string; summary: string; steps: string[]; asked: string[] };

function gate(...args: string[]): Run {
  const log = path.join(repo, 'pnpm.log');
  const result = spawnSync(path.join(repo, 'verify.sh'), args, {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${shims}${path.delimiter}${process.env.PATH ?? ''}`, PNPM_LOG: log },
  });
  const runs = path.join(repo, '.generated', 'runs');
  const newest = existsSync(runs) ? readdirSync(runs).sort().pop() : undefined;
  const dir = newest ? path.join(runs, newest) : null;
  const readIf = (file: string) => (dir && existsSync(path.join(dir, file)) ? readFileSync(path.join(dir, file), 'utf8') : '');
  return {
    status: result.status ?? -1,
    stderr: result.stderr,
    summary: readIf('summary.txt'),
    steps: readIf('steps.jsonl').split('\n').filter(Boolean).map((l) => String((JSON.parse(l) as { step: string }).step)),
    asked: existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : [],
  };
}

beforeEach(() => {
  repo = realpathSync(mkdtempSync(path.join(tmpdir(), 'quick-gate-')));
  mkdirSync(path.join(repo, 'scripts'));
  for (const s of SCRIPTS) copyFileSync(path.join(REPO, 'scripts', s), path.join(repo, 'scripts', s));
  writeFileSync(path.join(repo, '.gitignore'), '.generated/\nnode_modules/\npnpm.log\n');
  writeFileSync(
    path.join(repo, 'harness.config.json'),
    JSON.stringify({ database: { testSuffix: '_test', exampleName: 'thing_test' }, ports: { api: 3100, web: 5273 } }),
  );
  // Present, so the gate does not try to install.
  mkdirSync(path.join(repo, 'node_modules'));
  writeFileSync(path.join(repo, 'source.ts'), 'export const answer = 42;\n');
  shims = path.join(repo, 'shims');
  mkdirSync(shims);
  writeFileSync(path.join(shims, 'pnpm'), '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$PNPM_LOG"\nexit 0\n');
  chmodSync(path.join(shims, 'pnpm'), 0o755);
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  git('add', '-A');
  git('commit', '-qm', 'main');
  git('checkout', '-q', '-b', 'work');
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe('the gate under --quick', () => {
  const FULL = ['run_step 01 eslint       pnpm exec eslint .', 'run_step 02 typecheck    pnpm exec tsc -b', 'run_step 03 unit         unit_suites'];
  const WITH_LEFT = [...FULL, 'run_step 04 api-e2e      api_e2e', 'run_step 05 browser-e2e  browser_e2e', 'run_step 08 coverage     node scripts/check-coverage.mjs'];

  it('skips api-e2e, browser-e2e and coverage by name, runs the affected suites, and records the run as quick', () => {
    writeGate(WITH_LEFT);
    const run = gate('--quick');
    expect(run.status).toBe(0);
    expect(run.summary).toContain('mode:   quick (since main; api-e2e browser-e2e coverage left to the full gate)');
    expect(run.summary).toMatch(/^SKIP {2}04 api-e2e {2}\(quick: left to the full gate\)$/mu);
    expect(run.summary).toMatch(/^SKIP {2}05 browser-e2e /mu);
    expect(run.summary).toMatch(/^SKIP {2}08 coverage /mu);
    expect(run.summary).toContain('RESULT: PASS (3/3 steps)');
    // Not run, not recorded: a zero for a step nothing reached is a verdict.
    expect(run.steps).toEqual(['01-eslint', '02-typecheck', '03-unit']);
    expect(run.asked).toContain('exec jest --config jest.config.cjs --changedSince main --coverage=false');

    const receipt = JSON.parse(readFileSync(path.join(repo, '.generated', 'receipt.json'), 'utf8')) as Record<string, unknown>;
    expect(receipt.status).toBe('pass');
    expect(receipt.mode).toBe('quick');
    expect(receipt.quickBase).toBe('main');
    const [record] = readdirSync(path.join(repo, 'verify-log')).map((n) => JSON.parse(readFileSync(path.join(repo, 'verify-log', n), 'utf8')) as Record<string, unknown>);
    expect(record?.mode).toBe('quick');
    expect(record?.since).toBe('main');
    expect(Object.keys(record?.steps as object)).toEqual(['01-eslint', '02-typecheck', '03-unit']);
  });

  it('takes another base with --base, and asks jest for what changed since it', () => {
    writeGate(FULL);
    const run = gate('--quick', '--base', 'HEAD');
    expect(run.status).toBe(0);
    expect(run.summary).toContain('mode:   quick (since HEAD;');
    expect(run.asked).toContain('exec jest --config jest.config.cjs --changedSince HEAD --coverage=false');
  });

  it('without --quick runs the whole suite and records the run as full', () => {
    writeGate(FULL);
    const run = gate();
    expect(run.status).toBe(0);
    expect(run.summary).toContain('mode:   full');
    expect(run.summary).not.toContain('SKIP');
    expect(run.asked).toContain('exec jest --config jest.config.cjs');
    expect(run.asked.some((a) => a.includes('--changedSince'))).toBe(false);
    const receipt = JSON.parse(readFileSync(path.join(repo, '.generated', 'receipt.json'), 'utf8')) as Record<string, unknown>;
    expect(receipt.mode).toBe('full');
    expect(receipt.quickBase).toBeNull();
  });

  it('refuses an unknown argument rather than running something other than what was asked', () => {
    writeGate(FULL);
    const run = gate('--fast');
    expect(run.status).toBe(2);
    expect(run.stderr).toContain('unknown argument --fast');
    expect(run.asked).toEqual([]);
  });

  it('refuses a base that is not a commit, naming --base', () => {
    writeGate(FULL);
    const run = gate('--quick', '--base', 'nowhere');
    expect(run.status).toBe(2);
    expect(run.stderr).toContain('nowhere, which is not a commit here');
    expect(run.stderr).toContain('--base <ref>');
    expect(run.asked).toEqual([]);
  });
});

describe('the receipt and the record', () => {
  const write = (...extra: string[]) => {
    const before = node('verify-receipt.mjs', 'hash').trim();
    return node('verify-receipt.mjs', 'write', '--status', 'pass', '--evidence', '.generated/runs/20260916T150000Z', '--tree-before', before, ...extra);
  };
  const receipt = () => JSON.parse(readFileSync(path.join(repo, '.generated', 'receipt.json'), 'utf8')) as Record<string, unknown>;
  const append = () => {
    mkdirSync(path.join(repo, '.generated', 'runs', '20260916T150000Z'), { recursive: true });
    node('verify-log.mjs', 'append', '--evidence', '.generated/runs/20260916T150000Z');
    return JSON.parse(readFileSync(path.join(repo, 'verify-log', '20260916T150000Z.json'), 'utf8')) as Record<string, unknown>;
  };

  it('carries mode and the base from --mode quick --base, into the record too', () => {
    write('--mode', 'quick', '--base', 'main');
    expect(receipt().mode).toBe('quick');
    expect(receipt().quickBase).toBe('main');
    const record = append();
    expect(record.mode).toBe('quick');
    expect(record.since).toBe('main');
    expect(node('verify-log.mjs', 'tail')).toContain('(quick, since main)');
  });

  it('is full without --mode, with no base, and a record from before the flag reads as full', () => {
    write();
    expect(receipt().mode).toBe('full');
    expect(receipt().quickBase).toBeNull();
    const record = append();
    expect(record.mode).toBe('full');
    expect(record.since).toBeNull();
    const isQuick = execFileSync('node', ['--input-type=module', '-e', `import { isQuick } from '${path.join(repo, 'scripts', 'verify-receipt.mjs')}'; console.log(isQuick({ at: 'x', result: 'pass' }), isQuick(null), isQuick({ mode: 'quick' }))`], { encoding: 'utf8' });
    expect(isQuick.trim()).toBe('false false true');
  });

  it('refuses a mode that is neither full nor quick', () => {
    const before = node('verify-receipt.mjs', 'hash').trim();
    const result = spawnSync('node', [path.join(repo, 'scripts', 'verify-receipt.mjs'), 'write', '--status', 'pass', '--evidence', 'x', '--tree-before', before, '--mode', 'fast'], { cwd: repo, encoding: 'utf8' });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('--mode must be full or quick, not "fast"');
    expect(existsSync(path.join(repo, '.generated', 'receipt.json'))).toBe(false);
  });
});
