#!/usr/bin/env node
// @ts-check
/**
 * The harness, as a command.
 *
 *   npx anhile-harness init            # ask, then write a new project
 *   npx anhile-harness init --yes …    # the same without asking
 *   npx anhile-harness upgrade [--into <dir>] [--yes]   # this version's harness files into a project init wrote
 *   npx anhile-harness files           # what this package carries
 *
 * Until 2026-09-16 `init` was the whole of it and this comment said so; a
 * project kept the snapshot it was given, and the CHANGELOG carried a list of
 * files to copy by hand. `upgrade` does the copying: the harness's files from
 * this version, the project's own files untouched, a plan without --yes.
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
      `anhile-harness ${version()}`,
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
      '  upgrade [--into <dir>] [--yes]',
      '        Bring a project init wrote earlier to this version: the scripts,',
      '        agents, skills, workflow and templates the manifest names, and',
      '        verify.sh above its step block with the project\'s steps kept. The',
      '        project\'s own files are not touched; packages and config keys it',
      '        lacks are named, not written. Without --yes it is a plan.',
      '',
      '  files',
      '        List what this package carries, which is what a new project gets.',
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
    process.argv = [process.argv[0] ?? 'node', path.join(HARNESS, 'scripts', 'harness-init.mjs'), ...rest];
    await init.cli();
    return;
  }

  if (command === 'upgrade') {
    if (!assembled()) process.exit(1);
    const upgrade = await import(path.join(HARNESS, 'scripts', 'harness-upgrade.mjs'));
    process.argv = [process.argv[0] ?? 'node', path.join(HARNESS, 'scripts', 'harness-upgrade.mjs'), ...rest];
    await upgrade.cli();
    return;
  }

  console.error(`No command "${command}". Try --help.`);
  process.exit(1);
}

await main();
