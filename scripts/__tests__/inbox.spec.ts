/**
 * Fires at scripts/inbox.mjs, the checker for specs/inbox/.
 *
 * A Notion row has a schema; a file has this. It is intake's gate 0 for the
 * local source — the file is in the inbox and a person set it ready — and the
 * mechanical half of gates 1 and 2: sections present, every criterion one of
 * the five EARS patterns, at least one unwanted-behaviour criterion. The
 * script derives its root from its location, so it is copied into a throwaway
 * directory with an inbox of this test's making.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const REPO = path.resolve(__dirname, '..', '..');

let dir: string;
const run = (...args: string[]) => {
  try {
    return { status: 0, out: execFileSync('node', [path.join(dir, 'scripts', 'inbox.mjs'), ...args], { cwd: dir, encoding: 'utf8' }) };
  } catch (error) {
    const err = error as { status?: number; stdout?: string; stderr?: string };
    return { status: err.status ?? -1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
};

const spec = (over: Partial<{ status: string; front: string; criteria: string; sections: string }> = {}) => `---
name: Copy the short URL from the statistics view
status: ${over.status ?? 'Ready for intake'}
owner: Anhile
updated: 2026-09-08
${over.front ?? ''}---

# Copy the short URL from the statistics view

## Problem

Nothing to copy here.

## In scope

- a copy control

## Out of scope

- everything else
${over.sections ?? ''}
## Acceptance criteria

${over.criteria ?? `- **AC-1** (event-driven) — When the copy control is activated, the web app shall put the short URL on the clipboard.
- **AC-2** (unwanted) — If clipboard access is refused, then the web app shall leave the short URL selected and show no error dialog.`}

## Open questions

None.
`;

function put(name: string, text: string): string {
  writeFileSync(path.join(dir, 'specs', 'inbox', name), text);
  return path.join('specs', 'inbox', name);
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'inbox-'));
  mkdirSync(path.join(dir, 'scripts'));
  mkdirSync(path.join(dir, 'specs', 'inbox'), { recursive: true });
  copyFileSync(path.join(REPO, 'scripts', 'inbox.mjs'), path.join(dir, 'scripts', 'inbox.mjs'));
  // js-yaml resolves from the copy's location.
  symlinkSync(path.join(REPO, 'node_modules'), path.join(dir, 'node_modules'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('gate 0: in the inbox, and ready', () => {
  it('accepts a well-formed, ready spec', () => {
    const { status, out } = run('check', put('copy.md', spec()));
    expect(status).toBe(0);
    expect(out).toContain('ready for intake to read');
  });

  it.each(['Draft', 'In progress', 'Done'])('refuses status %s: a person sets ready', (s) => {
    const { status, out } = run('check', put('copy.md', spec({ status: s })));
    expect(status).toBe(1);
    expect(out).toContain(`status is "${s}", not "Ready for intake"`);
  });

  it('refuses a near-miss status rather than normalising it', () => {
    const { status, out } = run('check', put('copy.md', spec({ status: 'Ready to intake' })));
    expect(status).toBe(1);
    expect(out).toContain('must be exactly one of Draft, Ready for intake, In progress, Done');
  });

  it('refuses a file outside the inbox, however good', () => {
    mkdirSync(path.join(dir, 'docs'));
    writeFileSync(path.join(dir, 'docs', 'loose.md'), spec());
    const { status, out } = run('check', 'docs/loose.md');
    expect(status).toBe(1);
    expect(out).toContain('is not under specs/inbox/');
  });

  it('refuses a missing front-matter field and a placeholder left in one', () => {
    const noOwner = spec().replace('owner: Anhile\n', '');
    expect(run('check', put('a.md', noOwner)).out).toContain('"owner" is missing');
    const placeholder = spec().replace('owner: Anhile', 'owner: <who answers>');
    expect(run('check', put('b.md', placeholder)).out).toContain('"owner" is missing or still the template');
  });

  it('--any-status checks the shape of a draft without demanding ready', () => {
    expect(run('check', put('copy.md', spec({ status: 'Draft' })), '--any-status').status).toBe(0);
  });
});

describe('gates 1 and 2: sections and EARS', () => {
  it('refuses a missing section, naming it', () => {
    const text = spec().replace('## Out of scope\n\n- everything else\n', '');
    const { status, out } = run('check', put('copy.md', text));
    expect(status).toBe(1);
    expect(out).toContain('missing section "## Out of scope"');
  });

  it('refuses a spec with no criteria', () => {
    const { out } = run('check', put('copy.md', spec({ criteria: 'None yet.' })));
    expect(out).toContain('no acceptance criteria');
  });

  it('refuses a criterion whose sentence does not fit its pattern', () => {
    const bad = `- **AC-1** (event-driven) — The web app copies the URL when asked.
- **AC-2** (unwanted) — If it fails, then the web app shall say so.`;
    const { status, out } = run('check', put('copy.md', spec({ criteria: bad })));
    expect(status).toBe(1);
    expect(out).toContain('AC-1 does not read as event-driven');
  });

  it('refuses an unknown pattern name and a malformed line', () => {
    const bad = `- **AC-1** (sometimes) — When asked, the web app shall copy.
- **AC-2** unwanted: if it fails the app says so`;
    const { out } = run('check', put('copy.md', spec({ criteria: bad })));
    expect(out).toContain('pattern "sometimes" is not one of');
    expect(out).toContain('criterion is not `- **AC-n** (pattern) — sentence`');
  });

  it('refuses a list with no unwanted-behaviour criterion: the failure paths are unspecified', () => {
    const only = `- **AC-1** (event-driven) — When the copy control is activated, the web app shall put the short URL on the clipboard.`;
    const { status, out } = run('check', put('copy.md', spec({ criteria: only })));
    expect(status).toBe(1);
    expect(out).toContain('no unwanted-behaviour criterion');
  });

  it('refuses two responses in one criterion, and a placeholder left in one', () => {
    const two = `- **AC-1** (event-driven) — When the control is activated, the web app shall copy the URL and shall show a toast.
- **AC-2** (unwanted) — If <condition>, then the web app shall <response>.`;
    const { out } = run('check', put('copy.md', spec({ criteria: two })));
    expect(out).toContain('AC-1 names two responses');
    expect(out).toContain('AC-2 still carries a template placeholder');
  });

  it('accepts all five patterns when each reads as itself', () => {
    const five = `- **AC-1** (ubiquitous) — The web app shall render the short URL as text.
- **AC-2** (event-driven) — When the control is activated, the web app shall copy the short URL.
- **AC-3** (state-driven) — While the copy is in flight, the web app shall disable the control.
- **AC-4** (unwanted) — If the clipboard refuses, then the web app shall leave the URL selected.
- **AC-5** (optional) — Where the browser exposes a share sheet, the web app shall offer it.`;
    expect(run('check', put('copy.md', spec({ criteria: five }))).status).toBe(0);
  });
});

describe('list and status', () => {
  it('lists every spec with its status, skipping README and TEMPLATE', () => {
    put('README.md', '# not a spec');
    put('TEMPLATE.md', spec({ status: 'Draft' }));
    put('one.md', spec());
    put('two.md', spec({ status: 'Draft' }));
    const { out } = run('list');
    expect(out).toContain('Ready for intake   specs/inbox/one.md');
    expect(out).toContain('Draft              specs/inbox/two.md');
    expect(out).not.toContain('TEMPLATE');
  });

  it('status prints the status alone', () => {
    expect(run('status', put('one.md', spec({ status: 'In progress' }))).out.trim()).toBe('In progress');
  });

  it('says so when the inbox is empty', () => {
    expect(run('list').out).toContain('nothing in specs/inbox/');
  });
});

describe('this repository', () => {
  it('the template itself is refused, so nobody runs intake on it by mistake', () => {
    const out = (() => {
      try {
        execFileSync('node', [path.join(REPO, 'scripts', 'inbox.mjs'), 'check', 'specs/inbox/TEMPLATE.md'], { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        return 'accepted';
      } catch (error) {
        return String((error as { stderr?: string }).stderr ?? '');
      }
    })();
    expect(out).toContain('problem(s), intake does not proceed');
  });
});
