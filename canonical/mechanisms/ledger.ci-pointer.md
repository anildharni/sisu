---
kind: mechanism
id: ledger.ci-pointer
title: "Ledger verdicts point at the CI record"
lifecycle: stable
effect: advisory
plane: local-git
bypassable-by: workspace-write
fail-mode: n/a
evidence-probe: remote.ledger-pointers
---

Each gate verdict in the ledger carries the CI run URL where one exists — the pointer to the one record the agent cannot write — which turns a transcription into a spot-checkable one. The pointer is agent-written, so it is self-attested until doctor --remote resolves it, unknown when hostless, and never rendered as the verdict itself.
