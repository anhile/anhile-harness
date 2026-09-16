<!--
The gate does not read this template; people do. Every line below is something
a mechanism already checks — the commit gate, verify.sh step 06, CI's attest
job — and the point of writing it here is that the reader can see the claim
next to the evidence without opening the tools.
CONTRIBUTING.md is the path this follows.
-->

## Contract

`specs/YYYY-MM-<slug>.md` — or "none: harness work under <the PROGRESS entry>".

## Entries

- Opened: #<id> … (`passes: false`, or already `true` when this same commit closed it; `spec` naming the contract above)
- Closed: #<id> — one per commit; each closing commit carries its READY audit under `audit-log/`
- Retracted: #<id> under the contract above, or none

## Evidence

- `verify-log/`: the run recorded for the tree of the last commit — `<id>  PASS  <sha>`
- `/verify-task` verdict for the closing commit(s): READY / not a closing change
- UI work: verified in the browser as a user would, on <what was tried>, snapshots under `.generated/ui/<ts>/` when agent-browser walked it; or "no UI change"

## Journal

`PROGRESS.md` entry: `## <date> — <title>`

## What a reviewer should look at

Two or three sentences: the decision that was not obvious, the invariant that
came closest, the thing the mechanisms cannot judge.
