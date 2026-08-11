---
kind: rule
id: oracle-integrity.doctrine
title: "Oracle integrity"
section: oracle-integrity
order: 10
enforced-by: [governance.oracle-integrity, ratchet.debt-ceiling, ratchet.measurement-identity, ratchet.non-vacuity]
---

The oracles — type-checks, linters, test suites, audits, the CI gates — are what make
"green = working" trustworthy. **Never weaken an oracle to make it pass. Ask before, not
after.** Fix the real cause instead.

Allowed, and still called out in your summary: fixing the real cause; modifying a test ONLY
when its expectation was itself wrong (say so: "the test asserted X; correct behaviour is Y
because Z"); strengthening a gate after reaching green.

**Report oracle status honestly.** "47 pass / 55 skipped" means 55 oracles are switched off —
say that. Never present skipped, excluded or quarantined code as green. When you propose an
oracle-weakening change, state exactly what coverage is lost and wait for a yes.

**An oracle you have not executed is a comforting assumption.** An oracle never seen red is
not yet evidence: a check written for a bug is falsified against that bug before it counts.
Predict the number, run the command, compare — a hypothesis that only explains numbers after
seeing them is narration, not a test.
