---
kind: mechanism
id: governance.required-check-binding
title: "Required checks bound to their expected source"
lifecycle: stable
effect: blocking
plane: repository
bypassable-by: repo-admin
fail-mode: n/a
evidence-probe: remote.required-checks-binding
requires:
  host: [github]
strict: [remote-wall]
extracted-from:
  - "REVIEW-2026-08-21.md#Part 4 item 5"
---

Anyone with write permission can set a commit status of any name, so a required check that is not bound to its expected GitHub App is spoofable at repo-write. The wiring binds each required check to its source App; doctor reports binding absent as bypassable-by repo-write, not repo-admin.
