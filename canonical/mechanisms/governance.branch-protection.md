---
kind: mechanism
id: governance.branch-protection
title: "Protected branches require the gates"
lifecycle: stable
effect: blocking
plane: repository
bypassable-by: repo-admin
fail-mode: n/a
evidence-probe: remote.branch-protection
covers: ["**"]
requires:
  host: [github]
strict: [remote-wall]
extracted-from:
  - "CLAUDE.md#Branch protection on main"
---

The default and integration branches require a pull request, the named required checks (strict / up-to-date), code-owner review, and forbid force-push and deletion. Wiring is emitted as a reviewable script that only the user runs; sisu never mutates remote policy. A repository-level ruleset is editable by any repo admin, which is why the actual-enforcement column says repo-admin, not none.
