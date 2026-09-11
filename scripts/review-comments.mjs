#!/usr/bin/env node
// @ts-check
/**
 * Every comment on a pull request, and which of them are still unanswered.
 *
 * The rule this serves is one sentence: **no comment is silently dropped.**
 * A session that reads six comments, acts on four, and reports on three has
 * not reviewed anything — it has sampled. Enumerating them with stable ids,
 * outside the session's memory, is what makes "all of them" checkable.
 *
 * Bots are filtered and *counted*, never quietly discarded. The only comment on
 * the first pull request this mechanism was written against was a Vercel
 * deployment notice, which a skill told to "address every comment" would have
 * dutifully tried to address.
 *
 *   node scripts/review-comments.mjs 12
 *   node scripts/review-comments.mjs 12 --json
 *   node scripts/review-comments.mjs --from fixture.json      # no network
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = realpathSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
);

/**
 * Accounts whose comments are machinery talking to itself. Filtering by a
 * suffix rather than a list would catch a person called `anything-bot`, and
 * GitHub already marks these: `type: "Bot"` where the API says so, and these
 * names where it does not.
 */
export const BOTS = new Set([
  'vercel',
  'vercel[bot]',
  'dependabot',
  'dependabot[bot]',
  'github-actions',
  'github-actions[bot]',
  'codecov',
  'codecov[bot]',
]);

/**
 * A comment in the one shape this script reads, whatever GitHub called it.
 * @typedef {{
 *   id: string,
 *   kind: 'inline' | 'review' | 'conversation',
 *   author: string | null,
 *   bot: boolean,
 *   at: string | null,
 *   path: string | null,
 *   line: number | null,
 *   inReplyTo: string | null,
 *   body: string,
 *   state?: string | null,
 * }} Comment
 */

/**
 * @param {unknown} author
 * @param {unknown} type
 */
export const isBot = (author, type) =>
  type === 'Bot' || BOTS.has(String(author ?? '').toLowerCase());

/**
 * One shape for three things GitHub keeps apart: inline comments on a diff
 * line, the body of a review, and general comments on the conversation.
 * The three inputs are GitHub's own JSON, read field by field below.
 * @param {{ reviewComments?: any[], reviews?: any[], issueComments?: any[] }} raw
 * @returns {Comment[]}
 */
export function normalise({ reviewComments = [], reviews = [], issueComments = [] }) {
  /** @type {Comment[]} */
  const out = [];

  for (const c of reviewComments) {
    out.push({
      id: `rc-${c.id}`,
      kind: 'inline',
      author: c.user?.login ?? null,
      bot: isBot(c.user?.login, c.user?.type),
      at: c.created_at ?? null,
      path: c.path ?? null,
      line: c.line ?? c.original_line ?? null,
      inReplyTo: c.in_reply_to_id === undefined ? null : `rc-${c.in_reply_to_id}`,
      body: (c.body ?? '').trim(),
    });
  }

  for (const r of reviews) {
    const body = (r.body ?? '').trim();
    // A review with no body is an approval or a request for changes carrying
    // only its inline comments. There is nothing to answer in it.
    if (body === '') continue;
    out.push({
      id: `rv-${r.id}`,
      kind: 'review',
      author: r.user?.login ?? r.author?.login ?? null,
      bot: isBot(r.user?.login ?? r.author?.login, r.user?.type),
      at: r.submitted_at ?? r.submittedAt ?? null,
      state: r.state ?? null,
      path: null,
      line: null,
      inReplyTo: null,
      body,
    });
  }

  for (const c of issueComments) {
    out.push({
      id: `ic-${c.id}`,
      kind: 'conversation',
      author: c.user?.login ?? c.author?.login ?? null,
      bot: isBot(c.user?.login ?? c.author?.login, c.user?.type),
      at: c.created_at ?? c.createdAt ?? null,
      path: null,
      line: null,
      inReplyTo: null,
      body: (c.body ?? '').trim(),
    });
  }

  return out.sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

/**
 * A comment is answered when something replies to it. For an inline comment
 * that is a reply in its thread; for the rest, nothing here can tell, so they
 * are reported as needing an answer and the session says what it did.
 *
 * Deliberately not "answered if the author commented later anywhere": a later
 * comment about something else is not an answer, and treating it as one is how
 * a thread goes quiet without being resolved.
 * @param {Comment[]} comments
 */
export function outstanding(comments) {
  const repliedTo = new Set(comments.map((c) => c.inReplyTo).filter(Boolean));
  return comments.filter((c) => !c.bot && c.inReplyTo === null && !repliedTo.has(c.id));
}

/** @param {string | undefined} pr */
function fetchFor(pr) {
  const repo = execFileSync('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  /** @param {string} suffix */
  const api = (suffix) =>
    JSON.parse(
      execFileSync('gh', ['api', `repos/${repo}/${suffix}`, '--paginate'], {
        cwd: root,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      }),
    );
  return {
    reviewComments: api(`pulls/${pr}/comments`),
    reviews: api(`pulls/${pr}/reviews`),
    issueComments: api(`issues/${pr}/comments`),
  };
}

/** @param {Comment[]} comments */
export function render(comments) {
  const bots = comments.filter((c) => c.bot);
  const open = outstanding(comments);
  /** @type {string[]} */
  const lines = [];

  lines.push(`${comments.length} comment(s): ${open.length} awaiting an answer, ${bots.length} from bots`);
  if (bots.length > 0) {
    lines.push(`  bots filtered: ${[...new Set(bots.map((b) => b.author))].join(', ')}`);
  }
  lines.push('');

  if (open.length === 0) {
    lines.push('Nothing is waiting on a reply.');
    return lines.join('\n');
  }

  for (const c of open) {
    const where = c.path === null ? c.kind : `${c.path}:${c.line ?? '?'}`;
    lines.push(`[ ] ${c.id}  ${c.author ?? 'unknown'}  ${where}`);
    for (const l of c.body.split('\n').slice(0, 4)) lines.push(`      ${l}`);
    if (c.body.split('\n').length > 4) lines.push('      …');
    lines.push('');
  }
  lines.push('Every id above needs one of: changed, explained, declined, or moved to its own entry.');
  return lines.join('\n');
}

function main() {
  const args = process.argv.slice(2);
  const fromIndex = args.indexOf('--from');
  const raw =
    fromIndex === -1
      ? fetchFor(args.find((a) => /^\d+$/u.test(a)))
      : JSON.parse(readFileSync(args[fromIndex + 1] ?? '', 'utf8'));

  const comments = normalise(raw);
  console.log(args.includes('--json') ? JSON.stringify(comments, null, 2) : render(comments));
}

if (realpathSync(process.argv[1] ?? '') === realpathSync(fileURLToPath(import.meta.url))) {
  main();
}
