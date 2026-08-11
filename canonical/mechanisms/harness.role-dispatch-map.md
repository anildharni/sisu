---
kind: mechanism
id: harness.role-dispatch-map
title: "Generated role-dispatch map, checked both ways"
lifecycle: stable
effect: detective
plane: ci
bypassable-by: repo-admin
fail-mode: n/a
evidence-probe: local.self-verification
renders: [dispatch]
extracted-from:
  - "CLAUDE.md#Routing work to the agent system"
---

The root convention file carries a one-line-per-role dispatch section generated from the canonical role set, never hand-written, because rules that must survive context compaction live in the eagerly-loaded file. The suite checks that every dispatch target resolves AND every non-omitted role appears. The reference's hand-written roster drifted while every listed entry still resolved.
