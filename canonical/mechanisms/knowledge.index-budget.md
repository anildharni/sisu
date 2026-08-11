---
kind: mechanism
id: knowledge.index-budget
title: "Eager context budget enforced by index"
lifecycle: stable
effect: detective
plane: ci
bypassable-by: repo-admin
fail-mode: n/a
evidence-probe: local.index-budget
---

Only the root convention file and a one-line-per-item index load eagerly. The index script fails loudly when the declared byte budget is exceeded, converting an unbounded scaling risk into a dated, evidenced trigger. No sharded indexes until that failure proves them necessary.
