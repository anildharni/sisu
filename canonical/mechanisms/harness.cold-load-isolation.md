---
kind: mechanism
id: harness.cold-load-isolation
title: "Cold-session load under isolated config"
lifecycle: stable
effect: detective
plane: agent-runtime
bypassable-by: workspace-write
fail-mode: n/a
evidence-probe: manual.cold-load
requires:
  targets: [claude-code]
---

The authoritative loader check runs the consuming tool in a clean temporary config directory AND asserts the workspace carries no local settings overlay, because a developer's global config silently supplying a missing file would falsify the one empirical test the harness rests on. It is manual and point-in-time; its evidence is declared until run.
