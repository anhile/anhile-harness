import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The package, and the links between it and the repository it is.
 *
 * In link-shortener the package was assembled at pack time from the manifest,
 * and this suite held three links: manifest to build, build to tarball. Here
 * there is no build — `scripts/` at the root is what ships and `files` in
 * package.json names the real directories — so there are two: the boundary
 * suite says the manifest is complete, and this one asks npm what the tarball
 * would carry and holds that to the manifest.
 *
 * Asked of `npm pack --dry-run`, never of `files`. The field is a set of globs
 * npm interprets, and the interpretation is what has surprised people: what a
 * dot-directory does, what a negation does, what an ignore file does inside a
 * listed directory. The tarball is the fact; `files` is a claim about it.
 */
const REPO = path.resolve(__dirname, '..', '..');
const read = (...parts: string[]) => readFileSync(path.join(REPO, ...parts), 'utf8');

const manifest = JSON.parse(read('harness.manifest.json')) as {
  core: { scripts: string[]; suites: string[] };
  configured: { scripts: Record<string, unknown> };
  elsewhere: { core: string[] };
  dependencies: {
    toolchain: { packages: string[] };
    scripts: Record<string, string[] | string>;
    apps: Record<string, string[] | string>;
  };
};

const pkg = JSON.parse(read('package.json')) as {
  name: string;
  version: string;
  type?: string;
  packageManager?: string;
  license: string;
  author?: string;
  repository?: { type: string; url: string };
  homepage?: string;
  bugs?: { url: string };
  keywords?: string[];
  engines?: { node?: string };
  bin: Record<string, string>;
  files: string[];
  dependencies?: Record<string, string>;
  devDependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
  peerDependenciesMeta: Record<string, { optional: boolean }>;
  publishConfig: { access: string };
};

const versions = JSON.parse(read('harness.versions.json')) as { versions: Record<string, string> };

const named = (groups: Record<string, string[] | string>): string[] =>
  Object.entries(groups)
    .filter(([key]) => key !== '//')
    .flatMap(([, packages]) => packages as string[]);

/** What the tarball would carry, asked of npm rather than of the config. */
function packed(): string[] {
  const listed = execFileSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: REPO,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  // A lifecycle script, should one ever be added, prints to the same stream,
  // so the JSON is not assumed to start at the first byte.
  const [tarball] = JSON.parse(listed.slice(listed.indexOf('['))) as { files: { path: string }[] }[];
  if (tarball === undefined) throw new Error('npm pack --dry-run --json listed no tarball');
  return tarball.files.map((f) => f.path);
}

describe('what the tarball carries', () => {
  const paths = packed();

  it('every script the manifest says travels', () => {
    const expected = [...manifest.core.scripts, ...Object.keys(manifest.configured.scripts)].filter(
      (f) => f !== '//',
    );
    expect(expected.filter((f) => !paths.includes(f))).toEqual([]);
  });

  it('every file the generator copies beside the scripts', () => {
    expect(manifest.elsewhere.core.filter((f) => !paths.includes(f))).toEqual([]);
  });

  it('the manifest itself, which the generator reads from its own root', () => {
    expect(paths).toContain('harness.manifest.json');
  });

  it('the versions file, which the generator resolves the applications from', () => {
    // Without it `npx @anhile/harness init --web` refuses in the consumer's
    // shell for a reason that only makes sense in this repository.
    expect(paths).toContain('harness.versions.json');
  });

  it('verify.sh, the one file the generator rewrites rather than copies', () => {
    expect(paths).toContain('verify.sh');
    expect(read('verify.sh')).toContain('run_step 01 ');
  });

  it('the skills and the agent, which are the harness for a session', () => {
    expect(paths.filter((f) => f.startsWith('.claude/skills/')).length).toBeGreaterThan(4);
    expect(paths).toContain('.claude/agents/spec-auditor.md');
  });

  it('the bin, the README and the licence', () => {
    for (const file of ['bin/harness.mjs', 'README.md', 'LICENSE', 'package.json']) {
      expect(paths).toContain(file);
    }
  });

  it('no session state', () => {
    // .claude/.work-budget.json is written by a hook during a session and was
    // in the first dry run: `files` lists `.claude` and npm takes the directory
    // whole. Shipping it hands every consumer a count from somebody else's
    // afternoon.
    expect(paths.filter((f) => f.endsWith('.work-budget.json'))).toEqual([]);
    expect(paths.filter((f) => f.startsWith('.generated/'))).toEqual([]);
  });

  it('nothing git ignores', () => {
    // A file in the tarball that git ignores is a file no review saw and no
    // clean clone can reproduce. The work-budget file above is one instance;
    // this is the rule it is an instance of. Untracked-but-not-ignored is
    // allowed, so a file being added shows up here before it is staged.
    const known = new Set(
      execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
        cwd: REPO,
        encoding: 'utf8',
      }).split('\n'),
    );
    expect(paths.filter((f) => !known.has(f))).toEqual([]);
  });

  it('no guard suite, because they assert this repository', () => {
    // The generator does not copy them and a consumer never runs them; in the
    // tarball they were 212 KB of assertions about a repository the consumer
    // does not have. The suites stay here, beside what they fire at.
    expect(paths.filter((f) => f.includes('__tests__'))).toEqual([]);
  });

  it('only the workflow that travels, not the ones that gate this repository', () => {
    // generate.yml runs the generator and release.yml publishes the package;
    // a generated project can do neither. What it gets is what the manifest
    // lists, and the manifest lists verify.yml.
    const workflows = paths.filter((f) => f.startsWith('.github/workflows/'));
    expect(workflows).toEqual(manifest.elsewhere.core.filter((f) => f.startsWith('.github/workflows/')));
  });

  it('the changelog, which is what a consumer reads before upgrading', () => {
    expect(paths).toContain('CHANGELOG.md');
  });

  it('no product document', () => {
    // DOMAIN_RULES and ARCHITECTURE describe a URL shortener. A new project
    // inheriting somebody else's domain rules is worse than starting with none.
    for (const gone of ['docs/DOMAIN_RULES.md', 'docs/ARCHITECTURE.md', 'docs/MCP_SERVER.md']) {
      expect(paths).not.toContain(gone);
    }
  });
});

describe('the versions it can give a new project', () => {
  const fromPackageJson = { ...pkg.dependencies, ...pkg.devDependencies };
  const available = { ...fromPackageJson, ...versions.versions };
  const wanted = [
    ...manifest.dependencies.toolchain.packages,
    ...named(manifest.dependencies.scripts),
    ...named(manifest.dependencies.apps),
  ];

  it('resolves every package the manifest names, whatever a project answers', () => {
    // The generator refuses a name it cannot resolve, at generation time. That
    // refusal is right, and this case is what keeps it from ever firing for a
    // consumer: the check runs here, against the same two files.
    expect(wanted.filter((n) => available[n] === undefined)).toEqual([]);
  });

  it('records in harness.versions.json only what package.json cannot give', () => {
    // Two copies of a version drift. The resolver refuses a name in both; this
    // says the same about the files as they are committed.
    expect(Object.keys(versions.versions).filter((n) => fromPackageJson[n] !== undefined)).toEqual([]);
  });

  it('records in harness.versions.json nothing the manifest does not name', () => {
    // A version for a package nothing generates is a version nobody will
    // notice going stale.
    expect(Object.keys(versions.versions).filter((n) => !wanted.includes(n))).toEqual([]);
  });

  it('records versions as ranges, in the form package.json would', () => {
    for (const [name, version] of Object.entries(versions.versions)) {
      expect({ name, ok: /^[\^~]?\d+\.\d+\.\d+/u.test(version) }).toEqual({ name, ok: true });
    }
  });
});

describe('the package as npm will see it', () => {
  it('is scoped and public, or a scoped package defaults to private and fails to publish', () => {
    expect(pkg.name.startsWith('@')).toBe(true);
    expect(pkg.publishConfig.access).toBe('public');
  });

  it('has a bin that exists and is a module, since it uses top-level await', () => {
    const [entry] = Object.values(pkg.bin);
    expect(entry).toBeDefined();
    expect(existsSync(path.join(REPO, entry ?? ''))).toBe(true);
    expect(pkg.type).toBe('module');
  });

  it('makes pg optional, since a project without a database never imports it', () => {
    expect(pkg.peerDependencies.pg).toBeDefined();
    expect(pkg.peerDependenciesMeta.pg?.optional).toBe(true);
  });

  it('pins the pg peer to the version the generator would write', () => {
    // Two places say which pg: the peer range for whoever installs this
    // package, and package.json's devDependency — there since migrate.mjs is
    // type-checked against @types/pg — for whoever gets a project from it.
    expect(pkg.peerDependencies.pg).toBe(pkg.devDependencies.pg);
  });

  it('names its package manager, which CI reads and the generator copies', () => {
    expect(pkg.packageManager).toMatch(/^pnpm@\d+\.\d+\.\d+$/u);
  });

  it('ships the licence it claims, rather than only naming one', () => {
    // package.json said MIT and no licence text shipped. A claim about terms
    // with no terms attached gives a user nothing to rely on.
    expect(pkg.license).toBe('MIT');
    expect(read('LICENSE')).toContain('MIT License');
    expect(read('LICENSE')).toContain('WITHOUT WARRANTY OF ANY KIND');
  });

  it('names its command after the scope, because a bin has no namespace', () => {
    // The package name is scoped and cannot collide. The bin is not: it lands
    // in every consumer's node_modules/.bin, where a second package claiming
    // `harness` would be resolved against this one unpredictably. npm said as
    // much on the first publish dry run — `bin[harness] script name was
    // cleaned`. `npx @anhile/harness init` is unaffected either way.
    expect(Object.keys(pkg.bin)).toEqual(['anhile-harness']);
  });

  it('says where it lives, so npm can link the source and the issues', () => {
    // A scoped package with no repository field is one npm shows with no
    // source link, and provenance has nothing to bind the tarball to.
    expect(pkg.repository?.url).toBe('git+https://github.com/anhile/anhile-harness.git');
    expect(pkg.homepage).toContain('github.com/anhile/anhile-harness');
    expect(pkg.bugs?.url).toContain('github.com/anhile/anhile-harness/issues');
    expect(pkg.author).toBeDefined();
    expect(pkg.keywords?.length ?? 0).toBeGreaterThan(3);
  });

  it('names the node it needs, which is the one .nvmrc pins', () => {
    // bin/harness.mjs uses top-level await and node: imports; an older node
    // fails with a syntax error that says nothing about the version.
    const pinned = read('.nvmrc').trim().split('.')[0];
    expect(pkg.engines?.node).toBe(`>=${pinned}`);
  });

  it('has a changelog entry for the version it claims', () => {
    // release.yml refuses a tag without one; this refuses the commit.
    expect(read('CHANGELOG.md')).toMatch(new RegExp(`^## \\[${pkg.version.replace(/\./gu, '\\.')}\\]`, 'mu'));
  });

  it('the README says what it does not do, which is the part people find out late', () => {
    const readme = read('README.md');
    expect(readme).toContain('Upgrade a project that already adopted it');
    expect(readme).toContain('nothing in your project notices');
  });
});

describe('the scripts it ships are checked as they run', () => {
  // tsc prints nothing on success, so 02-typecheck.log is empty by design
  // and cannot show what the step covered. These are the artefact: every
  // script opts in, and the build reaches the project that checks them.
  const shipped = ['scripts', 'bin'].flatMap((dir) =>
    readdirSync(path.join(REPO, dir))
      .filter((f) => f.endsWith('.mjs'))
      .map((f) => `${dir}/${f}`),
  );

  it('there are scripts to check', () => {
    expect(shipped.length).toBeGreaterThan(20);
  });

  it('every script and the bin carry // @ts-check on their first lines', () => {
    const unchecked = shipped.filter((f) => !read(f).split('\n').slice(0, 2).includes('// @ts-check'));
    expect(unchecked).toEqual([]);
  });

  it('the build references the project that checks them, and it covers both directories', () => {
    const build = JSON.parse(read('tsconfig.build.json')) as { references: { path: string }[] };
    expect(build.references.map((r) => r.path)).toContain('./tsconfig.scripts.json');
    const scripts = JSON.parse(read('tsconfig.scripts.json')) as {
      include: string[];
      compilerOptions: { allowJs: boolean; checkJs: boolean };
    };
    expect(scripts.include).toEqual(expect.arrayContaining(['scripts/*.mjs', 'bin/*.mjs']));
    expect(scripts.compilerOptions.allowJs).toBe(true);
    // Off on purpose: a file opts in with the directive, and one without it is
    // visibly unchecked rather than silently included.
    expect(scripts.compilerOptions.checkJs).toBe(false);
  });
});

describe('the release workflow', () => {
  const release = read('.github/workflows/release.yml');

  it('publishes from a tag and from nowhere else', () => {
    expect(release).toMatch(/tags: \['v\*'\]/u);
    expect(release).not.toMatch(/branches:/u);
  });

  it('publishes with provenance and as public, which a scoped package is not by default', () => {
    expect(release).toContain('npm publish --provenance --access public');
    expect(release).toContain('id-token: write');
  });

  it('holds the tag to package.json and the changelog before anything else', () => {
    expect(release).toContain("require('./package.json').version");
    expect(release).toContain('CHANGELOG.md has no entry');
  });

  it('asks the attestation and the gate again on the runner', () => {
    expect(release).toContain('node scripts/check-attestation.mjs');
    expect(release).toContain('./verify.sh');
  });
});
