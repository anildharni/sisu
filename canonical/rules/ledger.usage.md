---
kind: rule
id: ledger.usage
title: "Ledger"
section: ledger
order: 10
enforced-by: [ledger.run-journal, ledger.ci-pointer]
---

Every run leaves one file in `project/ledger/runs/`: run id, commits before/after, each gate
run with its subject hash, verdict and CI run URL, knowledge captured and promoted, agent
identity and approval each labelled with an evidence level. Use
`node harness/scripts/ledger.mjs start|gate|end`. Nobody reads four hundred run files; they
grep them — keep the one-line summary accurate.

A record committed by the agent whose behaviour it records is not a tamper-independent audit
artifact. The CI run URL is the pointer to the one record you cannot write; it stays
`self-attested` until resolved against the host and is never presented as the verdict itself.
