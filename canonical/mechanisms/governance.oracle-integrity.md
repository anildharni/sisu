---
kind: mechanism
id: governance.oracle-integrity
title: "Oracle-integrity doctrine"
lifecycle: stable
effect: advisory
plane: agent-runtime
bypassable-by: workspace-write
fail-mode: n/a
evidence-probe: none
renders: [oracle-integrity]
extracted-from:
  - "CLAUDE.md#Oracle Integrity & Change Control"
  - ".claude/skills/staffezee-change-control/SKILL.md#Oracle-integrity doctrine"
---

Never weaken an oracle to make it pass; fix the real cause. Skipped, excluded or quarantined checks are oracles switched OFF and are reported as such, never as green. Strengthening a gate is encouraged and called out. This doctrine is enforced structurally by the ratchets, ownership gating and the self-verification suite; as prose it is advisory.
