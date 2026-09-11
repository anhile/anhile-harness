/**
 * Fires at the permissions block in .claude/settings.json.
 *
 * The block is the one part of the harness that binds the session's tools
 * rather than its commits: what it may not read, and which commands it may not
 * run. Until 2026-09-08 there was none. The session could open .env, which
 * holds the Stytch secret, and nothing refused a force-push or an rm -rf.
 *
 * Deny rules are a speed bump on the session's own permission surface, like the
 * commit gate: a person can lift any of them. What this suite guarantees is
 * that lifting one turns verify.sh step 03 red, so it is a visible act.
 *
 * The file is protected — the commit gate refuses a session's edit to it — so
 * these assertions are about a file only a person changes.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

const REPO = path.resolve(__dirname, '..', '..');
const settings = JSON.parse(readFileSync(path.join(REPO, '.claude', 'settings.json'), 'utf8')) as {
  permissions?: { deny?: string[]; allow?: string[] };
};
const deny = settings.permissions?.deny ?? [];
const allow = settings.permissions?.allow ?? [];

/** Every rule that has to be there, and the loss if it goes. */
const REQUIRED_DENY: Array<[rule: string, loss: string]> = [
  ['Read(./.env)', 'the session reads STYTCH_SECRET'],
  ['Bash(cat .env)', 'the session reads STYTCH_SECRET through the shell'],
  ['Bash(git push --force*)', 'a force-push rewrites origin/main unasked'],
  ['Bash(git push -f*)', 'the short flag does the same'],
  ['Bash(git reset --hard*)', 'uncommitted work is discarded'],
  ['Bash(rm -rf*)', 'a tree is deleted'],
  ['Bash(docker compose down -v*)', 'the development database volume is deleted'],
];

describe('the permissions block exists and denies the irreversible', () => {
  it('has a deny list, so this suite is not passing on an absent block', () => {
    expect(deny.length).toBeGreaterThan(5);
  });

  it.each(REQUIRED_DENY)('denies %s — otherwise %s', (rule) => {
    expect(deny).toContain(rule);
  });

  it('does not deny .env.example, which every session must be able to read', () => {
    // A broad pattern like Read(./.env*) would take the example file with it,
    // and the example is where the configuration is documented.
    const tooBroad = deny.filter((rule) => /Read\(\.\/\.env\*|Read\(\.\/\.env\.\*/u.test(rule));
    expect(tooBroad).toEqual([]);
  });

  it('never allows what it denies', () => {
    const conflicts = allow.filter((rule) => deny.includes(rule));
    expect(conflicts).toEqual([]);
  });

  it('allows the gate itself to run without a prompt', () => {
    expect(allow).toContain('Bash(./verify.sh)');
  });

  it('keeps the hooks that the commit gate suite already pins', () => {
    // Adding permissions must not have displaced the hooks block.
    expect(JSON.stringify(settings)).toContain('check-commit-gate.mjs');
  });
});
