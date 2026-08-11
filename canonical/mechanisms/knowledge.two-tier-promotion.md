---
kind: mechanism
id: knowledge.two-tier-promotion
title: "Candidate to active requires verification or approval"
lifecycle: stable
effect: detective
plane: ci
bypassable-by: repo-admin
fail-mode: n/a
evidence-probe: local.knowledge-health
extracted-from:
  - ".claude/skills/#owner-reviewed knowledge layer"
---

Agents write freely to candidate/, which is never loaded into context. Promotion to active/ requires a passing verification handle or explicit human approval; the self-verification suite fails if an active fact lacks both. The failure mode this prevents is a wrong diagnosis inheriting the authority of documented.
