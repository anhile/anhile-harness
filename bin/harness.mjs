#!/usr/bin/env node
/**
 * The harness, as a command.
 *
 *   npx @anhile/harness init            # ask, then write a new project
 *   npx @anhile/harness init --yes …    # the same without asking
 *   npx @anhile/harness files           # what this package carries
 *
 * `init` is the whole of it for now. The other half a package makes possible —
 * upgrading a project that already adopted an older version — does not exist,
 * and saying so here is better than letting somebody discover it.
 */
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = realpathSync(path.dirname(fileURLToPath(import.meta.url)));
const packageRoot = path.resolve(here, '..');
// The repository root is what ships. In link-shortener this pointed at a
// `harness/` directory that build.mjs assembled at pack time; here there is no
// second copy to assemble, so `scripts/` at the root is the thing itself.
const HARNESS = packageRoot;

function version() {
  return JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8')).version;
}

function assembled() {
  if (existsSync(path.join(HARNESS, 'harness.manifest.json'))) return true;
  console.error('This package is missing harness.manifest.json, which the generator reads to know what travels.\n');
  return false;
}

function usage() {
  console.log(
    [
      `@anhile/harness ${version()}`,
      '',
      'A gate that refuses a commit whose claims are not earned, and a generator',
      'that puts it in a new project.',
      '',
      'Commands:',
      '  init',
      '        Write a new project with the harness in it. It asks what is in the',
      '        project — a database, a NestJS API, a React page — and which MCP',
      '        servers to declare, saying beside each what choosing it costs.',
      '        The project it writes passes its own ./verify.sh on the first run;',
      '        that is the bar, and steps nothing can pass yet are deferred rather',
      '        than shipped broken.',
      '',
      '  init --yes [--name <n> --into <dir> --database --api --web --mcp a,b]',
      '        The same without asking, for CI and for scripts.',
      '',
      '  files',
      '        List what this package carries, which is what a new project gets.',
      '',
      'Not yet here: upgrading a project that adopted an earlier version. A',
      'generated project keeps the snapshot it was given.',
    ].join('\n'),
  );
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);

  if (command === undefined || command === '--help' || command === '-h') {
    usage();
    return;
  }

  if (command === '--version' || command === '-v') {
    console.log(version());
    return;
  }

  if (command === 'files') {
    if (!assembled()) process.exit(1);
    const manifest = JSON.parse(readFileSync(path.join(HARNESS, 'harness.manifest.json'), 'utf8'));
    const files = [
      ...manifest.core.scripts,
      ...Object.keys(manifest.configured.scripts),
      ...manifest.elsewhere.core,
    ].filter((f) => f !== '//').sort();
    console.log(files.join('\n'));
    console.log(`\n${files.length} file(s)`);
    return;
  }

  if (command === 'init') {
    if (!assembled()) process.exit(1);
    // The generator reads the repository it sits in, which here is this
    // package's own root: the manifest, the scripts and verify.sh are all
    // directly there.
    const init = await import(path.join(HARNESS, 'scripts', 'harness-init.mjs'));
    process.argv = [process.argv[0], path.join(HARNESS, 'scripts', 'harness-init.mjs'), ...rest];
    await init.cli();
    return;
  }

  console.error(`No command "${command}". Try --help.`);
  process.exit(1);
}

await main();
