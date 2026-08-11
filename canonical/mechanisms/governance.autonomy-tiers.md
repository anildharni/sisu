---
kind: mechanism
id: governance.autonomy-tiers
title: "Three autonomy tiers"
lifecycle: stable
effect: advisory
plane: agent-runtime
bypassable-by: workspace-write
fail-mode: n/a
evidence-probe: none
renders: [tiers]
extracted-from:
  - "CLAUDE.md#Agent Autonomy Tiers"
  - "docs/development/AGENT_DRIVEN_DEVELOPMENT_STRATEGY.md#11"
---

Tier 0 actions are permanently blocked and no human can authorize them; Tier 1 actions require a stop-and-ask with an explicit yes before any code is written; Tier 2 work is autonomous and CI-gated. The tiers are prose for the agent and a classification key for every other mechanism — on their own they stop nothing, which is why each tier names the mechanism that enforces it.
