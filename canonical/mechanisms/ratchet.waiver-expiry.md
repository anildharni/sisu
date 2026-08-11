---
kind: mechanism
id: ratchet.waiver-expiry
title: "Waivers expire; expired is a hard fail"
lifecycle: stable
effect: blocking
plane: ci
bypassable-by: repo-admin
fail-mode: n/a
evidence-probe: local.waivers
requires:
  ci: [github-actions]
---

The only legal loosening of a debt ceiling is a human-approved waiver with a mandatory expiry and no auto-renew, scaffolded with the metric identity prefilled. An expired waiver fails the gate; it never silently reverts to the loosened number. Under a same-principal topology the approver field is labelled self-attested.
