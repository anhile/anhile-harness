#!/usr/bin/env node
/**
 * Guard for feature_list.json.
 *
 * The file is append-only. Compared against a baseline revision, the only
 * changes permitted are:
 *
 *   - appending new entries at the end, each with an `id` equal to its
 *     position and a `spec` naming the contract that introduces it
 *   - flipping an existing entry's `passes` from false to true
 *   - marking entries `retracted`, all under one contract
 *   - recording a `spec` on an entry whose `spec` was null, once
 *
 * Everything else is rejected: deleting an entry, reordering entries, editing a
 * `category`, a `description` or any `step`, changing an `id` or a recorded
 * `spec`, and flipping `passes` back to false. Those are the changes that let
 * a session close a task by moving the goalposts rather than by doing the work.
 *
 * Ids are positions, fixed at append time, since 2026-09-08 under
 * specs/2026-09-feature-list-identity.md. Before that every reference to an
 * entry -- in PROGRESS.md, in contracts, in `retracted.supersededBy` -- was a
 * position that stayed meaningful only because the list is append-only. The
 * id makes the same number a fact of the entry rather than of its neighbours.
 * `spec` is null on the entries that predate contract links; the reshape that
 * introduced both fields set it from git history where the history said so.
 *
 * Retraction is the way a guarantee is withdrawn in the open. It is a loosening
 * and it is meant to be: before it existed, the only routes to removing shipped
 * behaviour were leaving `passes: true` on a feature that no longer exists, or
 * deleting the tests that prove it and leaving the claim standing -- and the
 * second one passed this guard, because nothing here links an entry to its
 * tests. That is still true. What retraction changes is the incentive, not the
 * possibility.
 *
 * So it carries defences, none of which stops a determined session and all of
 * which put the attempt in the diff: it names a contract file that must exist,
 * it carries a reason, it says whether the guarantee moved to another entry or
 * ended, it is permanent once written, it shares a commit only with other
 * withdrawals under the same contract, and never with a feature being closed. The entry itself is never
 * removed -- a list that forgets a guarantee was held and withdrawn is a
 * highlight reel, which is the failure docs/INVARIANTS.md I12 describes.
 *
 * Baseline defaults to HEAD, so this catches tampering in the working tree
 * before it is committed -- which is the order the definition of done
 * prescribes (verify.sh, then commit). To audit across commits instead, pass
 * --base main.
 *
 * Usage:
 *   node scripts/check-feature-list.mjs [--base <ref>] [--at <ref>]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from './harness-config.mjs';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = 'feature_list.json';

const args = process.argv.slice(2);
const baseIndex = args.indexOf('--base');
const base = baseIndex === -1 ? 'HEAD' : args[baseIndex + 1];
// --at reads the file as it stood at a commit instead of from the working tree.
// Append-only is a property of each step, not of a span: appending an entry in
// one commit and flipping it in the next is correct, and collapses into
// "born passing" the moment you compare across both. CI therefore walks the
// pushed commits one at a time, each against its own parent.
const atIndex = args.indexOf('--at');
const at = atIndex === -1 ? null : args[atIndex + 1];

/**
 * Commits that closed more than one feature, made before the one-per-commit
 * rule existed in the project that adopts this guard. Listed in
 * harness.config.json under `featureList.exemptCommits` rather than silently
 * tolerated, and the list is closed by the rule below: CI walks history commit
 * by commit, so without an exemption an old commit re-entering a range would
 * turn red for breaking a rule that did not exist when it was made -- the
 * wrong kind of red.
 *
 * This used to be two literal shas from the repository the guard was written
 * in, and a copied guard carried another project's history into every new
 * one. A project starts with an empty list and adds a sha only for a commit
 * that is already on its main branch.
 */
const PRE_RULE_COMMITS = new Set(loadConfig().featureList?.exemptCommits ?? []);

const problems = [];
const notes = [];

function fail(message) {
  problems.push(message);
}

function readCurrent() {
  const raw = at
    ? execFileSync('git', ['show', `${at}:${FILE}`], { cwd: root, encoding: 'utf8' })
    : readFileSync(path.join(root, FILE), 'utf8');
  try {
    return JSON.parse(raw);
  } catch (error) {
    console.error(`check-feature-list: ${FILE} is not valid JSON: ${error.message}`);
    process.exit(1);
  }
}

function readBaseline() {
  try {
    const raw = execFileSync('git', ['show', `${base}:${FILE}`], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Full sha for a ref, so the pre-rule list can be compared against short refs. */
function resolveCommit(ref) {
  try {
    return execFileSync('git', ['rev-parse', ref], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return ref;
  }
}

function shapeOf(entry) {
  return {
    category: entry.category,
    description: entry.description,
    steps: entry.steps,
  };
}

function sameShape(a, b) {
  return JSON.stringify(shapeOf(a)) === JSON.stringify(shapeOf(b));
}

function validateEntry(entry, index) {
  if (typeof entry?.category !== 'string' || !entry.category) {
    fail(`entry ${index}: missing or empty "category"`);
  }
  if (typeof entry?.description !== 'string' || !entry.description) {
    fail(`entry ${index}: missing or empty "description"`);
  }
  if (!Array.isArray(entry?.steps) || entry.steps.length === 0) {
    fail(`entry ${index}: "steps" must be a non-empty array`);
  }
  if (typeof entry?.passes !== 'boolean') {
    fail(`entry ${index}: "passes" must be a boolean`);
  }
  if (!Number.isInteger(entry?.id)) {
    fail(`entry ${index}: missing "id" — an integer equal to its position, ${index}`);
  } else if (entry.id !== index) {
    fail(
      `entry ${index}: "id" is ${entry.id} but its position is ${index}. Ids are positions, ` +
        'fixed when the entry is appended; a mismatch means the list was reordered or an id was edited',
    );
  }
  if (entry?.spec !== null) {
    if (typeof entry?.spec !== 'string' || !entry.spec.trim()) {
      fail(
        `entry ${index}: "spec" must name the contract that introduced it, ` +
          'or be null on an entry that predates contract links',
      );
    } else if (!existsSync(path.join(root, entry.spec))) {
      fail(`entry ${index}: "spec" names ${entry.spec}, which does not exist`);
    }
  }
}

/**
 * The retracted marker, if present. Every field is required, including an
 * explicit `supersededBy: null`: "the guarantee moved to entry 62" and "the
 * guarantee ended" are different facts, and a missing field would let the
 * second be mistaken for an oversight.
 */
function validateRetraction(entry, index, list) {
  const r = entry?.retracted;
  if (r === undefined) return;

  if (typeof r !== 'object' || r === null || Array.isArray(r)) {
    fail(`entry ${index}: "retracted" must be an object`);
    return;
  }

  if (typeof r.spec !== 'string' || !r.spec.trim()) {
    fail(`entry ${index}: "retracted.spec" must name the contract that withdraws it`);
  } else if (!existsSync(path.join(root, r.spec))) {
    // A retraction pointing at a contract nobody wrote is a retraction with no
    // reviewable reason behind it.
    fail(`entry ${index}: "retracted.spec" names ${r.spec}, which does not exist`);
  }

  if (typeof r.reason !== 'string' || !r.reason.trim()) {
    fail(`entry ${index}: "retracted.reason" must be a non-empty string`);
  }

  if (!('supersededBy' in r)) {
    fail(
      `entry ${index}: "retracted.supersededBy" is required — the successor's id, or null when the guarantee ends`,
    );
  } else if (r.supersededBy !== null) {
    const target = r.supersededBy;
    if (!Number.isInteger(target) || target < 0 || target >= list.length) {
      fail(
        `entry ${index}: "retracted.supersededBy" must be null or the id of an entry in the list, ` +
          `got ${JSON.stringify(target)}`,
      );
    } else if (target === index) {
      fail(`entry ${index}: "retracted.supersededBy" points at itself`);
    } else if (list[target]?.retracted !== undefined) {
      fail(
        `entry ${index}: "retracted.supersededBy" points at entry ${target}, which is itself ` +
          `retracted. A successor that was withdrawn carries nothing.`,
      );
    }
  }
}

const current = readCurrent();

if (!Array.isArray(current)) {
  console.error(`check-feature-list: ${FILE} must be an array`);
  process.exit(1);
}

current.forEach(validateEntry);
current.forEach((entry, index) => validateRetraction(entry, index, current));

const baseline = readBaseline();

if (baseline === null) {
  notes.push(`no baseline at ${base} (first commit, or file absent there) — shape checks only`);
} else if (!Array.isArray(baseline)) {
  fail(`baseline at ${base} is not an array`);
} else {
  if (current.length < baseline.length) {
    fail(
      `entries were removed: baseline has ${baseline.length}, working tree has ${current.length}. ` +
        `The list is append-only.`,
    );
  }

  const retracted = [];

  const shared = Math.min(baseline.length, current.length);
  for (let i = 0; i < shared; i += 1) {
    const before = baseline[i];
    const after = current[i];

    if (!sameShape(before, after)) {
      const what = [];
      if (before.category !== after.category) what.push('category');
      if (before.description !== after.description) what.push('description');
      if (JSON.stringify(before.steps) !== JSON.stringify(after.steps)) what.push('steps');
      const detail = [`entry ${i} was edited (${what.join(', ')}). Existing entries are immutable.`];
      detail.push(`        entry: ${before.description}`);
      if (before.category !== after.category) {
        detail.push(`        category was: ${before.category}`);
        detail.push(`        category now: ${after.category}`);
      }
      if (before.description !== after.description) {
        detail.push(`        description was: ${before.description}`);
        detail.push(`        description now: ${after.description}`);
      }
      if (JSON.stringify(before.steps) !== JSON.stringify(after.steps)) {
        const removed = before.steps.filter((step) => !after.steps.includes(step));
        const addedSteps = after.steps.filter((step) => !before.steps.includes(step));
        detail.push(`        steps: ${before.steps.length} -> ${after.steps.length}`);
        for (const step of removed) detail.push(`        - removed: ${step}`);
        for (const step of addedSteps) detail.push(`        + added:   ${step}`);
      }
      fail(detail.join('\n'));
    }

    if (before.passes === true && after.passes === false) {
      fail(`entry ${i}: "passes" went from true back to false — ${after.description}`);
    }

    // The two identity fields, frozen once written. A baseline without them is
    // the state before the reshape and has nothing to hold the entry to.
    if (Number.isInteger(before.id) && before.id !== after.id) {
      fail(`entry ${i}: "id" changed from ${before.id} to ${after.id}. An id is permanent — ${before.description}`);
    }
    if (before.spec !== undefined) {
      if (before.spec !== null && before.spec !== after.spec) {
        fail(
          `entry ${i}: "spec" changed from ${before.spec} to ${after.spec}. The contract that ` +
            `introduced an entry does not change — ${before.description}`,
        );
      } else if (before.spec === null && after.spec !== null) {
        notes.push(`entry ${i}: "spec" recorded as ${after.spec}`);
      }
    }

    const wasRetracted = before.retracted !== undefined;
    const isRetracted = after.retracted !== undefined;

    if (wasRetracted && !isRetracted) {
      fail(`entry ${i}: "retracted" was removed. A retraction is permanent — ${before.description}`);
    } else if (
      wasRetracted &&
      isRetracted &&
      JSON.stringify(before.retracted) !== JSON.stringify(after.retracted)
    ) {
      fail(`entry ${i}: "retracted" was edited. A retraction is permanent — ${before.description}`);
    } else if (!wasRetracted && isRetracted) {
      retracted.push(i);
    }

    // Frozen in both directions. The entry records what was true when the
    // guarantee was withdrawn; moving it afterwards rewrites that.
    if (wasRetracted && before.passes !== after.passes) {
      fail(`entry ${i}: "passes" changed on a retracted entry — ${after.description}`);
    }
  }

  const added = current.length - baseline.length;
  if (added > 0) {
    notes.push(`${added} entry/entries appended`);
    for (let i = baseline.length; i < current.length; i += 1) {
      if (current[i].passes !== false) {
        fail(`entry ${i} is new and must start with "passes": false — ${current[i].description}`);
      }
      if (current[i].retracted !== undefined) {
        fail(`entry ${i} is new and arrives retracted — ${current[i].description}`);
      }
      if (current[i].spec === null) {
        fail(`entry ${i} is new and must name its contract in "spec" — ${current[i].description}`);
      }
    }
  }

  const flipped = [];
  for (let i = 0; i < shared; i += 1) {
    if (baseline[i].retracted !== undefined) continue;
    if (baseline[i].passes === false && current[i].passes === true) flipped.push(i);
  }
  if (flipped.length > 0) {
    notes.push(`passes flipped false -> true for entry/entries: ${flipped.join(', ')}`);
  }

  // One feature per commit. Not for tidiness: verify.sh gives one verdict for
  // the whole tree, so two features closed together share a single piece of
  // evidence and neither can be attributed when it goes red. It also bounds
  // what a session has at stake, and sunk cost is what makes goalposts move.
  //
  // The session may implement as many features as it likes; closing them is
  // what serialises. Flip one, run verify.sh, commit, flip the next.
  if (flipped.length > 1 && !(at && PRE_RULE_COMMITS.has(resolveCommit(at)))) {
    fail(
      `${flipped.length} entries were flipped to "passes": true at once ` +
        `(${flipped.join(', ')}). One feature per commit: flip one, run ./verify.sh, ` +
        'commit, then flip the next.',
    );
  }

  if (retracted.length > 0) {
    notes.push(`retracted entry/entries: ${retracted.join(', ')}`);
  }

  // Several may land together, but only when one contract withdraws them all.
  //
  // This started as one-per-commit, carried over from the flip rule. The
  // analogy does not hold. A flip claims a feature works, verify.sh gives one
  // verdict per tree, and two flips in a commit therefore share one piece of
  // evidence with no way to attribute it. A retraction claims nothing works --
  // it records that a guarantee was withdrawn, and what a reviewer reads is the
  // contract that withdrew it. Ten commits citing one contract give noise, not
  // traceability.
  //
  // So the unit is the contract, not the commit. Mixing two contracts'
  // withdrawals is still refused: that is a commit doing two things.
  const citedSpecs = [...new Set(retracted.map((i) => current[i].retracted?.spec))];
  if (citedSpecs.length > 1) {
    fail(
      `${retracted.length} entries were retracted at once (${retracted.join(', ')}) citing ` +
        `${citedSpecs.length} different contracts (${citedSpecs.join(', ')}). Retractions share a ` +
        'commit only when one contract withdraws them all.',
    );
  }

  // Withdrawing a guarantee and claiming a new one are opposite moves, and a
  // commit that does both reads as neither. Kept apart so each is reviewed on
  // its own.
  if (retracted.length > 0 && flipped.length > 0) {
    fail(
      `a commit may not both retract (${retracted.join(', ')}) and close ` +
        `(${flipped.join(', ')}) a feature. Land them separately.`,
    );
  }
}

console.log(`check-feature-list: ${current.length} entries, baseline ${base}`);
for (const note of notes) console.log(`  note: ${note}`);

if (problems.length > 0) {
  console.error(`check-feature-list: ${problems.length} problem(s)`);
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error(
    '\n  feature_list.json is append-only. See docs/INVARIANTS.md I15.\n' +
      '  Appending an entry (with its id and its contract), flipping passes\n' +
      '  false -> true, marking entries retracted under one contract, and recording\n' +
      '  a contract on an entry that had none are the only permitted changes;\n' +
      '  editing or removing an existing entry is not, an id and a recorded contract\n' +
      '  never change, and a retraction cannot be undone.',
  );
  process.exit(1);
}

console.log('check-feature-list: ok');
