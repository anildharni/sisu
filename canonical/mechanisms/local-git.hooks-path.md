---
kind: mechanism
id: local-git.hooks-path
title: "Tracked hooks via core.hooksPath"
lifecycle: stable
effect: preventive
plane: local-git
bypassable-by: workspace-write
fail-mode: open
evidence-probe: local.hooks-path
extracted-from:
  - "scripts/setup-hooks.sh"
  - ".githooks/pre-push"
---

Local git hooks are installed by pointing core.hooksPath at the tracked hooks directory — no copy, no drift, no version stamp. The unavoidable residue is one per-clone git config, reported by doctor as installed on THIS machine: yes / no / unknown. Defeated by --no-verify, by -c core.hooksPath=, or by editing the tracked hook; it is fast feedback, never a wall.
