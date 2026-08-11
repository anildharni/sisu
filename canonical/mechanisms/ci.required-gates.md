---
kind: mechanism
id: ci.required-gates
title: "Required CI gates"
lifecycle: stable
effect: blocking
plane: ci
bypassable-by: repo-admin
fail-mode: n/a
evidence-probe: local.ci-workflow-shape
covers: ["**"]
requires:
  ci: [github-actions]
strict: [remote-wall]
extracted-from:
  - ".github/workflows/pr-validation.yml"
---

One emitted workflow runs the stack pack's oracles, the ratchets, the self-verification suite and the secret scan as blocking steps inside jobs that are required checks on the protected branches. Third-party actions are pinned to full commit SHAs and merge_group is declared. A repo admin can remove the requirement, which is the honest bypassable-by.
