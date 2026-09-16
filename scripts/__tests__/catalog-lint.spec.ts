import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * The catalog rule (apps/web/DESIGN.md), fired at. WEB_CATALOG_RULE is one
 * object: the generator writes it into a project's eslint.config.mjs, and
 * this suite lints fixture files under it with this repository's eslint and
 * typescript-eslint, so the rule a project gets is the rule held here. The
 * template's own Home.tsx and primitives are linted too: the seed page is
 * inside the catalog, and the catalog is where the raw material is allowed.
 */
const REPO = path.resolve(__dirname, '..', '..');
const ESLINT = path.join(REPO, 'node_modules', '.bin', 'eslint');

let dir: string;

type Message = { ruleId: string | null; message: string };
type Report = { filePath: string; messages: Message[] }[];

function lint(files: Record<string, string>): Record<string, Message[]> {
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), text);
  }
  let raw: string;
  try {
    raw = execFileSync(ESLINT, ['--format', 'json', ...Object.keys(files)], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; status?: number };
    if (!err.stdout) throw new Error(`eslint exited ${err.status}: ${err.stderr}`);
    raw = err.stdout;
  }
  const report = JSON.parse(raw) as Report;
  return Object.fromEntries(report.map((r) => [path.relative(dir, r.filePath), r.messages]));
}

const template = (rel: string) => readFileSync(path.join(REPO, 'templates', 'web', rel), 'utf8');
const messages = (out: Record<string, Message[]>, file: string) => (out[file] ?? []).map((m) => m.message).join(' ');

beforeAll(() => {
  // realpath: eslint reports the resolved path, and on macOS the temp dir is
  // reached through a symlink, so the report's keys would not match otherwise.
  dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'catalog-lint-')));
  // The project's config, in miniature: the parser this repository has, and
  // the rule as the generator writes it, imported from the module itself.
  writeFileSync(
    path.join(dir, 'eslint.config.mjs'),
    [
      `import tseslint from ${JSON.stringify(path.join(REPO, 'node_modules', 'typescript-eslint', 'dist', 'index.js'))};`,
      `import { WEB_CATALOG_RULE } from ${JSON.stringify(path.join(REPO, 'scripts', 'harness-templates.mjs'))};`,
      'export default tseslint.config(',
      "  { files: ['**/*.{ts,tsx}'], languageOptions: { parser: tseslint.parser } },",
      '  WEB_CATALOG_RULE,',
      ');',
      '',
    ].join('\n'),
  );
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('what the catalog refuses on a page', () => {
  it('an inline style', () => {
    const out = lint({ 'apps/web/src/Page.tsx': 'export const P = () => <div style={{ margin: 3 }}>x</div>;\n' });
    expect(messages(out, 'apps/web/src/Page.tsx')).toContain('no inline style');
    expect(messages(out, 'apps/web/src/Page.tsx')).toContain('DESIGN.md');
  });

  it('an arbitrary value in a class, in a string or a template', () => {
    const out = lint({
      'apps/web/src/A.tsx': 'export const A = () => <div className="mt-4 w-[13px]">x</div>;\n',
      'apps/web/src/B.tsx': "export const B = (on: boolean) => <div className={`p-2 ${on ? 'bg-[#123456]' : ''}`}>x</div>;\n",
      'apps/web/src/C.tsx': 'export const C = () => <div className={`text-[var(--x)]`}>x</div>;\n',
    });
    for (const f of ['apps/web/src/A.tsx', 'apps/web/src/B.tsx', 'apps/web/src/C.tsx']) {
      expect(messages(out, f)).toContain('no arbitrary value in a class');
      expect(messages(out, f)).toContain('DESIGN.md');
    }
  });

  it('a Radix import outside the catalog', () => {
    const out = lint({ 'apps/web/src/Menu.tsx': "import { Slot } from '@radix-ui/react-slot';\nexport const M = () => <Slot />;\n" });
    expect(messages(out, 'apps/web/src/Menu.tsx')).toContain('a primitive is written in components/ui');
    expect(messages(out, 'apps/web/src/Menu.tsx')).toContain('DESIGN.md');
  });
});

describe('what the catalog allows', () => {
  it('the same raw material inside components/ui', () => {
    const out = lint({
      'apps/web/src/components/ui/thing.tsx':
        "import { Slot } from '@radix-ui/react-slot';\nexport const T = () => <Slot className=\"w-[13px]\" style={{ margin: 1 }} />;\n",
    });
    expect(out['apps/web/src/components/ui/thing.tsx']).toEqual([]);
  });

  it("a page composed from the catalog: the template's own Home.tsx", () => {
    const out = lint({ 'apps/web/src/Home.tsx': template('apps/web/src/Home.tsx').replaceAll('__PROJECT_NAME__', 'probe') });
    expect(out['apps/web/src/Home.tsx']).toEqual([]);
  });

  it('the catalog itself: every primitive the template ships', () => {
    const files = Object.fromEntries(
      ['button', 'card', 'input', 'label'].map((n) => [`apps/web/src/components/ui/${n}.tsx`, template(`apps/web/src/components/ui/${n}.tsx`)]),
    );
    const out = lint(files);
    for (const f of Object.keys(files)) expect(out[f]).toEqual([]);
  });

  it('a class of plain tokens, and a square bracket that is not a value', () => {
    const out = lint({ 'apps/web/src/Ok.tsx': 'export const O = (xs: string[]) => <div className="bg-accent text-accent-fg rounded-md">{xs[0]}</div>;\n' });
    expect(out['apps/web/src/Ok.tsx']).toEqual([]);
  });
});
