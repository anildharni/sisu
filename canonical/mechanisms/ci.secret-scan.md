---
kind: mechanism
id: ci.secret-scan
title: "Blocking secret scan, always zero"
lifecycle: stable
effect: blocking
plane: ci
bypassable-by: repo-admin
fail-mode: n/a
evidence-probe: local.ci-workflow-shape
covers: ["**"]
requires:
  ci: [github-actions]
strict: [remote-wall]
extracted-from:
  - ".github/workflows/pr-validation.yml#Secret scan"
  - ".gitleaks.toml"
---

A secret scan is an absolute invariant: never baselined, never waivable. It runs in the always-on job AND in the required job, so a docs-only PR cannot carry a secret. Its allowlist file is part of the gated set because one over-wide pattern disarms the whole wall; a real credential is rotated and removed, never allowlisted.
