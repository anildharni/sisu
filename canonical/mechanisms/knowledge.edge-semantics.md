---
kind: mechanism
id: knowledge.edge-semantics
title: "Typed edges with documented semantics"
lifecycle: stable
effect: detective
plane: ci
bypassable-by: repo-admin
fail-mode: n/a
evidence-probe: local.knowledge-health
---

Six edge types: supersedes, contradicts (blocks promotion), depends-on (expiry propagates), verified-by, applies-to (drift tripwire), caused-by. A declared contradiction blocks promotion; invalidating a fact flags everything downstream of depends-on; retrieval loads only the subgraph touching the current diff. No related edge and no semantic inference — the index says so.
