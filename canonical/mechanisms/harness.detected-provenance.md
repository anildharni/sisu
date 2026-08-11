---
kind: mechanism
id: harness.detected-provenance
title: "Detected findings carry provenance"
lifecycle: stable
effect: detective
plane: local-git
bypassable-by: workspace-write
fail-mode: n/a
evidence-probe: local.detected-staleness
---

Machine-written findings in the intent file are stamped with the commit they were detected against and a partial digest of the inputs read. doctor re-runs detection and diffs; a hand edit without a stated override reason is reported as an unaudited policy change wearing the costume of a fact.
