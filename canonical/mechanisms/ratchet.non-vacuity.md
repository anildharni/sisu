---
kind: mechanism
id: ratchet.non-vacuity
title: "An oracle never seen red is not evidence"
lifecycle: stable
effect: advisory
plane: agent-runtime
bypassable-by: workspace-write
fail-mode: n/a
evidence-probe: none
renders: [oracle-integrity]
extracted-from:
  - "backend/tests/ciDocsOnlyClassifiers.test.js#WHY IT IS WRITTEN THIS WAY"
---

A check born from a discovered failure ships a regression case built from the actual failing input, demonstrated red before the fix. When the historical input cannot pass cleanly, a documented known over-block is recorded rather than the oracle loosened. Applied to knowledge: a lesson about an oracle is promotable only when the handle was observed red on the motivating input.
