---
kind: mechanism
id: governance.codeowners
title: "Code-owner review on gate-definition paths"
lifecycle: stable
effect: blocking
plane: repository
bypassable-by: repo-admin
fail-mode: n/a
evidence-probe: remote.codeowners-errors
covers: ["{{policy.tier1-paths}}", "{{gate-definition-paths}}"]
requires:
  host: [github]
strict: [remote-wall]
extracted-from:
  - ".github/CODEOWNERS"
---

Every Tier-1 path and every gate-definition path (baselines, waivers, hook sources, CI workflow, the files that VERIFY a protected mechanism, and CODEOWNERS itself) requires code-owner review before merge. Enforcement needs the host's code-owner-review rule enabled, an approver with write access, a loadable file under 3 MB with no invalid lines, and an agent identity that cannot self-approve; doctor probes each of those silent-failure shapes. Bypassable by a repo admin editing the rule.
