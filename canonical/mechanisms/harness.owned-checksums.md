---
kind: mechanism
id: harness.owned-checksums
title: "Owned files are checksummed"
lifecycle: stable
effect: detective
plane: local-git
bypassable-by: workspace-write
fail-mode: n/a
evidence-probe: local.owned-checksums
---

Every sisu-owned path has a content checksum (LF-normalized) and a mode bit recorded in the manifest. doctor and upgrade name each modified file individually and point at overrides/. Symlinks in the owned set are refused. Emitted directories are build output.
