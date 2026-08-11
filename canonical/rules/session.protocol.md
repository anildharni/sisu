---
kind: rule
id: session.protocol
title: "Session protocol"
section: session
order: 10
enforced-by: [agent-hooks.verification-gate, agent-hooks.session-drift-tripwire, ledger.run-journal]
---

**Start — verify, don't trust.** Run the oracles and report the actual numbers:

{{oracles.table}}

Then read `{{knowledge.index}}` for the facts that touch the files you are about to change.
Start a ledger entry: `node harness/scripts/ledger.mjs start --task "<one line>"`.

**During.**
- One branch per task. Never carry two unrelated tasks on one branch. Assume other sessions
  own their branches; integration happens on `{{release.integration-branch}}`.
- Red CI on the integration branch = stop; fixing it is the only priority.
- Read the staged diff in its own tool call, then commit in the next one. Stage-and-commit in
  one call is blocked because nothing has seen the staged content.
- Evidence bar: state the number your hypothesis predicts, run the command, compare. One
  mechanism must explain every observation, including the negatives.

**Definition of done.** The real cause is fixed (not the oracle); all gates pass when you
actually run them; new behaviour has a test; no suppression was added; the summary reports
pass AND skip counts; any changed expectation is named and argued.

**End — leave something behind.** Capture each hard-won lesson as a candidate fact
(`node harness/scripts/capture.mjs "<title>"`, under thirty seconds) and close the ledger
entry (`node harness/scripts/ledger.mjs end`). Record gate verdicts with their CI run URL
where one exists.
