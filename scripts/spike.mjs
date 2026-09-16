// @ts-check
/**
 * A spike branch proves nothing and cannot reach main (docs/INVARIANTS.md I16).
 *
 * The rituals here — the receipt at commit time, the journal at session end,
 * the contract, the audit — exist so that "done" is a claim a stranger can
 * check. Exploration claims nothing, so it has nothing to prove, and asking
 * it to prove something anyway is what makes the first week of a project
 * feel like ceremony: measured on 2026-09-16, about eight gate runs and
 * three commits per feature, with the gate itself taking twenty seconds.
 *
 * So a branch named `spike/<anything>` is exempt from every ritual that
 * asks for proof, and barred from the one place proof is required: the
 * commit gate lets a commit through with no receipt, the stop hook asks for
 * no journal entry, and `check-pr-ready` and CI's attest job refuse a pull
 * request from it. What survives a spike is rebuilt on a branch of its own
 * and closed the usual way. The protected-file rules (I11) still apply: a
 * spike does not edit the gate either.
 *
 * Used by the commit gate, the two session hooks, check-pr-ready and the
 * workflow; `node scripts/spike.mjs check --branch <name>` is the CI form.
 */
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const SPIKE_PREFIX = 'spike/';

/** @param {string | null | undefined} branch */
export function isSpike(branch) {
  return typeof branch === 'string' && branch.startsWith(SPIKE_PREFIX);
}

/** The checked-out branch, or '' when detached or outside a repository. */
export function currentBranch(cwd = process.cwd()) {
  try {
    return execFileSync('git', ['branch', '--show-current'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

/**
 * What a spike is, said once wherever a session or a reader meets one.
 * @param {string} branch
 */
export function spikeNote(branch) {
  return [
    `${branch} is a spike (docs/INVARIANTS.md I16): nothing here is proved, and nothing here reaches main.`,
    '  no receipt is asked at commit time, no journal entry at session end, no contract, no audit;',
    '  the protected files stay protected, and ./verify.sh still runs when you want to know.',
    '  What survives: rebuild it on a branch of its own — git checkout -b <name> main — with',
    '  the contract, the gate and the closure as usual. The spike is then deleted, not merged.',
  ].join('\n');
}

/**
 * The refusal a pull request from a spike gets, in check-pr-ready and in CI.
 * @param {string} branch
 * @param {string} [base]
 */
export function spikeRefusal(branch, base = 'main') {
  return `${branch} is a spike: it proves nothing and cannot reach ${base}. ` +
    `Rebuild what survives on a branch of its own (git checkout -b <name> ${base}) and close it the usual way.`;
}

/** @param {string[]} argv */
function main(argv) {
  const [command, ...rest] = argv;
  /** @param {string} name */
  const flag = (name) => {
    const i = rest.indexOf(name);
    return i === -1 ? null : rest[i + 1] ?? null;
  };
  if (command === 'check') {
    const branch = flag('--branch') ?? currentBranch();
    if (isSpike(branch)) {
      console.error(`spike: ${spikeRefusal(branch, flag('--base') ?? 'main')}`);
      process.exit(3);
    }
    console.log(`spike: ${branch || '(detached)'} is not a spike branch`);
    return;
  }
  console.error('usage: node scripts/spike.mjs check [--branch <name>] [--base <name>]');
  process.exit(1);
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2));
}
