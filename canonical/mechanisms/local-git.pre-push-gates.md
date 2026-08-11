---
kind: mechanism
id: local-git.pre-push-gates
title: "Pre-push runs the cheap gates"
lifecycle: stable
effect: preventive
plane: local-git
bypassable-by: workspace-write
fail-mode: open
evidence-probe: local.hooks-path
extracted-from:
  - ".githooks/pre-push"
---

The pre-push hook runs the stack pack's fast oracles and the ratchet check before a push leaves the machine, and defers to CI under an agent session instead of pretending to review. It fails open by design; CI is the wall.
