---
kind: mechanism
id: ratchet.measurement-identity
title: "Measurement identity bound to every baseline"
lifecycle: stable
effect: blocking
plane: ci
bypassable-by: repo-admin
fail-mode: n/a
evidence-probe: local.ratchet-file
requires:
  ci: [github-actions]
---

Every metric records a declared identity — the argv, cwd, config files it reads, path scope and lockfile hash — and the baselines file stores its hash. If the identity changes and the stored hash does not, the gate fails loudly; re-baselining rewrites hash and number together in a gated file. This is what stops a baseline being improved by narrowing scope or swapping the parser. Transitive influences (plugin versions, extends chains) are OUTSIDE the declared identity and the output says so.
