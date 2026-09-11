#!/usr/bin/env node
/**
 * Is `main` green?
 *
 * Nothing asked this until 2026-09-11, and `main` was red for three merges
 * before anybody noticed. The pull requests were watched one at a time; the
 * branch they were merging into was watched by nobody, which is a gap rather
 * than an oversight — there was no place the answer appeared.
 *
 * So it appears in two places a person already reads: the session-start
 * ritual, and `check-pr-ready.mjs` when a branch is about to become a pull
 * request. It never refuses. A red `main` is often exactly why somebody is
 * opening a pull request, and a guard that blocks the fix for the thing it is
 * complaining about is a guard that gets removed.
 *
 *   node scripts/check-main.mjs           # a line, or nothing it could learn
 *   node scripts/check-main.mjs --json
 */
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = realpathSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
);

/** The default branch this asks about. */
export const BRANCH = 'main';

/**
 * What the run means, in words rather than in a status code.
 *
 * `cancelled` is deliberately not "fine". A cancelled run on `main` is usually
 * concurrency: a second push arrived and superseded the first. That is normal
 * and it is also how a genuine failure hides, because the last *completed*
 * run can be a cancellation for weeks while nothing green has run at all.
 */
export function describe(run) {
  if (run === null) return { known: false, ok: true, line: null };

  const { conclusion, status, displayTitle, url, createdAt } = run;

  if (status !== 'completed') {
    return {
      known: true,
      ok: true,
      running: true,
      line: `${BRANCH}: a run is still going (${displayTitle ?? 'no title'}).`,
    };
  }

  if (conclusion === 'success') {
    return { known: true, ok: true, line: `${BRANCH}: green.` };
  }

  if (conclusion === 'cancelled' || conclusion === 'skipped') {
    return {
      known: true,
      ok: true,
      unclear: true,
      line:
        `${BRANCH}: the last completed run was ${conclusion}, so nothing has actually passed on it. ` +
        `Usually a later push superseded it. ${url ?? ''}`.trim(),
    };
  }

  return {
    known: true,
    ok: false,
    line:
      `${BRANCH} IS RED — ${conclusion} on "${displayTitle ?? 'no title'}"${createdAt ? ` (${createdAt.slice(0, 16).replace('T', ' ')})` : ''}.\n` +
      `  ${url ?? ''}\n`.trimEnd() +
      '\n  Whatever else you were about to do, this is older and worse. A branch opened on a red\n' +
      '  main inherits its failure, and three of them were opened that way before anybody looked.',
  };
}

/** The newest run for the branch, or null when nothing here can tell. */
export function latestRun() {
  try {
    const raw = execFileSync(
      'gh',
      [
        'run',
        'list',
        '--workflow',
        'verify.yml',
        '--branch',
        BRANCH,
        '--limit',
        '1',
        '--json',
        'conclusion,status,displayTitle,url,createdAt',
      ],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000 },
    );
    const [run] = JSON.parse(raw);
    return run ?? null;
  } catch {
    // No gh, no network, no permission, no CI at all. Every one of those means
    // this cannot say anything, and saying nothing is the honest answer.
    return null;
  }
}

function main() {
  const verdict = describe(latestRun());
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(verdict, null, 2));
    return;
  }
  if (verdict.line !== null) console.log(verdict.line);
  // Exit zero whatever the answer. This reports; it does not refuse.
}

if (realpathSync(process.argv[1] ?? '') === realpathSync(fileURLToPath(import.meta.url))) {
  main();
}
