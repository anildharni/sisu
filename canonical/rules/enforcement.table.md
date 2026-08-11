---
kind: rule
id: enforcement.table
title: "Enforcement: intended vs actual"
section: enforcement
order: 10
---

Every mechanism in this harness, whether installed, omitted or deprecated, with the
enforcement it intends and the weakest actor that can nullify it as DECLARED at emit time.
Live state (installed on this machine, host-observed facts, evidence age) comes from
`sisu doctor` where the generator is available and from `harness/catalog.json` otherwise.
Omission is permitted; silence is not.

{{enforcement.table}}
