---
kind: mechanism
id: ratchet.debt-ceiling
title: "Debt ceilings only fall"
lifecycle: stable
effect: blocking
plane: ci
bypassable-by: repo-admin
fail-mode: n/a
evidence-probe: local.ratchet-file
requires:
  ci: [github-actions]
extracted-from:
  - "scripts/eslint-ratchet.mjs"
  - "quality-baselines.json"
---

Each debt metric is measured by its stack-pack oracle and compared to a frozen baseline that may only tighten. A greenfield repo starts at zero. When debt drops, the script prints the new number and the baseline is lowered in the same PR. Raising a baseline to make CI pass is Tier 0; the baselines file is in the gated set.
