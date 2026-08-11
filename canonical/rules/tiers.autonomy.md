---
kind: rule
id: tiers.autonomy
title: "Autonomy tiers"
section: tiers
order: 10
enforced-by: [governance.autonomy-tiers, agent-hooks.deny-tier0-bypass, governance.codeowners]
---

**Tier 0 — permanently blocked. No human can authorize these; a commit containing one is
reverted, not approved:**
- `|| true`, `continue-on-error: true`, or removing/de-requiring a gate step in CI
- `--no-verify`, `-c core.hooksPath=…`, or editing a tracked hook to get past it
- a suppression added to silence a real error (`@ts-ignore`, `@ts-expect-error`, `as any`,
  `as unknown as`, `eslint-disable`, `# noqa`, `# type: ignore`, `# pragma: no cover`)
- skipping, deleting, or loosening a test or assertion (`.skip`, `.only`, `xit`, `xfail`
  used to pass, removing an `expect`/`assert`)
- raising a debt ceiling, lowering a coverage floor, or widening a checker's exclude/ignore
  list to make a gate pass
- hand-editing build output: anything under `harness/`, the manifest, or a generated file

**Tier 1 — stop and ask first.** Describe the change and its observable effect; wait for an
explicit yes before writing code. "I'll do it and explain after" is a violation:
- any change to observable behaviour a user sees or is blocked from
- authentication, authorization, tenancy or permission code; data-schema migrations
- CI workflows, the rules system (this file, `sisu.yaml`, `overrides/`), baselines, waivers
- the project's declared paths:
{{policy.tier1-paths}}

**Tier 2 — CI-gated autonomous** (branch → PR → merge when every gate is green and no gated
path is touched): fixing a failing test so that the specific red test goes green; adding tests
without touching existing assertions; fixing a genuine type or shape error; patch/minor
dependency updates that pass the audit gate; new code that follows an existing pattern and
ships with its test.

**Mid-task Tier-1 discovery = halt.** Commit nothing, explain what you found and why you
stopped, and wait.
