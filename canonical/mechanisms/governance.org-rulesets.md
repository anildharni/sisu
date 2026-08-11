---
kind: mechanism
id: governance.org-rulesets
title: "Organization-level rulesets"
lifecycle: experimental
effect: blocking
plane: organization
bypassable-by: org-admin
fail-mode: n/a
evidence-probe: remote.branch-protection
covers: ["**"]
requires:
  host: [github]
strict: [remote-wall]
---

An organization ruleset can only be tightened from below, so it resists a repo admin. Where the probe confirms availability (org/enterprise scope; Team plan or above), the wiring script offers it with the stated trade-off: the required-workflows rule ignores event filters and always runs, which defeats docs-only cost skips. Probe, do not depend — host facts go stale.
