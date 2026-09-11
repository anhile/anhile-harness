import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * The rule is one sentence: no comment is silently dropped. A session that
 * reads six comments, acts on four and reports on three has sampled, not
 * reviewed, and nothing in its own account of itself would reveal that.
 *
 * So the cases here are about the two ways a comment disappears. It can be
 * filtered as machinery — the only comment on the pull request this was
 * written against was a Vercel deployment notice, which a skill told to
 * "address every comment" would have tried to address — and it can be counted
 * as answered when nothing answered it.
 *
 * `--from` reads the API payload from a file, so every case runs offline
 * against a shape taken from the real API rather than against a mock of it.
 */
const REPO = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(REPO, 'scripts', 'review-comments.mjs');

type Comment = {
  id: string;
  kind: string;
  author: string | null;
  bot: boolean;
  path: string | null;
  line: number | null;
  inReplyTo: string | null;
  body: string;
};

const made: string[] = [];
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

function run(payload: unknown, json = true): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'review-comments-'));
  made.push(dir);
  const file = path.join(dir, 'payload.json');
  writeFileSync(file, JSON.stringify(payload));
  return execFileSync('node', [SCRIPT, '--from', file, ...(json ? ['--json'] : [])], {
    encoding: 'utf8',
  });
}

const parse = (payload: unknown): Comment[] => JSON.parse(run(payload)) as Comment[];

const inline = (over: Record<string, unknown> = {}) => ({
  id: 1,
  user: { login: 'anhile', type: 'User' },
  created_at: '2026-09-11T10:00:00Z',
  path: 'scripts/thing.mjs',
  line: 12,
  body: 'this returns before the check',
  ...over,
});

describe('the three things GitHub keeps apart become one shape', () => {
  it('reads an inline comment with its file and line', () => {
    const [c] = parse({ reviewComments: [inline()] });
    expect(c).toMatchObject({ kind: 'inline', path: 'scripts/thing.mjs', line: 12, author: 'anhile' });
  });

  it('reads the body of a review', () => {
    const [c] = parse({
      reviews: [{ id: 5, user: { login: 'anhile' }, body: 'the whole thing needs a rethink', state: 'CHANGES_REQUESTED' }],
    });
    expect(c).toMatchObject({ kind: 'review', body: 'the whole thing needs a rethink' });
  });

  it('reads a conversation comment', () => {
    const [c] = parse({ issueComments: [{ id: 7, user: { login: 'anhile' }, body: 'merging after the weekend' }] });
    expect(c).toMatchObject({ kind: 'conversation', body: 'merging after the weekend' });
  });

  it('drops a review with an empty body, which carries nothing to answer', () => {
    expect(parse({ reviews: [{ id: 5, user: { login: 'anhile' }, body: '', state: 'APPROVED' }] })).toEqual([]);
  });

  it('orders them oldest first, across all three kinds', () => {
    const got = parse({
      issueComments: [{ id: 7, user: { login: 'a' }, body: 'third', created_at: '2026-09-11T12:00:00Z' }],
      reviewComments: [inline({ id: 1, body: 'first', created_at: '2026-09-11T10:00:00Z' })],
      reviews: [{ id: 5, user: { login: 'a' }, body: 'second', submitted_at: '2026-09-11T11:00:00Z' }],
    });
    expect(got.map((c) => c.body)).toEqual(['first', 'second', 'third']);
  });
});

describe('bots are filtered and counted, never quietly discarded', () => {
  it('marks a Vercel deployment notice as a bot', () => {
    const [c] = parse({ issueComments: [{ id: 7, user: { login: 'vercel[bot]' }, body: '[vc]: …' }] });
    expect(c.bot).toBe(true);
  });

  it('marks anything GitHub types as a Bot, whatever it is called', () => {
    const [c] = parse({ issueComments: [{ id: 7, user: { login: 'some-new-thing', type: 'Bot' }, body: 'x' }] });
    expect(c.bot).toBe(true);
  });

  it('does not mark a person whose name merely ends in bot', () => {
    const [c] = parse({ issueComments: [{ id: 7, user: { login: 'robotnik', type: 'User' }, body: 'x' }] });
    expect(c.bot).toBe(false);
  });

  it('says how many it filtered and who they were, so the reader can disagree', () => {
    const out = run({ issueComments: [{ id: 7, user: { login: 'vercel[bot]' }, body: 'x' }] }, false);
    expect(out).toContain('1 from bots');
    expect(out).toContain('vercel[bot]');
  });
});

describe('what is still waiting on an answer', () => {
  it('counts an inline comment with no reply', () => {
    const out = run({ reviewComments: [inline()] }, false);
    expect(out).toContain('1 awaiting an answer');
    expect(out).toContain('scripts/thing.mjs:12');
  });

  it('stops counting it once something replies in its thread', () => {
    const out = run(
      {
        reviewComments: [
          inline({ id: 1 }),
          inline({ id: 2, in_reply_to_id: 1, body: 'fixed in the next commit' }),
        ],
      },
      false,
    );
    expect(out).toContain('0 awaiting an answer');
  });

  it('does not treat a later unrelated comment as an answer', () => {
    // The failure this prevents: a thread goes quiet without being resolved,
    // and the session reports it as handled because it said something after.
    const out = run(
      {
        reviewComments: [inline({ id: 1, created_at: '2026-09-11T10:00:00Z' })],
        issueComments: [
          { id: 7, user: { login: 'anhile' }, body: 'CI is green now', created_at: '2026-09-11T11:00:00Z' },
        ],
      },
      false,
    );
    expect(out).toContain('2 awaiting an answer');
  });

  it('never lists a bot as awaiting an answer', () => {
    const out = run(
      {
        reviewComments: [inline()],
        issueComments: [{ id: 7, user: { login: 'vercel[bot]' }, body: 'deployed' }],
      },
      false,
    );
    expect(out).toContain('1 awaiting an answer');
  });

  it('says what an answer has to be, rather than leaving it to taste', () => {
    const out = run({ reviewComments: [inline()] }, false);
    expect(out).toContain('changed, explained, declined, or moved to its own entry');
  });

  it('says plainly when nothing is waiting', () => {
    expect(run({ issueComments: [{ id: 7, user: { login: 'vercel[bot]' }, body: 'x' }] }, false)).toContain(
      'Nothing is waiting on a reply',
    );
  });
});
