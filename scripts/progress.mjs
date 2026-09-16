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
 *            step 03 runs this against the real file. And, for every entry
 *            new since --base (HEAD), the Evidence field points into the
 *            record: at least one run id that exists under verify-log/, and,
 *            when the entry closes a feature, an audit id under audit-log/
 *            whose verdict was READY. Until 2026-09-16 Evidence was prose —
 *            "the run recorded for this tree" — which reads like a pointer
 *            and points at nothing; a claim a reader cannot follow is the
 *            kind this repository exists to refuse. --at reads the journal
 *            and the records at a commit, so CI walks pushed commits one by
 *            one, as it does for the other append-only files.
 *   rotate   moves every entry but the newest dozen into
 *            docs/history/PROGRESS-<YYYY-MM>.md by the entry's month, text
 *            untouched. Nothing is edited, only moved. session-start.mjs says
 *            when it is due; a person runs it.
 *   status   entries, size, and how many rotate would move.
 *
 * The template lives here and session-stop.mjs prints it from here, so the
 * shape a session is asked for and the shape check refuses cannot disagree.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from './harness-config.mjs';
import { fileURLToPath } from 'node:url';
import { currentFiles as currentRuns, filesAt as runsAt } from './verify-log.mjs';
import { currentFiles as currentAudits, filesAt as auditsAt } from './audit-log.mjs';

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
    '- **Evidence**: <verify-log/<id> — the run(s) made for this work; audit-log/<id> when an entry closed>',
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

/** A run's id as verify-log/ names it, and an audit's as audit-log/ names it. */
const RUN_ID = /\b\d{8}T\d{6}Z\b/gu;
const AUDIT_ID = /\b\d{8}T\d{6}\.\d{3}Z\b/gu;

/**
 * One field's text: from its line to the next field or the end of the entry.
 * @param {Entry} entry
 * @param {string} field
 */
export function fieldOf(entry, field) {
  const m = new RegExp(`^- \\*\\*${field}\\*\\*:([\\s\\S]*?)(?=^- \\*\\*|$(?![\\s\\S]))`, 'mu').exec(entry.body);
  return (m?.[1] ?? '').trim();
}

/**
 * What the Evidence field points at.
 * @param {Entry} entry
 */
export function evidenceOf(entry) {
  const text = fieldOf(entry, 'Evidence');
  return {
    runs: [...new Set(text.match(RUN_ID) ?? [])],
    audits: [...new Set(text.match(AUDIT_ID) ?? [])],
  };
}

/**
 * Does the entry close a feature: its Feature field says `closed #n` and
 * does not begin with "none".
 * @param {Entry} entry
 */
export function closesFeature(entry) {
  const feature = fieldOf(entry, 'Feature');
  return /closed #\d+/iu.test(feature) && !/^none\b/iu.test(feature);
}

/**
 * The record as ids: the runs on file, and the audits with their verdicts.
 * From the working tree, or from a commit.
 * @param {string} [ref]
 * @returns {{ runs: Set<string>, audits: Map<string, string | null> }}
 */
export function recordAt(ref) {
  const runFiles = ref === undefined ? currentRuns() : runsAt(ref);
  const auditFiles = ref === undefined ? currentAudits() : auditsAt(ref);
  /** @type {Map<string, string | null>} */
  const audits = new Map();
  for (const [name, text] of auditFiles) {
    let verdict = null;
    try {
      verdict = JSON.parse(text).verdict ?? null;
    } catch {
      /* the log's guard refuses it; here it is an audit with no verdict */
    }
    audits.set(name.replace(/\.json$/u, ''), verdict);
  }
  return { runs: new Set([...runFiles.keys()].map((n) => n.replace(/\.json$/u, ''))), audits };
}

/**
 * Why an entry's Evidence does not point into the record, as sentences;
 * empty when it does.
 * @param {Entry} entry
 * @param {{ runs: Set<string>, audits: Map<string, string | null> }} record
 */
export function pointerProblems(entry, record) {
  /** @type {string[]} */
  const out = [];
  const { runs, audits } = evidenceOf(entry);
  if (runs.length === 0) out.push('Evidence names no run: a `verify-log/<id>` is what a reader follows');
  for (const id of runs) if (!record.runs.has(id)) out.push(`Evidence names run ${id}, which is not under verify-log/`);
  if (closesFeature(entry) && audits.length === 0) {
    out.push('closes a feature and Evidence names no audit: the `audit-log/<id>` that said READY');
  }
  for (const id of audits) {
    if (!record.audits.has(id)) out.push(`Evidence names audit ${id}, which is not under audit-log/`);
    else if (record.audits.get(id) !== 'READY') out.push(`Evidence names audit ${id}, which said ${record.audits.get(id) ?? '(nothing)'}, not READY`);
  }
  return out;
}

/**
 * The entries in `text` whose heading is not in `baseText`: what a commit,
 * or a session, added. Headings, not positions, so a rotation that moved
 * the older entries out does not make the newest ones look new.
 * @param {string} text
 * @param {string} baseText
 */
export function newSince(text, baseText) {
  const known = new Set(parse(baseText).entries.map((e) => e.heading));
  return parse(text).entries.filter((e) => !known.has(e.heading));
}

/**
 * What the base had that the text no longer has as it was: an entry known at
 * the base whose body changed, or which is gone and not in the archive.
 * Since 2026-09-16 the journal is outside the tree hash, so this is what
 * stands between a green run and a quietly reworded past. Rotation moves
 * entries to docs/history/ unchanged, and a moved entry is found there.
 * @param {string} text
 * @param {string} baseText
 * @param {Map<string, string>} archived the entries under docs/history/, body by heading
 */
export function keptSince(text, baseText, archived) {
  const trim = (/** @type {string} */ s) => s.replace(/\s+$/u, '');
  const now = new Map(parse(text).entries.map((e) => [e.heading, trim(e.body)]));
  /** @type {string[]} */
  const problems = [];
  for (const entry of parse(baseText).entries) {
    const body = now.get(entry.heading);
    const label = `entry (${entry.heading.slice(3, 60)})`;
    if (body === undefined) {
      const moved = archived.get(entry.heading);
      if (moved === undefined) problems.push(`${label} is gone: the journal is append-only, and rotate moves an entry to ${HISTORY_DIR}/, never removes it`);
      else if (moved !== trim(entry.body)) problems.push(`${label} was moved to ${HISTORY_DIR}/ and edited there: rotate moves an entry as it was`);
    } else if (body !== trim(entry.body)) {
      problems.push(`${label} was edited after the base: the journal is append-only, and a correction is a new entry`);
    }
  }
  return problems;
}

/**
 * The entries under docs/history/, body by heading, in the working tree or
 * at a commit.
 * @param {string | null} [at]
 * @returns {Map<string, string>}
 */
export function archivedEntries(at = null) {
  /** @type {string[]} */
  const texts = [];
  try {
    if (at) {
      const names = execFileSync('git', ['ls-tree', '-r', '--name-only', at, `${HISTORY_DIR}/`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').filter(Boolean);
      for (const name of names) texts.push(execFileSync('git', ['show', `${at}:${name}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
    } else if (existsSync(path.join(root, HISTORY_DIR))) {
      for (const name of readdirSync(path.join(root, HISTORY_DIR))) {
        if (name.endsWith('.md')) texts.push(readFileSync(path.join(root, HISTORY_DIR, name), 'utf8'));
      }
    }
  } catch {
    // No archive at that commit: nothing is archived there.
  }
  return new Map(texts.flatMap((t) => parse(t).entries.map((e) => [e.heading, e.body.replace(/\s+$/u, '')])));
}

/** @param {string} ref */
function journalAt(ref) {
  try {
    return execFileSync('git', ['show', `${ref}:${FILE}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

/**
 * The shape of every entry, and the pointers of the new ones. `baseText`
 * null means no baseline — a first commit, a repository without one — and
 * then only the shape is asked.
 * @param {string} text
 * @param {{ baseText?: string | null, record?: ReturnType<typeof recordAt>, archived?: Map<string, string> }} [against]
 */
export function check(text, { baseText = null, record, archived = new Map() } = {}) {
  const { entries } = parse(text);
  /** @type {string[]} */
  const problems = [];
  entries.forEach((entry, i) => {
    for (const p of problemsOf(entry, entries[i - 1])) problems.push(`entry ${i + 1} (${entry.heading.slice(3, 60)}): ${p}`);
  });
  if (baseText !== null) problems.push(...keptSince(text, baseText, archived));
  const fresh = baseText === null ? [] : newSince(text, baseText);
  if (fresh.length > 0) {
    const rec = record ?? recordAt();
    for (const entry of fresh) {
      for (const p of pointerProblems(entry, rec)) problems.push(`entry ${entry.index + 1} (${entry.heading.slice(3, 60)}): ${p}`);
    }
  }
  return { entries: entries.length, fresh: fresh.length, problems };
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

/**
 * @param {string[]} args
 * @param {string} name
 * @param {string | null} [fallback]
 */
function flag(args, name, fallback = null) {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : (args[i + 1] ?? fallback);
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  const keepArg = args.indexOf('--keep');
  const keep = keepArg === -1 ? KEEP : Number(args[keepArg + 1]);

  if (command === 'check') {
    const at = flag(args, 'at');
    const base = flag(args, 'base', 'HEAD') ?? 'HEAD';
    const text = at ? (journalAt(at) ?? '') : readFileSync(path.join(root, FILE), 'utf8');
    const baseText = journalAt(base);
    const { entries, fresh, problems } = check(text, { baseText, record: recordAt(at ?? undefined), archived: archivedEntries(at) });
    if (problems.length === 0) {
      console.log(`progress: ${entries} entries, every one in the template's shape` +
        (baseText === null ? `; no baseline at ${base}, evidence not asked` : `; ${fresh} new since ${base}, evidence on record, the rest as ${base} had them`));
      return;
    }
    console.error(`progress: ${problems.length} problem(s) in ${FILE}`);
    for (const p of problems) console.error(`  - ${p}`);
    console.error(`\nThe shape, printed by session-stop.mjs when it is missing:\n\n${template()}\n`);
    process.exit(1);
  }
  const text = readFileSync(path.join(root, FILE), 'utf8');
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
  console.error('usage: progress.mjs check [--base <ref>] [--at <ref>] | status | rotate [--keep N] | template');
  process.exit(2);
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main();
}
