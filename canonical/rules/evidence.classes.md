---
kind: rule
id: evidence.classes
title: "What counts as evidence"
section: evidence
order: 10
enforced-by: [agent-hooks.verification-gate, ci.required-gates]
---

Two classes, always labelled:

- **artifact-verification** — a named oracle ran against subject hash X with verdict Y,
  produced OUTSIDE your mutation boundary. CI is the canonical producer. This is proof.
- **review-observation** — the configured workflow observed an artifact being presented to
  you (the staged-diff gate, the session evidence store). It lives on your machine, is
  writable by the same user, and proves neither comprehension nor authorship. This is UX.

Local git hooks and agent-runtime hooks are speed bumps: defeated by `--no-verify`, by a
`core.hooksPath` override, or by editing the tracked file. They exist for fast feedback and
accident prevention. A completed push is not proof any review ran. **CI is the wall.** A
check that merely discourages a change is never described as one that prevents it.
