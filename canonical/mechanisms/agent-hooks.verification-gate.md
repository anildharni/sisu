---
kind: mechanism
id: agent-hooks.verification-gate
title: "Verification gate decides on content identity"
lifecycle: stable
effect: preventive
plane: agent-runtime
bypassable-by: workspace-write
fail-mode: open
evidence-probe: local.agent-hooks-wired
requires:
  targets: [claude-code]
extracted-from:
  - ".claude/hooks/require-staged-diff-review.mjs"
---

A commit is allowed only when the index still hashes to a staged diff the agent was shown in an EARLIER tool call, in this session, within a TTL. The decision is on a content hash, never on command text — stage-and-commit in one call is one tool call. Its evidence class is review-observation: the store lives on the agent's machine and proves presentation, not comprehension. Fails open on errors.
