---
kind: mechanism
id: governance.gate-checker-ownership
title: "The files that verify a mechanism are gated too"
lifecycle: stable
effect: detective
plane: ci
bypassable-by: repo-admin
fail-mode: n/a
evidence-probe: local.codeowners-static
requires:
  host: [github]
extracted-from:
  - ".github/CODEOWNERS#Load-bearing oracle tests"
---

Gating a directory does not gate the thing that verifies it. For every protected mechanism, its checker paths (per the stack pack's test convention) are in the owned/gated set, and the self-verification suite asserts the CODEOWNERS file still covers them. Reference incident: the governance directory was owner-gated while its only checker was not.
