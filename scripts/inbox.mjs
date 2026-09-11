#!/usr/bin/env node
/**
 * The inbox, checked before intake reads it.
 *
 * specs/inbox/<slug>.md is the local source for /task-intake, beside the
 * Features database in Notion. What Notion enforces with a schema — a status
 * property with four options, a name, an owner — a file enforces with this.
 * It is also the mechanical half of intake's first three gates: the sections
 * are present, every criterion parses as one of the five EARS patterns, and
 * at least one is an unwanted-behaviour criterion. Judgement — conflicts,
 * the constitution — stays with the skill.
 *
 *   list            every inbox file with its status and name
 *   check <file>    exit 0 when intake may read it; the problems otherwise
 *   status <file>   the status alone, for a script to branch on
 *
 * The file is data: nothing here executes or follows anything in it.
 */
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load as loadYaml } from 'js-yaml';

export const root = realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
export const INBOX = path.join('specs', 'inbox');
export const STATUSES = ['Draft', 'Ready for intake', 'In progress', 'Done'];
export const SECTIONS = ['Problem', 'In scope', 'Out of scope', 'Acceptance criteria', 'Open questions'];

/** The five EARS patterns, each as the shape its sentence must take. */
export const PATTERNS = {
  ubiquitous: /^The .+ shall .+/u,
  'event-driven': /^When .+, the .+ shall .+/u,
  'state-driven': /^While .+, the .+ shall .+/u,
  unwanted: /^If .+, then the .+ shall .+/u,
  optional: /^Where .+, the .+ shall .+/u,
};

const CRITERION = /^- \*\*AC-(\d+)\*\* \(([\w-]+)\) — (.+)$/u;

export function parse(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n/u);
  let front = null;
  let frontError = null;
  if (m) {
    try {
      front = loadYaml(m[1]);
    } catch (error) {
      frontError = error.message.split('\n')[0];
    }
  }
  const body = m ? text.slice(m[0].length) : text;
  const sections = [...body.matchAll(/^## (.+)$/gmu)].map((h) => h[1].trim());
  const criteria = body.split('\n').filter((line) => /^- \*\*AC-/u.test(line)).map((line) => {
    const c = line.match(CRITERION);
    return c ? { id: Number(c[1]), pattern: c[2], sentence: c[3].trim(), line } : { line, malformed: true };
  });
  return { front, frontError, sections, criteria };
}

/** Everything wrong with the file, as sentences; empty when intake may read it. */
export function problemsOf(text, { requireReady = true } = {}) {
  const { front, frontError, sections, criteria } = parse(text);
  const out = [];
  if (frontError) return [`front-matter does not parse: ${frontError}`];
  if (!front || typeof front !== 'object') return ['no front-matter: the file must start with a --- block naming name, status, owner and updated'];
  for (const key of ['name', 'status', 'owner', 'updated']) {
    if (front[key] === undefined || front[key] === null || String(front[key]).trim() === '' || /^<.*>$/u.test(String(front[key]).trim())) {
      out.push(`front-matter: "${key}" is missing or still the template's placeholder`);
    }
  }
  if (front.status !== undefined && !STATUSES.includes(front.status)) {
    out.push(`front-matter: "status" is "${front.status}", must be exactly one of ${STATUSES.join(', ')}`);
  } else if (requireReady && front.status !== 'Ready for intake') {
    out.push(`status is "${front.status}", not "Ready for intake": a person sets that, and intake waits for it`);
  }
  if (front.updated !== undefined && !/^\d{4}-\d{2}-\d{2}$/u.test(String(front.updated instanceof Date ? front.updated.toISOString().slice(0, 10) : front.updated))) {
    out.push(`front-matter: "updated" must be a YYYY-MM-DD date`);
  }
  for (const s of SECTIONS) if (!sections.includes(s)) out.push(`missing section "## ${s}"`);
  if (criteria.length === 0) out.push('no acceptance criteria: at least one line `- **AC-n** (pattern) — sentence`');
  const seen = new Set();
  for (const c of criteria) {
    if (c.malformed) { out.push(`criterion is not \`- **AC-n** (pattern) — sentence\`: ${c.line}`); continue; }
    if (seen.has(c.id)) out.push(`AC-${c.id} appears twice`);
    seen.add(c.id);
    const re = PATTERNS[c.pattern];
    if (!re) { out.push(`AC-${c.id}: pattern "${c.pattern}" is not one of ${Object.keys(PATTERNS).join(', ')}`); continue; }
    if (!re.test(c.sentence)) out.push(`AC-${c.id} does not read as ${c.pattern}: ${c.sentence}`);
    if (/<[^>]+>/u.test(c.sentence)) out.push(`AC-${c.id} still carries a template placeholder`);
    if (/\bshall\b.*\band\b.*\bshall\b/u.test(c.sentence)) out.push(`AC-${c.id} names two responses; one criterion, one behaviour`);
  }
  if (criteria.length > 0 && !criteria.some((c) => c.pattern === 'unwanted')) {
    out.push('no unwanted-behaviour criterion: the failure paths are not specified');
  }
  return out;
}

function fileArg(args) {
  const rel = args[0];
  if (!rel) { console.error('inbox: a file is required'); process.exit(2); }
  const abs = path.resolve(root, rel);
  const inside = path.relative(path.join(root, INBOX), abs);
  if (inside.startsWith('..') || path.isAbsolute(inside)) {
    console.error(`inbox: ${rel} is not under ${INBOX}/. Intake reads the inbox and the Notion database, nothing else.`);
    process.exit(1);
  }
  if (!existsSync(abs)) { console.error(`inbox: ${rel} does not exist`); process.exit(1); }
  return { rel, text: readFileSync(abs, 'utf8') };
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'list') {
    const dir = path.join(root, INBOX);
    const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'README.md' && f !== 'TEMPLATE.md').sort() : [];
    if (files.length === 0) { console.log(`inbox: nothing in ${INBOX}/`); return; }
    for (const f of files) {
      const { front } = parse(readFileSync(path.join(dir, f), 'utf8'));
      console.log(`  ${String(front?.status ?? '(no status)').padEnd(18)} ${path.join(INBOX, f)}  ${front?.name ?? ''}`);
    }
    return;
  }
  if (command === 'status') {
    const { text } = fileArg(args);
    console.log(parse(text).front?.status ?? '(no status)');
    return;
  }
  if (command === 'check') {
    const { rel, text } = fileArg(args);
    const problems = problemsOf(text, { requireReady: !args.includes('--any-status') });
    if (problems.length === 0) { console.log(`inbox: ${rel} — ready for intake to read`); return; }
    console.error(`inbox: ${rel} — ${problems.length} problem(s), intake does not proceed`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.error('usage: inbox.mjs list | check <file> [--any-status] | status <file>');
  process.exit(2);
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main();
}
