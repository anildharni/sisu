---
kind: mechanism
id: agent-hooks.session-drift-tripwire
title: "Session-start knowledge drift tripwire"
lifecycle: stable
effect: advisory
plane: agent-runtime
bypassable-by: workspace-write
fail-mode: open
evidence-probe: local.agent-hooks-wired
requires:
  targets: [claude-code]
extracted-from:
  - ".claude/settings.json#SessionStart"
---

At session start a hook reports active knowledge whose subject files changed since last verification, overdue re-verifications, and expired waivers. It never executes candidate-authored shell text. Its blind spot is stated: the absence of a warning and the absence of the tripwire look identical from inside a session, which is why the self-verification suite asserts it is still wired.
