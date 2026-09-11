/**
 * Fires at scripts/check-work-budget.mjs.
 *
 * The budget stops a session that has made too many tool calls since the
 * person last spoke. It had no test, and it counted every Bash call — so a
 * session reading its way through a repository to answer a question was
 * stopped at thirty before writing anything. Since 2026-09-08 a Bash call
 * spends the budget only if it does something: a read-only command does not,
 * a redirect or any unlisted verb does, and Edit/Write always do.
 *
 * The script derives its root from its own location, so it is copied into a
 * throwaway directory and driven through stdin exactly as the hook would.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const REPO = path.resolve(__dirname, '..', '..');

let dir: string;
let script: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'work-budget-'));
  mkdirSync(path.join(dir, 'scripts'));
  script = path.join(dir, 'scripts', 'check-work-budget.mjs');
  copyFileSync(path.join(REPO, 'scripts', 'check-work-budget.mjs'), script);
  // The hook reads its limit through the loader; the throwaway repository
  // carries the loader and, unless a case writes one, no configuration.
  copyFileSync(path.join(REPO, 'scripts', 'harness-config.mjs'), path.join(dir, 'scripts', 'harness-config.mjs'));
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

function fire(payload: Record<string, unknown>, limit = 30): { status: number; stderr: string } {
  try {
    execFileSync('node', [script], {
      input: JSON.stringify(payload),
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, WORK_BUDGET_LIMIT: String(limit) },
    });
    return { status: 0, stderr: '' };
  } catch (error) {
    const err = error as { status?: number; stderr?: string };
    return { status: err.status ?? -1, stderr: String(err.stderr ?? '') };
  }
}

function count(): number {
  try {
    return (JSON.parse(readFileSync(path.join(dir, '.generated', 'work-budget.json'), 'utf8')) as { count: number }).count;
  } catch {
    return 0;
  }
}

const bash = (command: string) => ({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } });

/** Like fire(), with no limit in the environment, so the configuration decides. */
function fireUnset(payload: Record<string, unknown>): number {
  const env = { ...process.env };
  delete env.WORK_BUDGET_LIMIT;
  try {
    execFileSync('node', [script], { input: JSON.stringify(payload), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], env });
    return 0;
  } catch (error) {
    return (error as { status?: number }).status ?? -1;
  }
}

describe('where the limit comes from', () => {
  it('keeps its state under .generated, which every project ignores', () => {
    // It lived under .claude/ until 2026-09-12, unignored, and the tree hash
    // counts unignored files: every tool call moved the hash, and every gate
    // run followed by one went stale.
    fire(bash('touch x'));
    expect(existsSync(path.join(dir, '.generated', 'work-budget.json'))).toBe(true);
    expect(existsSync(path.join(dir, '.claude'))).toBe(false);
  });

  it('reads session.workBudget from harness.config.json when the environment says nothing', () => {
    writeFileSync(
      path.join(dir, 'harness.config.json'),
      JSON.stringify({
        ...JSON.parse(readFileSync(path.join(REPO, 'harness.config.json'), 'utf8')),
        session: { workBudget: 2 },
      }),
    );
    expect(fireUnset(bash('touch a'))).toBe(0);
    expect(fireUnset(bash('touch b'))).toBe(0);
    expect(fireUnset(bash('touch c'))).not.toBe(0);
  });

  it('falls back to thirty rather than stopping every tool call when the configuration is unreadable', () => {
    writeFileSync(path.join(dir, 'harness.config.json'), '{ not json');
    expect(fireUnset(bash('touch a'))).toBe(0);
  });
});
const edit = { hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: 'x.ts' } };

describe('what spends the budget', () => {
  it('an Edit spends one', () => {
    fire(edit);
    expect(count()).toBe(1);
  });

  it.each([
    'git status',
    'git log --oneline -20',
    'cat README.md',
    'sed -n 1,40p CONTRIBUTING.md',
    'grep -rn TODO src | head',
    'ls -la && git diff --stat',
    'gh run list --limit 5',
    'node scripts/verify-log.mjs tail 20',
    'cat a.txt 2>&1',
    'find . -name "*.ts" >/dev/null',
  ])('a read-only Bash call spends nothing: %s', (command) => {
    fire(bash(command));
    expect(count()).toBe(0);
  });

  it.each([
    'sed -i s/a/b/ file',
    'rm -rf dist',
    './verify.sh',
    'pnpm install',
    'git commit -m x',
    'node scripts/migrate.mjs --yes',
    'cat a > b',
    'echo hi >> log.txt',
    'git status && touch marker',
    'mysterious-verb --flag',
  ])('a Bash call that does something spends one: %s', (command) => {
    fire(bash(command));
    expect(count()).toBe(1);
  });

  it('an empty command spends one rather than being waved through', () => {
    fire(bash(''));
    expect(count()).toBe(1);
  });
});

describe('the limit and the reset', () => {
  it('stops with exit 2 on the call past the limit, and says what to do', () => {
    fire(edit, 2);
    fire(edit, 2);
    const third = fire(edit, 2);
    expect(third.status).toBe(2);
    expect(third.stderr).toContain('STOP: 3 tool calls');
    expect(third.stderr).toContain('Ask whether to continue');
  });

  it('read-only calls do not bring the limit closer', () => {
    fire(edit, 2);
    fire(bash('git status'), 2);
    fire(bash('cat x'), 2);
    expect(fire(edit, 2).status).toBe(0);
    expect(fire(edit, 2).status).toBe(2);
  });

  it('a message from the person resets the count', () => {
    fire(edit, 2);
    fire(edit, 2);
    fire({ hook_event_name: 'UserPromptSubmit' }, 2);
    expect(count()).toBe(0);
    expect(fire(edit, 2).status).toBe(0);
  });

  it('ignores events it does not know', () => {
    fire({ hook_event_name: 'PostToolUse', tool_name: 'Edit' });
    expect(count()).toBe(0);
  });

  it('survives malformed input without stopping work', () => {
    const result = (() => {
      try {
        execFileSync('node', [script], { input: 'not json', encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
        return 0;
      } catch (error) {
        return (error as { status?: number }).status;
      }
    })();
    expect(result).toBe(0);
  });
});
