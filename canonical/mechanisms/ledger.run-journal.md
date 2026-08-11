---
kind: mechanism
id: ledger.run-journal
title: "One ledger file per run"
lifecycle: stable
effect: advisory
plane: local-git
bypassable-by: workspace-write
fail-mode: n/a
evidence-probe: none
renders: [ledger]
---

Each run writes one committed file: run id, commits before and after, gates run with subject hash and verdict, knowledge captured and promoted, agent identity and approval each with an evidence level. Greppable one-line summaries, stable field order. A record committed by the agent whose behaviour it records is not a tamper-independent audit artifact, and the file says so.
