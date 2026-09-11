#!/usr/bin/env node
// @ts-check
/**
 * PROGRESS.md: its shape, and its size.
 *
 * The journal is the one file every session reads at start and writes at
 * end, so it has to stay cheap to read and uniform to write. Neither was
 * true on 2026-09-08: 42 entries, 96 KB, and twelve of them in a shape the
 * template had already replaced. The archive under docs/history/ existed and
 * was filled by hand, once.
 *
 *   check    every entry has the heading `## YYYY-MM-DD — title` and the six
 *            fields of the template, and dates never go backwards. A test in
 *            step 03 runs this against the real file.
 *   rotate   moves every entry but the newest dozen into
 *            docs/history/PROGRESS-<YYYY-MM>.md by the entry's month, text
 *            untouched. Nothing is edited, only moved. session-start.mjs says
 *            when it is due; a person runs it.
 *   status   entries, size, and how many rotate would move.
 *
 * The template lives here and session-stop.mjs prints it from here, so the
 * shape a session is asked for and the shape check refuses cannot disagree.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from './harness-config.mjs';
import { fileURLToPath } from 'node:url';

export const root = realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
export const FILE = 'PROGRESS.md';
export const HISTORY_DIR = path.join('docs', 'history');
export const KEEP = 12;

export const FIELDS = ['Feature', 'Result', 'Verified by', 'Evidence', 'Contract changes', 'Notes'];

export function template(date = new Date().toISOString().slice(0, 10)) {
  return [
    `## ${date} — <what this session did, as a title>`,
    '',
    '- **Feature**: <closed #n — "<description>", or: none closed>',
    '- **Result**: <passing | partial | blocked>',
    '- **Verified by**: <`./verify.sh` n/n; the CI run URL>',
    '- **Evidence**: <the `verify-log.jsonl` lines for this session>',
    `- **Contract changes**: <none, or the \`${loadConfig().contracts.package ?? 'shared contracts'}\` sign-off (I4)>`,
    '- **Notes**:',
    '',
    '  <what was decided, what was found, what is left — the reasons, not the diff>',
  ].join('\n');
}

const HEADING = /^## (\d{4}-\d{2}-\d{2}) — (.+)$/u;

/**
 * One entry of the journal: its heading line, what the heading said, and the
 * text from it to the next heading.
 * @typedef {{ heading: string, date: string | null, title: string | null, body: string, index: number }} Entry
 */

/**
 * The file as a header plus entries, each entry the text from its heading to the next.
 * @param {string} text
 */
export function parse(text) {
  const lines = text.split('\n');
  /** @type {number[]} */
  const starts = [];
  // A heading inside a fenced block is text — the header carries the template
  // in one, and the template's own heading must not count as an entry.
  let fenced = false;
  lines.forEach((line, i) => {
    if (/^\s*```/u.test(line)) { fenced = !fenced; return; }
    if (!fenced && line.startsWith('## ')) starts.push(i);
  });
  const header = lines.slice(0, starts[0] ?? lines.length).join('\n');
  const entries = starts.map((start, n) => {
    const end = starts[n + 1] ?? lines.length;
    const body = lines.slice(start, end).join('\n');
    const heading = lines[start] ?? '';
    const m = heading.match(HEADING);
    return { heading, date: m?.[1] ?? null, title: m?.[2]?.trim() ?? null, body, index: n };
  });
  return { header, entries };
}

/**
 * Problems with one entry's shape, as sentences.
 * @param {Entry} entry
 * @param {Entry | undefined} previous
 */
export function problemsOf(entry, previous) {
  /** @type {string[]} */
  const out = [];
  if (!entry.date) out.push(`heading is not \`## YYYY-MM-DD — title\`: ${entry.heading}`);
  for (const field of FIELDS) {
    if (!new RegExp(`^- \\*\\*${field}\\*\\*:`, 'mu').test(entry.body)) out.push(`missing \`- **${field}**:\``);
  }
  if (entry.date && previous?.date && entry.date < previous.date) {
    out.push(`dated ${entry.date}, before the entry above it (${previous.date}); newest goes at the bottom`);
  }
  return out;
}

/** @param {string} text */
export function check(text) {
  const { entries } = parse(text);
  /** @type {string[]} */
  const problems = [];
  entries.forEach((entry, i) => {
    for (const p of problemsOf(entry, entries[i - 1])) problems.push(`entry ${i + 1} (${entry.heading.slice(3, 60)}): ${p}`);
  });
  return { entries: entries.length, problems };
}

/**
 * Which entries rotate would move, grouped by month. Never the newest KEEP.
 * @param {string} text
 * @param {number} [keep]
 */
export function plan(text, keep = KEEP) {
  const { header, entries } = parse(text);
  const moving = entries.slice(0, Math.max(0, entries.length - keep));
  /** @type {Map<string, Entry[]>} */
  const byMonth = new Map();
  for (const e of moving) {
    const month = (e.date ?? 'undated').slice(0, 7);
    const list = byMonth.get(month) ?? [];
    list.push(e);
    byMonth.set(month, list);
  }
  return { header, keep: entries.slice(moving.length), moving, byMonth };
}

/** @param {string} month */
function archiveHeader(month) {
  return [
    `# Progress log — archive, ${month}`,
    '',
    'The closed part of the log: entries that stopped being context for the next',
    'session. Nothing here is edited, only moved, by `pnpm progress rotate`. The live',
    'log is [PROGRESS.md](../../PROGRESS.md).',
    '',
    '---',
    '',
  ].join('\n');
}

/**
 * @param {string} text
 * @param {number} [keep]
 */
export function rotate(text, keep = KEEP) {
  const { header, keep: kept, moving, byMonth } = plan(text, keep);
  if (moving.length === 0) return { moved: 0, files: [], live: text };
  /** @type {string[]} */
  const files = [];
  for (const [month, entries] of byMonth) {
    const file = path.join(root, HISTORY_DIR, `PROGRESS-${month}.md`);
    mkdirSync(path.dirname(file), { recursive: true });
    const chunk = entries.map((e) => e.body.replace(/\n+$/u, '')).join('\n\n');
    if (existsSync(file)) appendFileSync(file, `\n${chunk}\n`);
    else writeFileSync(file, `${archiveHeader(month)}${chunk}\n`);
    files.push(path.relative(root, file));
  }
  const live = `${header.replace(/\n+$/u, '')}\n\n${kept.map((e) => e.body.replace(/\n+$/u, '')).join('\n\n')}\n`;
  writeFileSync(path.join(root, FILE), live);
  return { moved: moving.length, files, live };
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  const text = readFileSync(path.join(root, FILE), 'utf8');
  const keepArg = args.indexOf('--keep');
  const keep = keepArg === -1 ? KEEP : Number(args[keepArg + 1]);

  if (command === 'check') {
    const { entries, problems } = check(text);
    if (problems.length === 0) {
      console.log(`progress: ${entries} entries, every one in the template's shape`);
      return;
    }
    console.error(`progress: ${problems.length} problem(s) in ${FILE}`);
    for (const p of problems) console.error(`  - ${p}`);
    console.error(`\nThe shape, printed by session-stop.mjs when it is missing:\n\n${template()}\n`);
    process.exit(1);
  }
  if (command === 'status') {
    const { moving } = plan(text, keep);
    const total = parse(text).entries.length;
    const kb = (text.length / 1024).toFixed(0);
    console.log(`progress: ${total} entries, ${kb} KB, ${moving.length} older than the newest ${keep}` +
      (moving.length ? ' — run `pnpm progress rotate`' : ''));
    return;
  }
  if (command === 'rotate') {
    const { moved, files } = rotate(text, keep);
    if (moved === 0) { console.log(`progress: nothing older than the newest ${keep}; nothing moved`); return; }
    console.log(`progress: moved ${moved} entr${moved === 1 ? 'y' : 'ies'} into ${files.join(', ')}`);
    return;
  }
  if (command === 'template') { console.log(template()); return; }
  console.error('usage: progress.mjs check | status | rotate [--keep N] | template');
  process.exit(2);
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main();
}
