#!/usr/bin/env node
/**
 * Guard for coverage-floor.json.
 *
 * Jest enforces the floors themselves — they are its `coverageThreshold`. This
 * checks the two things Jest cannot:
 *
 *   1. The floors have not been lowered. A floor a session can move is not a
 *      floor; it is the same "close the task by moving the goalposts" failure
 *      that feature_list.json's guard exists to stop, one level down.
 *
 *      An area may stop being floored, which is different from being lowered
 *      and different again from being dropped: it moves to `unfloored` with a
 *      reason naming what covers it instead. That exists because a floor over a
 *      package whose contract is visual and whose tests are deliberately in a
 *      browser can only ever fall -- every presentational component added
 *      lowers it, and lowering it each time turns the ratchet into a toll.
 *
 *      Check 2 below is what keeps this narrow. Unfloored means "no
 *      percentage", never "no accounting": Jest still measures the area, and a
 *      file nothing imports is still refused.
 *   2. No product source file has slipped out of view. Jest measures the files
 *      its tests import, so a new file nothing imports is invisible to coverage
 *      and could never lower it. Every source file must be either in the
 *      coverage report or named in `unmeasured` with a reason.
 *
 * The second check is what keeps the first honest. Without it the floor holds
 * at 70% while untested code accumulates beside it.
 *
 * Usage:
 *   node scripts/check-coverage.mjs [--base <ref>] [--summary <path>]
 *   node scripts/check-coverage.mjs --raise      # after improving coverage
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from './harness-config.mjs';
import { fileURLToPath } from 'node:url';

const root = realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
const FILE = 'coverage-floor.json';
const METRICS = ['statements', 'branches', 'functions', 'lines'];

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

const problems = [];
const fail = (message) => problems.push(message);

function readFloor() {
  return JSON.parse(readFileSync(path.join(root, FILE), 'utf8'));
}

function readBaseline(base) {
  try {
    return JSON.parse(
      execFileSync('git', ['show', `${base}:${FILE}`], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }),
    );
  } catch {
    return null;
  }
}

/** Where step 03 left its report; falls back to a plain local run. */
function summaryPath() {
  const explicit = flag('summary');
  if (explicit) return path.resolve(explicit);
  if (process.env.EVIDENCE_DIR) {
    return path.join(process.env.EVIDENCE_DIR, 'coverage', 'coverage-summary.json');
  }
  return path.join(root, '.generated', 'coverage', 'coverage-summary.json');
}

/** Product source files, as git sees them. Specs are not product source. */
function sourceFiles() {
  // -c -o --exclude-standard: tracked *and* untracked-but-not-ignored. Plain
  // `git ls-files` lists only what is already tracked, which would let a new,
  // untested file pass unnoticed until the commit that adds it — precisely the
  // case this check exists for.
  const out = execFileSync(
    'git',
    ['ls-files', '-c', '-o', '--exclude-standard', ...loadConfig().coverage.sources],
    { cwd: root, encoding: 'utf8' },
  );
  return [...new Set(out.split('\n'))]
    .filter((file) => /\.(ts|tsx)$/.test(file) && !/\.spec\.(ts|tsx)$/.test(file))
    .filter((file) => file.includes('/src/'));
}

/**
 * Coverage reports carry absolute paths, and `root` is a realpath. A checkout
 * reached through a symlink (macOS /var -> /private/var, most obviously) makes
 * the two disagree, and every file then looks unmeasured.
 */
function relativeToRoot(file) {
  let abs = file;
  try {
    abs = realpathSync(file);
  } catch {
    /* the report may name a file that has since been removed */
  }
  return path.relative(root, abs);
}

function measuredFiles(summary) {
  return new Set(
    Object.keys(summary)
      .filter((key) => key !== 'total')
      .map(relativeToRoot),
  );
}

/** Per-area totals, in the same shape as the floor file. */
function areaTotals(summary) {
  const floor = readFloor();
  const areas = Object.keys(floor.areas);
  const acc = Object.fromEntries(
    areas.map((area) => [area, Object.fromEntries(METRICS.map((m) => [m, [0, 0]]))]),
  );

  for (const [file, entry] of Object.entries(summary)) {
    if (file === 'total') continue;
    const rel = `./${relativeToRoot(file)}`;
    const area = areas.find((candidate) => rel.startsWith(candidate));
    if (!area) continue;
    for (const metric of METRICS) {
      acc[area][metric][0] += entry[metric].covered;
      acc[area][metric][1] += entry[metric].total;
    }
  }

  return Object.fromEntries(
    Object.entries(acc).map(([area, metrics]) => [
      area,
      Object.fromEntries(
        METRICS.map((metric) => {
          const [covered, total] = metrics[metric];
          // Floored to two decimals, so a floor written from one run is never a
          // hair above what the next identical run reports.
          return [metric, total === 0 ? 100 : Math.floor((covered / total) * 10000) / 100];
        }),
      ),
    ]),
  );
}

function raise() {
  const file = summaryPath();
  if (!existsSync(file)) {
    console.error(`check-coverage: no coverage report at ${file}. Run the unit tests first.`);
    process.exit(1);
  }
  const floor = readFloor();
  const actual = areaTotals(JSON.parse(readFileSync(file, 'utf8')));
  const raised = [];

  for (const [area, metrics] of Object.entries(actual)) {
    for (const metric of METRICS) {
      if (metrics[metric] > floor.areas[area][metric]) {
        raised.push(`${area} ${metric}: ${floor.areas[area][metric]} -> ${metrics[metric]}`);
        floor.areas[area][metric] = metrics[metric];
      }
    }
  }

  writeFileSync(path.join(root, FILE), `${JSON.stringify(floor, null, 2)}\n`);
  console.log(raised.length ? `check-coverage: raised\n  ${raised.join('\n  ')}` : 'check-coverage: nothing to raise');
}

function check() {
  const base = flag('base', 'HEAD');
  const floor = readFloor();
  const baseline = readBaseline(base);

  const unfloored = floor.unfloored ?? {};

  for (const [area, reason] of Object.entries(unfloored)) {
    if (typeof reason !== 'string' || reason.trim() === '') {
      fail(`unfloored area ${area} carries no reason. Say what covers it instead.`);
    }
    if (floor.areas[area]) {
      fail(`area ${area} is both floored and unfloored. It is one or the other.`);
    }
  }

  if (baseline) {
    for (const [area, metrics] of Object.entries(baseline.areas)) {
      if (!floor.areas[area]) {
        // Leaving the floor is allowed; vanishing is not. The difference is a
        // line in the file saying what covers the area instead, which is a
        // thing a reviewer can disagree with.
        if (!unfloored[area]) {
          fail(`area ${area} was removed. Areas are not dropped to make a build green.`);
        }
        continue;
      }
      for (const metric of METRICS) {
        if (floor.areas[area][metric] < metrics[metric]) {
          fail(
            `${area} ${metric} lowered ${metrics[metric]} -> ${floor.areas[area][metric]}. ` +
            'Floors go up. Lowering one is a human decision, with a reason.',
          );
        }
      }
    }
  }

  const file = summaryPath();
  if (!existsSync(file)) {
    fail(`no coverage report at ${file}; the unit step must run with coverage`);
  } else {
    const summary = JSON.parse(readFileSync(file, 'utf8'));
    const measured = measuredFiles(summary);
    const declared = new Set(Object.keys(floor.unmeasured ?? {}));

    for (const file of sourceFiles()) {
      if (!measured.has(file) && !declared.has(file)) {
        fail(
          `${file} is measured by no unit test and is not listed in "unmeasured". ` +
          'Give it a test, or name it there with the suite that does cover it.',
        );
      }
    }

    for (const file of declared) {
      if (measured.has(file)) {
        fail(`${file} is listed as unmeasured but the coverage report includes it. Remove the entry.`);
      } else if (!existsSync(path.join(root, file))) {
        fail(`${file} is listed as unmeasured but no longer exists. Remove the entry.`);
      }
    }
  }

  console.log(
    `check-coverage: ${Object.keys(floor.areas).length} area(s), ` +
    `${Object.keys(floor.unmeasured ?? {}).length} file(s) declared unmeasured, baseline ${base}`,
  );

  if (problems.length) {
    console.error('check-coverage: REJECTED');
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  console.log('check-coverage: ok');
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  if (args.includes('--raise')) raise();
  else check();
}
