---
kind: rule
id: change-control.paths
title: "Gated paths and the approver"
section: change-control
order: 10
enforced-by: [governance.codeowners, governance.gate-checker-ownership]
---

The following paths are gated: a change to any of them cannot merge without review from the
code owner, and the agent identity cannot self-approve. `.github/CODEOWNERS` is the single
source of truth for this list — do not copy it into other documents; copies rot.

{{policy.gated-paths}}

Approver: {{policy.approver}}

Gate-definition paths are gated for the same reason as the gates themselves: an agent that can
edit the baseline, the allowlist, the workflow or the test that verifies a hook can relax a gate
and self-merge. The files that VERIFY a protected mechanism are gated too — gating a directory
does not gate the thing that checks it. When moving or renaming any gated file, update
CODEOWNERS in the same change: protection does not follow renames.
