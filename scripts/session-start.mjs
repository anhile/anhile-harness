#!/usr/bin/env node
/**
 * The session-start ritual, performed rather than remembered. A Claude Code
 * `SessionStart` hook: whatever this prints is added to the session's context.
 *
 * CLAUDE.md asks every session to begin with `git log`, the newest PROGRESS.md
 * entries, and one open entry from feature_list.json — and until 2026-09-08
 * that was a paragraph a session could skip. This prints exactly those things,
 * so the ritual costs nothing and cannot be forgotten. It changes nothing in
 * the repository.
 *
 * It also records what HEAD was when the session began, under .generated/, so
 * scripts/session-stop.mjs can tell later whether work landed without a
 * PROGRESS.md entry. On a resume or a compaction the record is kept: the
 * session is the same one.
 *
 * Never blocks. A ritual that could stop the session from starting would be
 * a gate on the wrong side of the work.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KEEP, plan } from './progress.mjs';
import { describe, latestRun } from './check-main.mjs';

export const root = realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));

function git(...args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

export function sessionFile(sessionId) {
  const safe = String(sessionId || 'unknown').replace(/[^A-Za-z0-9_.-]/gu, '_');
  return path.join(root, '.generated', 'sessions', `${safe}.json`);
}

/** The newest `## YYYY-MM-DD — title` heading in PROGRESS.md, with its date. */
export function newestEntry(progress) {
  const headings = [...progress.matchAll(/^## (\d{4}-\d{2}-\d{2}) — (.+)$/gmu)];
  if (headings.length === 0) return null;
  const last = headings[headings.length - 1];
  return { date: last[1], title: last[2].trim() };
}

/** Entries that are neither passing nor retracted, with their positions. */
export function openEntries(featureList) {
  return featureList
    .map((entry, index) => ({ index, ...entry }))
    .filter((entry) => entry.passes === false && !entry.retracted);
}

function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export function briefing() {
  const lines = [];
  const head = git('rev-parse', 'HEAD');
  const branch = git('branch', '--show-current') || '(detached)';
  const ahead = git('rev-list', '--count', 'origin/main..HEAD');
  const behind = git('rev-list', '--count', 'HEAD..origin/main');
  const status = git('status', '--short');

  lines.push('# Session start (CLAUDE.md ritual, printed by scripts/session-start.mjs)');
  lines.push('');
  lines.push(`Branch ${branch} at ${head.slice(0, 7)}` +
    (ahead !== '' ? `, ${ahead} ahead / ${behind} behind origin/main` : ', no origin/main to compare'));
  if (status) {
    const rows = status.split('\n');
    lines.push(`Working tree: ${rows.length} changed path(s), a person's uncommitted work — leave it alone:`);
    for (const row of rows.slice(0, 8)) lines.push(`  ${row}`);
    if (rows.length > 8) lines.push(`  … and ${rows.length - 8} more`);
  } else {
    lines.push('Working tree clean.');
  }
  lines.push('');
  lines.push('Last commits:');
  for (const row of git('log', '--oneline', '-8').split('\n').filter(Boolean)) lines.push(`  ${row}`);

  lines.push('');
  const progressFile = path.join(root, 'PROGRESS.md');
  const progress = existsSync(progressFile) ? readFileSync(progressFile, 'utf8') : '';
  const newest = newestEntry(progress);
  lines.push(newest
    ? `Newest PROGRESS.md entry: ${newest.date} — ${newest.title}. Read the last few entries, not the file.`
    : 'PROGRESS.md has no dated entries.');
  const due = progress ? plan(progress).moving.length : 0;
  if (due > 0) lines.push(`PROGRESS.md carries ${due} entr${due === 1 ? 'y' : 'ies'} older than the newest ${KEEP}: run \`pnpm progress rotate\` (moves, never edits).`);

  lines.push('');
  const featureList = readJson(path.join(root, 'feature_list.json'), []);
  const open = Array.isArray(featureList) ? openEntries(featureList) : [];
  if (open.length === 0) {
    lines.push('feature_list.json: every entry is closed. There is nothing to pick — say so and ask, rather than inventing a task.');
  } else {
    lines.push(`feature_list.json: ${open.length} open entr${open.length === 1 ? 'y' : 'ies'}. Pick one, and only one:`);
    for (const entry of open) {
      const text = String(entry.description ?? '');
      lines.push(`  #${entry.id ?? entry.index} [${entry.category ?? '?'}] ${text.length > 110 ? `${text.slice(0, 107)}…` : text}`);
    }
  }
  // Whether `main` is green, printed before the housekeeping rather than after
  // it. Nothing asked this until 2026-09-11, and main was red for three merges
  // while four pull requests were opened on top of it: each one's own checks
  // were watched, and the branch they merged into was watched by nobody.
  const state = describe(latestRun());
  if (state.line !== null && !(state.ok && !state.unclear && !state.running)) {
    lines.push('');
    lines.push(state.line);
  }

  lines.push('');
  lines.push('If the work touches the UI, run ./init.sh and create one link through the browser first.');
  lines.push('End the session with an entry in PROGRESS.md; scripts/session-stop.mjs checks that committed work has one.');
  return `${lines.join('\n')}\n`;
}

function record(payload) {
  const file = sessionFile(payload.session_id);
  // A resumed or compacted session is the same session: keep its baseline.
  if (existsSync(file) && payload.source && payload.source !== 'startup' && payload.source !== 'clear') return;
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify({
      startedAt: new Date().toISOString(),
      head: git('rev-parse', 'HEAD') || null,
      reminded: false,
    })}\n`);
  } catch {
    /* a record that cannot be written must not stop the session */
  }
}

function main() {
  let payload = {};
  try {
    payload = JSON.parse(readFileSync(0, 'utf8') || '{}');
  } catch {
    payload = {};
  }
  record(payload);
  process.stdout.write(briefing());
  process.exit(0);
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main();
}
