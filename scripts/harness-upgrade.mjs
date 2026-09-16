#!/usr/bin/env node
// @ts-check
/**
 * Upgrade: a project that adopted an earlier version takes this version's
 * harness files.
 *
 * `init` writes a snapshot and, until 2026-09-16, that was the whole of it:
 * a project kept the harness it was born with, and the CHANGELOG carried a
 * list of files to copy by hand for each version. This does the copying, and
 * only that. What is the harness's — the scripts the manifest names, the
 * agents, the skills, the workflow, the templates under specs/, and
 * verify.sh above its step block — is written from this version. What is
 * the project's — AGENTS.md, CLAUDE.md, feature_list.json, PROGRESS.md,
 * coverage-floor.json, docs/DOMAIN_RULES.md, harness.config.json,
 * package.json, the applications — is not touched: a project's own files
 * carry its history, and an upgrade that edits them is a merge nobody asked
 * for. The step block of verify.sh is the project's too, in the sense that
 * matters: which steps it has. Their commands come from this version's
 * table, so a renamed command (step 03 became `unit_suites`) follows; a step
 * the table does not know is kept as it is.
 *
 * Packages and configuration keys are reported, never written: package.json
 * needs pnpm to keep the lockfile honest, and a new optional key in
 * harness.config.json is a decision about the project. The report prints
 * the line to run and the value the generator would write.
 *
 * Without --yes it is a plan: what would be new, what would change, what
 * is already the same. With --yes it writes. Either way, ./verify.sh next.
 *
 *   node scripts/harness-upgrade.mjs [--into <dir>] [--yes]
 *   npx anhile-harness upgrade [--into <dir>] [--yes]
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STEPS, configFor, copiedFiles, dependenciesFor, renderVerify, root } from './harness-init.mjs';
import { OPTIONAL_KEYS } from './harness-config.mjs';
import { API, WEB } from './harness-templates.mjs';

/**
 * The directory an application lives in, read from what the generator
 * writes for it rather than spelled here: the two path segments every file
 * of the template shares. This module reads a layout it did not write, and
 * the one that wrote it is the authority on where.
 * @param {Record<string, unknown>} template
 */
const directoryOf = (template) => (Object.keys(template)[0] ?? '').split('/').slice(0, 2).join('/');

/** @typedef {import('./harness-init.mjs').Answers} Answers */
/** @typedef {import('./harness-init.mjs').Step} Step */

/** @param {string} rel */
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

/**
 * @param {unknown} object
 * @param {string} dotted
 * @returns {unknown}
 */
const at = (object, dotted) =>
  dotted.split('.').reduce((o, key) => (o && typeof o === 'object' ? /** @type {Record<string, unknown>} */ (o)[key] : undefined), object);

/**
 * What the project is, read from what it has: the database from its
 * configuration, the applications from their directories. The generator was
 * asked once and did not record the answers; the directories are the answers.
 * @param {string} into
 * @returns {Answers}
 */
export function answersOf(into) {
  const config = JSON.parse(readFileSync(path.join(into, 'harness.config.json'), 'utf8'));
  /** @param {string} rel */
  const has = (rel) => existsSync(path.join(into, rel));
  const web = has(directoryOf(WEB));
  return {
    name: path.basename(into),
    database: at(config, 'database.required') === true,
    api: has(directoryOf(API)),
    web,
    browser: web || has('e2e'),
    mcp: [],
  };
}

/**
 * The project's gate, upgraded: everything above the step block from this
 * version, the project's steps kept by name and number, each command from
 * this version's table, and a step the table does not know kept as it is.
 * @param {string} projectGate
 * @param {string} source
 * @returns {{ text: string, steps: Step[], renamed: Step[] }}
 */
export function upgradedVerify(projectGate, source) {
  /** @type {Step[]} */
  const present = projectGate.split('\n').flatMap((line) => {
    const m = /^run_step (\d\d) (\S+)\s+(.*)$/u.exec(line);
    return m === null ? [] : [{ n: m[1] ?? '', name: m[2] ?? '', command: (m[3] ?? '').trim(), needs: null }];
  });
  if (present.length === 0) {
    throw new Error("the project's verify.sh has no run_step block, so there is nothing to keep of its steps");
  }
  /** @type {Step[]} */
  const renamed = [];
  const steps = present.map((step) => {
    const known = STEPS.find((k) => k.name === step.name);
    if (known === undefined) return step;
    if (known.command !== step.command) renamed.push({ ...step, command: known.command });
    return { ...step, command: known.command };
  });
  return { text: renderVerify(source, steps), steps, renamed };
}

/**
 * @typedef {{ rel: string, state: 'same' | 'update' | 'new' }} FileState
 * @typedef {{
 *   into: string,
 *   version: string,
 *   answers: Answers,
 *   files: FileState[],
 *   gate: { state: 'same' | 'update' | 'new', text: string, steps: Step[], renamed: Step[] },
 *   packages: { name: string, wanted: string, have: string | null }[],
 *   config: { key: string, value: unknown }[],
 * }} UpgradePlan
 */

/**
 * @param {string} into
 * @returns {UpgradePlan}
 */
export function planUpgrade(into) {
  const configPath = path.join(into, 'harness.config.json');
  if (!existsSync(configPath)) {
    throw new Error(`${into} has no harness.config.json, so it is not a project this harness wrote; upgrade takes the directory init wrote into`);
  }
  const manifest = JSON.parse(read('harness.manifest.json'));
  const version = JSON.parse(read('package.json')).version;
  const answers = answersOf(into);

  /** @type {FileState[]} */
  const files = [];
  for (const rel of copiedFiles(manifest, answers)) {
    const from = path.join(root, rel);
    if (!existsSync(from)) continue;
    const target = path.join(into, rel);
    if (!existsSync(target)) files.push({ rel, state: 'new' });
    else files.push({ rel, state: readFileSync(from).equals(readFileSync(target)) ? 'same' : 'update' });
  }

  const source = read('verify.sh');
  const gatePath = path.join(into, 'verify.sh');
  const gate = existsSync(gatePath)
    ? (() => {
        const project = readFileSync(gatePath, 'utf8');
        const upgraded = upgradedVerify(project, source);
        return { state: /** @type {'same' | 'update'} */ (upgraded.text === project ? 'same' : 'update'), ...upgraded };
      })()
    : { state: /** @type {'new'} */ ('new'), text: renderVerify(source, STEPS.filter((s) => s.needs === null)), steps: STEPS.filter((s) => s.needs === null), renamed: [] };

  const wanted = dependenciesFor(manifest, answers);
  const pkgPath = path.join(into, 'package.json');
  const pkg = existsSync(pkgPath) ? JSON.parse(readFileSync(pkgPath, 'utf8')) : {};
  /** @type {Record<string, string>} */
  const have = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const packages = Object.entries(wanted)
    .filter(([name, v]) => have[name] !== v)
    .map(([name, v]) => ({ name, wanted: v, have: have[name] ?? null }));

  const projectConfig = JSON.parse(readFileSync(configPath, 'utf8'));
  const fresh = configFor(answers);
  const config = OPTIONAL_KEYS.filter((key) => at(projectConfig, key) === undefined).map((key) => ({ key, value: at(fresh, key) }));

  return { into, version, answers, files, gate, packages, config };
}

/**
 * Writes what the plan says is new or changed, and nothing else.
 * @param {UpgradePlan} plan
 * @returns {string[]} the paths written
 */
export function applyUpgrade(plan) {
  /** @type {string[]} */
  const written = [];
  for (const { rel, state } of plan.files) {
    if (state === 'same') continue;
    const target = path.join(plan.into, rel);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, readFileSync(path.join(root, rel)));
    written.push(rel);
  }
  if (plan.gate.state !== 'same') {
    const target = path.join(plan.into, 'verify.sh');
    writeFileSync(target, plan.gate.text);
    chmodSync(target, 0o755);
    written.push('verify.sh');
  }
  return written;
}

/**
 * @param {UpgradePlan} plan
 * @param {{ written?: string[] | null }} [options]
 */
export function renderPlan(plan, { written = null } = {}) {
  const { files, gate, packages, config, answers } = plan;
  const count = (/** @type {FileState['state']} */ state) => files.filter((f) => f.state === state).length;
  const lines = [
    `anhile-harness ${plan.version} → ${plan.into}`,
    `  project: database ${answers.database ? 'yes' : 'no'}, api ${answers.api ? 'yes' : 'no'}, web ${answers.web ? 'yes' : 'no'} (from harness.config.json and apps/)`,
    `  files: ${files.length} harness file(s) — ${count('same')} same, ${count('update')} to update, ${count('new')} new`,
  ];
  for (const f of files.filter((f) => f.state !== 'same')) lines.push(`    ${f.state.padEnd(7)} ${f.rel}`);
  if (gate.state === 'same') lines.push('  verify.sh: same');
  else {
    const renamed = gate.renamed.map((s) => `${s.n} ${s.name} → ${s.command}`).join(', ');
    lines.push(
      `  verify.sh: ${gate.state === 'new' ? 'new' : 'to update'} — the mechanism from this version, the project's ${gate.steps.length} step(s) kept` +
        (renamed ? ` (${renamed})` : ''),
    );
  }
  if (packages.length === 0) lines.push('  packages: every one the manifest names is at its version');
  else {
    lines.push(`  packages: ${packages.length} to add or move — the project's package.json is not edited here; run`);
    lines.push(`    pnpm add -D ${packages.map((p) => `${p.name}@${p.wanted}`).join(' ')}`);
    for (const p of packages) lines.push(`      ${p.name}: ${p.have ?? 'absent'} → ${p.wanted}`);
  }
  if (config.length === 0) lines.push('  config: harness.config.json has every optional key');
  else {
    lines.push(`  config: harness.config.json lacks ${config.length} optional key(s) — a decision about the project, not written here`);
    for (const c of config) lines.push(`    ${c.key}: the generator would write ${JSON.stringify(c.value)}`);
  }
  lines.push("  the project's own files — AGENTS.md, CLAUDE.md, feature_list.json, PROGRESS.md, coverage-floor.json, docs/DOMAIN_RULES.md, the applications — are not touched");
  if (written === null) {
    const pending = files.some((f) => f.state !== 'same') || gate.state !== 'same';
    lines.push(pending ? 'Dry run. Nothing written; run again with --yes to write the files, then ./verify.sh.' : 'Nothing to write. The files are this version already.');
  } else {
    lines.push(written.length === 0 ? 'Nothing to write. The files are this version already.' : `Wrote ${written.length} file(s). Now ./verify.sh, and commit what it passed.`);
  }
  return lines.join('\n');
}

export async function cli() {
  const args = process.argv.slice(2);
  const i = args.indexOf('--into');
  const into = path.resolve(i === -1 ? process.cwd() : (args[i + 1] ?? process.cwd()));
  /** @type {UpgradePlan} */
  let plan;
  try {
    plan = planUpgrade(into);
  } catch (error) {
    console.error(`upgrade: ${/** @type {Error} */ (error).message}`);
    process.exit(1);
  }
  const written = args.includes('--yes') ? applyUpgrade(plan) : null;
  console.log(renderPlan(plan, { written }));
}

if (realpathSync(process.argv[1] ?? '') === realpathSync(fileURLToPath(import.meta.url))) {
  await cli();
}
