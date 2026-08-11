---
kind: mechanism
id: ci.governance-literals
title: "Governance literals stay intact"
lifecycle: stable
effect: detective
plane: ci
bypassable-by: repo-admin
fail-mode: n/a
evidence-probe: local.self-verification
requires:
  ci: [github-actions]
extracted-from:
  - "scripts/governance-literals-check.mjs"
---

The root convention file states Tier-0 prohibitions as literal tokens. A check anchored per rule line asserts every anchored line still contains its literals, because a mangled literal silently stops the rule matching and no linter looks at prose. Anchored per line, not a word count: a decoy line above a corrupted one must not turn it green.
