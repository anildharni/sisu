---
kind: mechanism
id: ratchet.coverage-floor
title: "Coverage floors only rise"
lifecycle: stable
effect: blocking
plane: ci
bypassable-by: repo-admin
fail-mode: n/a
evidence-probe: local.ratchet-file
requires:
  ci: [github-actions]
extracted-from:
  - "scripts/e2e-journey-floor.mjs"
---

A floor metric (test-file count, coverage percentage) may only rise. It must initialize from a real measurement or an explicit non-vacuous minimum — a floor of zero asserts nothing and is rejected. A missing subject directory is a hard failure, never a pass over zero.
