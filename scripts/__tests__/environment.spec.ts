import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * The environment check, fired at through `--from`, which lets the suite put
 * this machine into states it cannot be put into on demand: no Docker, a
 * node three majors out, a project with no database.
 *
 * The case this file exists for is the last one. The check used to demand a
 * Docker daemon of every project, because the project it was written in had
 * a database; a generated project without one reported a missing requirement
 * for a step it does not run, and a check that is wrong once is a check
 * people stop reading.
 */
const REPO = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(REPO, 'scripts', 'check-environment.mjs');

type Finding = { name: string; ok: boolean; optional?: boolean; detail: string; remedy: string | null };

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const healthy = {
  nvmrc: '22.18.0',
  nodeVersion: 'v22.18.0',
  pnpm: true,
  databaseRequired: false,
  docker: false,
  dockerRunning: false,
  env: 'absent',
  nodeModules: true,
  ports: { 3100: true, 5273: true },
  gh: false,
  ghAuth: false,
};

function evaluate(facts: Record<string, unknown>): { status: number; findings: Finding[] } {
  const dir = mkdtempSync(path.join(tmpdir(), 'environment-'));
  dirs.push(dir);
  const file = path.join(dir, 'facts.json');
  writeFileSync(file, JSON.stringify(facts));
  try {
    const out = execFileSync('node', [SCRIPT, '--from', file, '--json'], { cwd: REPO, encoding: 'utf8' });
    return { status: 0, findings: JSON.parse(out) as Finding[] };
  } catch (error) {
    const err = error as { status?: number; stdout?: string };
    return { status: err.status ?? 1, findings: JSON.parse(err.stdout ?? '[]') as Finding[] };
  }
}

const named = (findings: Finding[], name: string) => findings.find((f) => f.name === name);

describe('what a project without a database is asked for', () => {
  it('passes with no Docker at all', () => {
    const { status, findings } = evaluate(healthy);
    expect(status).toBe(0);
    expect(named(findings, 'docker')).toBeUndefined();
    expect(named(findings, 'docker daemon')).toBeUndefined();
  });

  it('never counts .env against the machine, since the gate has configured values to fall back on', () => {
    const { findings } = evaluate({ ...healthy, env: 'absent' });
    const env = named(findings, '.env');
    expect(env?.optional).toBe(true);
    expect(env?.ok).toBe(true);
    expect(env?.detail).toContain('configured values');
  });
});

describe('what a project with a database is asked for', () => {
  it('asks for Docker and a running daemon, and says which step needs them', () => {
    const { status, findings } = evaluate({ ...healthy, databaseRequired: true });
    expect(status).toBe(1);
    expect(named(findings, 'docker')?.ok).toBe(false);
    expect(named(findings, 'docker')?.remedy).toContain('docker-compose.yml');
    expect(named(findings, 'docker daemon')?.ok).toBe(false);
  });

  it('is satisfied by a daemon that is running', () => {
    const { status } = evaluate({ ...healthy, databaseRequired: true, docker: true, dockerRunning: true });
    expect(status).toBe(0);
  });
});

describe('what every project is asked for', () => {
  it('holds node to the major .nvmrc names, and says how to get it', () => {
    const { status, findings } = evaluate({ ...healthy, nodeVersion: 'v20.11.0' });
    expect(status).toBe(1);
    expect(named(findings, 'node')?.ok).toBe(false);
    expect(named(findings, 'node')?.detail).toContain('.nvmrc asks for v22');
    expect(named(findings, 'node')?.remedy).toContain('22');
  });

  it('reports a taken gate port with the variable that moves it', () => {
    const { status, findings } = evaluate({ ...healthy, ports: { 3100: false, 5273: true } });
    expect(status).toBe(1);
    expect(named(findings, 'port 3100')?.remedy).toContain('VERIFY_');
  });

  it('reports gh and never counts it, since only the pull-request skills need it', () => {
    const { status, findings } = evaluate({ ...healthy, gh: false });
    expect(status).toBe(0);
    expect(named(findings, 'gh')?.optional).toBe(true);
    expect(named(findings, 'gh')?.remedy).toContain('/open-pr');
  });

  it('names no third-party service in any remedy', () => {
    // The check was written in a product with an authentication vendor and
    // once told every reader about its credentials.
    const { findings } = evaluate({ ...healthy, databaseRequired: true, nodeVersion: 'v1.0.0' });
    for (const f of findings) expect(`${f.detail} ${f.remedy ?? ''}`).not.toMatch(/stytch|credentials/iu);
  });
});
