import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The package, and the three links between it and the repository it is built
 * from.
 *
 * `scripts/` stays the source of truth: it is where the guards live, where
 * their suites fire at them, and where the gate runs them every day. A second
 * copy maintained by hand would drift, and the drift would ship — to somebody
 * else's repository, where nothing here could notice.
 *
 * So the package is assembled at pack time from `harness.manifest.json`, and
 * three checks hold the chain: the boundary suite says the manifest is
 * complete, this file says the build matches the manifest, and `npm pack`
 * says the tarball matches the build.
 */
const REPO = path.resolve(__dirname, '..', '..');
const PKG = path.join(REPO, 'packages', 'harness');
const read = (...parts: string[]) => readFileSync(path.join(...parts), 'utf8');

const manifest = JSON.parse(read(REPO, 'harness.manifest.json')) as {
  core: { scripts: string[]; suites: string[] };
  configured: { scripts: Record<string, unknown> };
  elsewhere: { core: string[] };
  dependencies: {
    toolchain: { packages: string[] };
    scripts: Record<string, string[] | string>;
    apps: Record<string, string[] | string>;
  };
};

const pkg = JSON.parse(read(PKG, 'package.json')) as {
  name: string;
  version: string;
  license: string;
  bin: Record<string, string>;
  files: string[];
  dependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
  peerDependenciesMeta: Record<string, { optional: boolean }>;
  publishConfig: { access: string };
};

/** The build is deterministic, so running it here is cheap and safe. */
function build(): string[] {
  execFileSync('node', [path.join(PKG, 'build.mjs')], { cwd: REPO, encoding: 'utf8' });
  return (JSON.parse(read(PKG, 'harness', 'CONTENTS.json')) as { files: string[] }).files;
}

describe('what the build assembles', () => {
  const built = build();

  it('carries every script the manifest says travels', () => {
    const expected = [...manifest.core.scripts, ...Object.keys(manifest.configured.scripts)].filter(
      (f) => f !== '//',
    );
    expect(expected.filter((f) => !built.includes(f))).toEqual([]);
  });

  it('carries no guard suite, because they assert the repository they were written in', () => {
    expect(built.filter((f) => f.includes('__tests__'))).toEqual([]);
  });

  it('carries the manifest itself, which the generator reads from its own root', () => {
    expect(built).toContain('harness.manifest.json');
  });

  it('carries verify.sh, the one file the generator rewrites rather than copies', () => {
    expect(built).toContain('verify.sh');
    expect(read(PKG, 'harness', 'verify.sh')).toContain('run_step 01 ');
  });

  it('carries the skills and the agent, which are the harness for a session', () => {
    expect(built.filter((f) => f.startsWith('.claude/skills/')).length).toBeGreaterThan(4);
    expect(built).toContain('.claude/agents/spec-auditor.md');
  });

  it('carries no product document', () => {
    // DOMAIN_RULES and ARCHITECTURE describe a URL shortener. A new project
    // inheriting somebody else's domain rules is worse than starting with none.
    for (const gone of ['docs/DOMAIN_RULES.md', 'docs/ARCHITECTURE.md', 'docs/MCP_SERVER.md']) {
      expect(built).not.toContain(gone);
    }
  });

  it('refuses to build when the manifest names a file that is not there', () => {
    const probe = `
      import { assemble } from ${JSON.stringify(path.join(PKG, 'build.mjs'))};
      import { readFileSync, writeFileSync } from 'node:fs';
      const file = ${JSON.stringify(path.join(REPO, 'harness.manifest.json'))};
      const before = readFileSync(file, 'utf8');
      const broken = JSON.parse(before);
      broken.core.scripts.push('scripts/does-not-exist.mjs');
      writeFileSync(file, JSON.stringify(broken));
      try { assemble(); } catch (e) { console.log(e.message); }
      finally { writeFileSync(file, before); }
    `;
    const out = execFileSync('node', ['--input-type=module', '-e', probe], { encoding: 'utf8' });
    expect(out).toContain('does-not-exist.mjs');
    expect(out).toContain('would ship a missing file');
  });
});

describe('the versions it ships', () => {
  it('resolves every dependency the manifest names', () => {
    build();
    const contents = JSON.parse(read(PKG, 'harness', 'package.json')) as {
      devDependencies: Record<string, string>;
    };
    const named = [
      ...manifest.dependencies.toolchain.packages,
      ...Object.entries(manifest.dependencies.scripts)
        .filter(([f]) => f !== '//')
        .flatMap(([, p]) => p as string[]),
    ];
    expect(named.filter((n) => contents.devDependencies[n] === undefined)).toEqual([]);
  });

  it('ships what the manifest names, and only that', () => {
    // This case used to say the package ships no NestJS and no React. That
    // stopped being true on 2026-09-11, deliberately: the generator writes an
    // API and a page, so it has to be able to say which versions they were
    // written against. What replaces it is the statement that was underneath
    // all along — the manifest decides what travels, and nothing reaches a new
    // project because it happened to be installed here.
    const contents = JSON.parse(read(PKG, 'harness', 'package.json')) as {
      devDependencies: Record<string, string>;
    };
    const named = new Set([
      ...manifest.dependencies.toolchain.packages,
      ...Object.entries(manifest.dependencies.scripts)
        .filter(([f]) => f !== '//')
        .flatMap(([, p]) => p as string[]),
      ...Object.entries(manifest.dependencies.apps)
        .filter(([g]) => g !== '//')
        .flatMap(([, p]) => p as string[]),
    ]);
    expect(Object.keys(contents.devDependencies).filter((n) => !named.has(n))).toEqual([]);
  });

  it('ships nothing that is this product rather than this harness', () => {
    // The other direction, and the one the old case was really about. These
    // are installed here and are nobody else's business: an authentication
    // vendor, a QR encoder, the mutation runner, this repository's own
    // workspace package.
    const contents = JSON.parse(read(PKG, 'harness', 'package.json')) as {
      devDependencies: Record<string, string>;
    };
    for (const theirs of [
      'stytch',
      'qrcode',
      '@playwright/test',
      '@stryker-mutator/core',
      '@anhile-links/contracts',
    ]) {
      expect(contents.devDependencies[theirs]).toBeUndefined();
    }
  });

  it('takes the versions from this repository, so the two cannot disagree', () => {
    // Root and the applications both, because that is where a monorepo keeps
    // them: React's version is in apps/web/package.json and nowhere else.
    const available: Record<string, string> = {};
    for (const file of ['package.json', 'apps/api/package.json', 'apps/web/package.json']) {
      const pkg = JSON.parse(read(REPO, file)) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      Object.assign(available, pkg.dependencies, pkg.devDependencies);
    }
    const contents = JSON.parse(read(PKG, 'harness', 'package.json')) as {
      devDependencies: Record<string, string>;
    };
    for (const [name, version] of Object.entries(contents.devDependencies)) {
      expect(version).toBe(available[name]);
    }
  });
});

describe('the package as npm will see it', () => {
  it('is scoped and public, or a scoped package defaults to private and fails to publish', () => {
    expect(pkg.name.startsWith('@')).toBe(true);
    expect(pkg.publishConfig.access).toBe('public');
  });

  it('has a bin that exists', () => {
    const entry = Object.values(pkg.bin)[0];
    expect(existsSync(path.join(PKG, entry))).toBe(true);
  });

  it('makes pg optional, since a project without a database never imports it', () => {
    expect(pkg.peerDependencies.pg).toBeDefined();
    expect(pkg.peerDependenciesMeta.pg.optional).toBe(true);
  });

  it('publishes the assembled directory, the bin, the README and the licence', () => {
    expect(pkg.files.sort()).toEqual(['LICENSE', 'README.md', 'bin', 'harness']);
  });

  it('ships the licence it claims, rather than only naming one', () => {
    // package.json said MIT and no licence text shipped. A claim about terms
    // with no terms attached gives a user nothing to rely on.
    expect(pkg.license).toBe('MIT');
    expect(read(PKG, 'LICENSE')).toContain('MIT License');
    expect(read(PKG, 'LICENSE')).toContain('WITHOUT WARRANTY OF ANY KIND');
  });

  it('names its command after the scope, because a bin has no namespace', () => {
    // The package name is scoped and cannot collide. The bin is not: it lands
    // in every consumer's node_modules/.bin, where a second package claiming
    // `harness` would be resolved against this one unpredictably. npm said as
    // much on the first publish dry run — `bin[harness] script name was
    // cleaned`. `npx @anhile/harness init` is unaffected either way.
    expect(Object.keys(pkg.bin)).toEqual(['anhile-harness']);
  });

  it('the tarball really carries the harness, asked of npm rather than of the config', () => {
    build();
    const listed = execFileSync('npm', ['pack', '--dry-run', '--json'], {
      cwd: PKG,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    // `prepack` runs the build and prints to the same stream, so the JSON does
    // not start at the first byte.
    const [tarball] = JSON.parse(listed.slice(listed.indexOf('['))) as { files: { path: string }[] }[];
    const paths = tarball.files.map((f) => f.path);

    expect(paths).toContain('bin/harness.mjs');
    expect(paths).toContain('harness/verify.sh');
    expect(paths).toContain('harness/scripts/verify-receipt.mjs');
    expect(paths).toContain('README.md');
    expect(paths).toContain('LICENSE');
    expect(paths.filter((p) => p.includes('__tests__'))).toEqual([]);
  });

  it('the README says what it does not do, which is the part people find out late', () => {
    const readme = read(PKG, 'README.md');
    expect(readme).toContain('Upgrade a project that already adopted it');
    expect(readme).toContain('nothing in your project notices');
  });
});
