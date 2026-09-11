#!/usr/bin/env node
/**
 * Can this machine run the gate?
 *
 * Written the day a fresh clone turned out not to be able to: a suite built
 * a client for a third-party service while the file was being collected, so
 * a step threw for anyone without credentials — and CI never saw it, because
 * the workflow appended the repository secrets before running the gate. The
 * one environment that could have proved a clone works was the one
 * environment that always had credentials.
 *
 * So this does not narrate a setup. It states what is missing and what fixes
 * it, and then `./verify.sh` is the proof; a setup that ends with "it should
 * work now" has proved nothing, which is the whole subject of this repository.
 *
 *   node scripts/check-environment.mjs
 *   node scripts/check-environment.mjs --json
 *   node scripts/check-environment.mjs --from facts.json   # for the suite
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './harness-config.mjs';

export const root = realpathSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
);

const has = (cmd) => {
  try {
    execFileSync('command', ['-v', cmd], { shell: '/bin/sh', stdio: 'ignore' });
    return true;
  } catch {
    try {
      execFileSync('/bin/sh', ['-c', `command -v ${cmd}`], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }
};

const output = (cmd, args) => {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
};

/** Major version only. The repository pins a patch; a matching major runs it. */
export function majorOf(version) {
  const m = /v?(\d+)\./u.exec(String(version ?? ''));
  return m === null ? null : Number(m[1]);
}

/**
 * Binds `0.0.0.0`, not `127.0.0.1`, and the difference is not pedantry. Docker
 * publishes on all interfaces, and on macOS a loopback bind to a port Docker
 * has published *succeeds* — so the loopback version of this check reported
 * Postgres's own 5433 as free while Postgres was serving on it. A check that
 * answers wrongly is worse than no check, since the reader believes it.
 */
export function portFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '0.0.0.0');
  });
}

/**
 * Findings from facts. Pure, so the suite can put this machine into states no
 * developer machine can be put into on demand — no Docker daemon, a node three
 * majors out, a port already taken.
 */
export function evaluate(facts) {
  const out = [];
  const need = (name, ok, detail, remedy) => out.push({ name, ok, detail, remedy: ok ? null : remedy });

  const wanted = majorOf(facts.nvmrc);
  const found = majorOf(facts.nodeVersion);
  need(
    'node',
    found !== null && wanted !== null && found === wanted,
    found === null ? 'not found' : `v${found}, .nvmrc asks for v${wanted}`,
    `install Node ${wanted} (fnm use ${wanted}, nvm use ${wanted}, or brew install node@${wanted})`,
  );

  need('pnpm', facts.pnpm === true, facts.pnpm === true ? 'present' : 'not on PATH',
    'npm install -g pnpm, or corepack enable');

  // Docker only where the gate will start Postgres. A project without a
  // database (harness.config.json, `database.required`) has no step that
  // needs it, and demanding a daemon for nothing is how a check gets ignored.
  if (facts.databaseRequired === true) {
    need('docker', facts.docker === true, facts.docker === true ? 'present' : 'not on PATH',
      'install Docker; the database steps start Postgres from docker-compose.yml');

    need(
      'docker daemon',
      facts.dockerRunning === true,
      facts.dockerRunning === true ? 'running' : 'not running',
      'start Docker and wait for it to report ready',
    );
  }

  // Never required: verify.sh sources .env when present and falls back to the
  // configured values otherwise. Reported so a reader knows which of the two
  // a run will use.
  out.push({
    name: '.env',
    ok: true,
    optional: true,
    detail: facts.env === 'absent' ? 'absent; the gate uses the configured values' : 'present; the gate sources it',
    remedy: null,
  });

  need(
    'node_modules',
    facts.nodeModules === true,
    facts.nodeModules === true ? 'installed' : 'absent',
    'pnpm install — or let ./verify.sh do it on the first run',
  );

  for (const [port, free] of Object.entries(facts.ports ?? {})) {
    need(
      `port ${port}`,
      free === true,
      free === true ? 'free' : 'in use',
      `something is listening on ${port}; stop it, or set the matching VERIFY_*_PORT`,
    );
  }

  // Not required to run the gate, so reported and never counted against it.
  out.push({
    name: 'gh',
    ok: true,
    optional: true,
    detail:
      facts.gh === true
        ? facts.ghAuth === true
          ? 'present and authenticated'
          : 'present, not authenticated'
        : 'not on PATH',
    remedy:
      facts.gh === true && facts.ghAuth === true
        ? null
        : 'needed only by /open-pr, /review-pr and /address-comments: brew install gh, then gh auth login',
  });

  return out;
}

async function gather() {
  return {
    nvmrc: existsSync(path.join(root, '.nvmrc'))
      ? readFileSync(path.join(root, '.nvmrc'), 'utf8').trim()
      : null,
    nodeVersion: process.version,
    pnpm: has('pnpm'),
    databaseRequired: loadConfig().database.required,
    docker: has('docker'),
    dockerRunning: output('docker', ['info', '--format', '{{.ServerVersion}}']) !== null,
    env: existsSync(path.join(root, '.env')) ? 'present' : 'absent',
    nodeModules: existsSync(path.join(root, 'node_modules')),
    // The gate's own ports only. 5433 is deliberately absent: Postgres is
    // supposed to be listening there, so "free" would be the bad answer and
    // "in use" the good one, and a check whose sense is inverted from its
    // neighbours is a check that gets misread.
    ports: {
      [loadConfig().ports.api]: await portFree(loadConfig().ports.api),
      [loadConfig().ports.web]: await portFree(loadConfig().ports.web),
    },
    gh: has('gh'),
    ghAuth: output('gh', ['auth', 'status']) !== null,
  };
}

export function render(findings) {
  const lines = [];
  const required = findings.filter((f) => f.optional !== true);
  const missing = required.filter((f) => !f.ok);

  for (const f of findings) {
    const mark = f.optional === true ? '·' : f.ok ? 'ok' : 'NO';
    lines.push(`  ${mark.padEnd(3)} ${f.name.padEnd(14)} ${f.detail}`);
    if (f.remedy !== null) lines.push(`        → ${f.remedy}`);
  }
  lines.push('');
  lines.push(
    missing.length === 0
      ? 'Every requirement is met. Run ./verify.sh — that is the proof, not this.'
      : `${missing.length} requirement(s) missing. Fix them, then run ./verify.sh.`,
  );
  return lines.join('\n');
}

async function main() {
  const args = process.argv.slice(2);

  // A probe, so the suite can drive the port check as a process: ts-jest
  // compiles to CommonJS and cannot import this module. Prints `free` or
  // `in use`, which is also the quickest way for a person to ask about a port
  // this script does not check.
  const probeIndex = args.indexOf('--port-free');
  if (probeIndex !== -1) {
    const free = await portFree(Number(args[probeIndex + 1]));
    console.log(free ? 'free' : 'in use');
    process.exit(free ? 0 : 1);
  }

  const fromIndex = args.indexOf('--from');
  const facts =
    fromIndex === -1 ? await gather() : JSON.parse(readFileSync(args[fromIndex + 1], 'utf8'));
  const findings = evaluate(facts);

  console.log(args.includes('--json') ? JSON.stringify(findings, null, 2) : render(findings));
  process.exit(findings.some((f) => f.optional !== true && !f.ok) ? 1 : 0);
}

if (realpathSync(process.argv[1] ?? '') === realpathSync(fileURLToPath(import.meta.url))) {
  await main();
}
