import { execFileSync } from 'node:child_process';
import path from 'node:path';

/**
 * The brief the reviewers read. It has one line that comes from the record
 * of runs, and the record changed shape on 2026-09-12 with no suite to
 * notice: the second audit of #7 pointed at it.
 */
const REPO = path.resolve(__dirname, '..', '..');

describe('the review brief, against this repository', () => {
  const brief = execFileSync('node', [path.join(REPO, 'scripts', 'pr-review-brief.mjs')], { cwd: REPO, encoding: 'utf8' });

  it('quotes the newest recorded run at HEAD: its time, its verdict, its tree', () => {
    expect(brief).toMatch(/^Evidence: \d{4}-\d{2}-\d{2}T\S+  (PASS|FAIL|STALE)  sha256:[0-9a-f]{64}$/mu);
  });

  it('names the branch, the base and the range', () => {
    expect(brief).toMatch(/^Branch \S+ against \S+, range /mu);
  });
});
