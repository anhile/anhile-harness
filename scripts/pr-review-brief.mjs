#!/usr/bin/env node
// @ts-check
/**
 * The facts a reviewer should not have to re-derive, assembled once.
 *
 * Several reviewers looking at one change is only worth the tokens if they
 * disagree about *judgement*. Left to gather their own context they disagree
 * about facts instead — which entries this claims, whether the attack surface
 * moved, what the evidence line says — and the reader then arbitrates trivia
 * while the real question goes unasked. Every reviewer gets this identical
 * brief, so a disagreement means something.
 *
 * It states, and never interprets. "The diff touches apps/api/src/controller"
 * is a fact; "this is risky" is a reviewer's job.
 *
 *   node scripts/pr-review-brief.mjs            # against origin/main
 *   node scripts/pr-review-brief.mjs --json
 */
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './harness-config.mjs';

export const root = realpathSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
);

/** @param {...string} args */
const git = (...args) => {
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
    }).trim();
  } catch {
    return '';
  }
};

/**
 * The attack surface, copied from the rule /verify-task already follows so the
 * two cannot drift into disagreeing about what counts.
 */
export const SURFACE = loadConfig().attackSurface.paths;

/**
 * Entries whose `passes` or `retracted` differs between two revisions.
 * @param {string} before
 * @param {string} after
 */
export function entryChanges(before, after) {
  /**
   * @param {string} raw
   * @returns {Map<number, any>}
   */
  const parse = (raw) => {
    try {
      const parsed = JSON.parse(raw);
      /** @type {any[]} */
      const list = Array.isArray(parsed) ? parsed : (parsed.entries ?? []);
      return new Map(list.map((e) => [e.id, e]));
    } catch {
      return new Map();
    }
  };
  const was = parse(before);
  const now = parse(after);

  /** @type {{ id: number, spec: string | null, passes: boolean }[]} */
  const opened = [];
  /** @type {{ id: number, spec: string | null }[]} */
  const closed = [];
  /** @type {{ id: number, supersededBy: number | null }[]} */
  const retracted = [];

  for (const [id, entry] of now) {
    const previous = was.get(id);
    if (previous === undefined) {
      opened.push({ id, spec: entry.spec ?? null, passes: entry.passes === true });
      continue;
    }
    if (previous.passes !== true && entry.passes === true) {
      closed.push({ id, spec: entry.spec ?? null });
    }
    if (previous.retracted === undefined && entry.retracted !== undefined) {
      retracted.push({ id, supersededBy: entry.retracted.supersededBy ?? null });
    }
  }
  return { opened, closed, retracted };
}

/**
 * The newest recorded run at a revision, as the reviewer should quote it.
 * @param {string} raw
 * @returns {{ at: string, result: string | null, tree: string | null } | null}
 */
export function newestRun(raw) {
  const lines = raw.split('\n').filter((l) => l.trim() !== '');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      const parsed = JSON.parse(lines[i] ?? '');
      if (typeof parsed.at === 'string') {
        return { at: parsed.at, result: parsed.result ?? null, tree: parsed.tree ?? null };
      }
    } catch {
      /* the append-only guard's business, not this one's */
    }
  }
  return null;
}

/** @param {string[]} files */
export function surfaceTouched(files) {
  return SURFACE.filter((prefix) => files.some((f) => f.startsWith(prefix)));
}

export function brief() {
  const base = git('rev-parse', '--verify', '--quiet', 'origin/main') === '' ? 'main' : 'origin/main';
  const mergeBase = git('merge-base', base, 'HEAD');
  const range = mergeBase === '' ? null : `${mergeBase}..HEAD`;

  const files = range === null ? [] : git('diff', '--name-only', range).split('\n').filter(Boolean);
  const commits =
    range === null ? [] : git('log', '--format=%h %s', range).split('\n').filter(Boolean);

  const entries = entryChanges(
    git('show', `${mergeBase}:feature_list.json`),
    git('show', 'HEAD:feature_list.json'),
  );

  const specs = [
    ...new Set(
      [...entries.opened, ...entries.closed]
        .map((e) => e.spec)
        .filter((s) => typeof s === 'string'),
    ),
  ];

  return {
    branch: git('branch', '--show-current') || null,
    base,
    range,
    commits,
    files,
    entries,
    specs,
    evidence: newestRun(git('show', 'HEAD:verify-log.jsonl')),
    surface: surfaceTouched(files),
    journal: files.includes('PROGRESS.md'),
    tests: files.filter((f) => f.endsWith('.spec.ts') || f.includes('/test/')),
    protectedFiles: files.filter((f) =>
      [
        'verify.sh',
        '.github/workflows/verify.yml',
        '.claude/settings.json',
        'scripts/check-commit-gate.mjs',
        'scripts/check-protected-files.mjs',
        'scripts/verify-receipt.mjs',
        'scripts/audit-receipt.mjs',
      ].includes(f),
    ),
  };
}

/**
 * The brief as the reviewers read it. Facts only; no adjectives.
 * @param {ReturnType<typeof brief>} b
 */
export function render(b) {
  /** @type {string[]} */
  const lines = [];
  /** @param {string[]} items */
  const list = (items) => (items.length === 0 ? 'none' : items.join(', '));

  lines.push(`Branch ${b.branch ?? '(detached)'} against ${b.base}, range ${b.range ?? '(none)'}`);
  lines.push('');
  lines.push(`Commits (${b.commits.length}):`);
  for (const c of b.commits) lines.push(`  ${c}`);
  lines.push('');
  lines.push(`Files changed: ${b.files.length}`);
  lines.push(`Test files among them: ${list(b.tests)}`);
  lines.push(`Protected files among them: ${list(b.protectedFiles)}`);
  lines.push('');
  lines.push('Entries claimed by this change:');
  lines.push(`  opened:    ${b.entries.opened.length === 0 ? 'none' : b.entries.opened.map((e) => `#${e.id}`).join(', ')}`);
  lines.push(`  closed:    ${b.entries.closed.length === 0 ? 'none' : b.entries.closed.map((e) => `#${e.id}`).join(', ')}`);
  lines.push(`  retracted: ${b.entries.retracted.length === 0 ? 'none' : b.entries.retracted.map((e) => `#${e.id}`).join(', ')}`);
  lines.push(`  contracts: ${list(b.specs)}`);
  lines.push('');
  lines.push(
    b.evidence === null
      ? 'Evidence: no recorded run on this branch'
      : `Evidence: ${b.evidence.at}  ${String(b.evidence.result).toUpperCase()}  ${b.evidence.tree}`,
  );
  lines.push(`Journal entry on this branch: ${b.journal ? 'yes' : 'no'}`);
  lines.push('');
  lines.push(
    b.surface.length === 0
      ? 'Attack surface: unchanged, so no security review is required'
      : `Attack surface touched: ${b.surface.join(', ')}`,
  );
  return lines.join('\n');
}

function main() {
  const b = brief();
  console.log(process.argv.includes('--json') ? JSON.stringify(b, null, 2) : render(b));
}

if (realpathSync(process.argv[1] ?? '') === realpathSync(fileURLToPath(import.meta.url))) {
  main();
}
