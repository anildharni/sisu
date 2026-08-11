---
kind: mechanism
id: agent-hooks.deny-tier0-bypass
title: "Agent-runtime hook denies Tier-0 bypass commands"
lifecycle: stable
effect: preventive
plane: agent-runtime
bypassable-by: workspace-write
fail-mode: open
evidence-probe: local.agent-hooks-wired
requires:
  targets: [claude-code]
extracted-from:
  - ".claude/hooks/deny-git-no-verify.mjs"
---

A PreToolUse hook blocks git push --no-verify, core.hooksPath overrides and the other spelled-out Tier-0 bypass shapes, including behind git global options and inside sh -c payloads. It stops the convenient path for an honest agent; a determined actor edits or disables it, so it is preventive and bypassable at workspace-write. Fails open on malformed input; its behaviour is pinned by an executed test suite because a silently disarmed fail-open hook looks exactly like a working one.
