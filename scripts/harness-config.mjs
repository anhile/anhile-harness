#!/usr/bin/env node
/**
 * What the harness knows about the project it is guarding.
 *
 * One reader for `harness.config.json`, so that eight scripts cannot disagree
 * about what the file means, and so a missing key fails loudly in one place
 * rather than becoming `undefined` somewhere deep in a guard that then checks
 * nothing. A guard that checks nothing reports success forever, which is the
 * failure this whole repository is about.
 *
 * The root is derived from this file's own location, never from the caller's
 * cwd — a root the caller can point elsewhere is a root that can be pointed at
 * a friendlier configuration.
 */
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = realpathSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
);

export const CONFIG_FILE = 'harness.config.json';

let cached = null;

/** Every key a script may read, with the shape it must have. */
const REQUIRED = {
  'coverage.sources': (v) => Array.isArray(v) && v.length > 0 && v.every((s) => typeof s === 'string'),
  'database.required': (v) => typeof v === 'boolean',
  // Not merely non-empty. This suffix is the whole of what keeps
  // `migrate.mjs --yes` off a real database (I8), and a project that set it to
  // `b` would make every database ending in b fair game for an unattended
  // migration. An underscore and three characters is the shortest thing that
  // reads as deliberate.
  'database.testSuffix': (v) => typeof v === 'string' && /^_[a-z0-9_]{3,}$/iu.test(v),
  'migrations.directory': (v) => typeof v === 'string' && v.length > 0,
  'verifyProbe.path': (v) => typeof v === 'string' && v.endsWith('.ts'),
  'ports.api': (v) => Number.isInteger(v) && v > 0,
  'ports.web': (v) => Number.isInteger(v) && v > 0,
  'attackSurface.paths': (v) => Array.isArray(v) && v.every((s) => typeof s === 'string'),
  'contracts.package': (v) => v === null || (typeof v === 'string' && v.length > 0),
};

/**
 * Keys a script may read and a configuration may leave out. Validated when
 * present: a malformed optional key is refused like a required one, because
 * a guard that reads `undefined` from a typo checks nothing.
 */
const OPTIONAL = {
  // Commits exempt from one-closure-per-commit in check-feature-list.mjs:
  // full shas, of commits already on main.
  'featureList.exemptCommits': (v) => Array.isArray(v) && v.every((s) => /^[0-9a-f]{40}$/u.test(s)),
};

const at = (object, dotted) =>
  dotted.split('.').reduce((node, key) => (node == null ? undefined : node[key]), object);

/**
 * Read and validate. Throws rather than returning a partial object: a guard
 * that starts with a bad configuration should not start at all.
 */
export function loadConfig(file = path.join(root, CONFIG_FILE)) {
  if (cached !== null) return cached;

  if (!existsSync(file)) {
    throw new Error(
      `${CONFIG_FILE} is missing. The harness needs it to know what it is guarding; ` +
        'copy one from the template and edit the paths.',
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`${CONFIG_FILE} does not parse: ${error?.message ?? error}`);
  }

  const wrong = [
    ...Object.entries(REQUIRED).filter(([key, ok]) => !ok(at(parsed, key))),
    ...Object.entries(OPTIONAL).filter(([key, ok]) => at(parsed, key) !== undefined && !ok(at(parsed, key))),
  ].map(([key]) => key);

  if (wrong.length > 0) {
    throw new Error(
      `${CONFIG_FILE} is missing or malformed at: ${wrong.join(', ')}. ` +
        'Every key is required, because a guard reading undefined checks nothing and reports success.',
    );
  }

  cached = parsed;
  return cached;
}

/** For the suite, which loads several configurations in one process. */
export function resetConfigCache() {
  cached = null;
}

export const KEYS = Object.keys(REQUIRED);
export const OPTIONAL_KEYS = Object.keys(OPTIONAL);
