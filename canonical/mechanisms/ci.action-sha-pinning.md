---
kind: mechanism
id: ci.action-sha-pinning
title: "Third-party actions pinned to full SHAs"
lifecycle: stable
effect: detective
plane: ci
bypassable-by: repo-admin
fail-mode: n/a
evidence-probe: local.action-pins
requires:
  ci: [github-actions]
extracted-from:
  - "REVIEW-2026-08-21.md#Part 4 item 3"
---

Every uses: in the emitted workflow references a full 40-character commit SHA with the tag in a trailing comment; the self-verification suite fails on a mutable tag. The reference used mutable tags — the lesson was extracted, not the habit.
