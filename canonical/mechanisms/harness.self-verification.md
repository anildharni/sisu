---
kind: mechanism
id: harness.self-verification
title: "Emitted self-verification suite"
lifecycle: stable
effect: detective
plane: ci
bypassable-by: repo-admin
fail-mode: n/a
evidence-probe: local.self-verification
strict: [self-verification-green]
extracted-from:
  - "backend/tests/claudeAgentRegistry.test.js"
  - "backend/tests/claudeHooks.test.js"
---

A zero-dependency test suite emitted with the harness runs in the required CI job and asserts: every role file parses under the documented frontmatter table, every cross-reference resolves, the dispatch map is complete in both directions, every restricted role carries its capability-restricting fields, actions are SHA-pinned, hooks are wired and behave against the known bypass shapes, and active knowledge meets the promotion bar. It runs on every commit with no sisu binary present. Reference incident: two role files sat unloadable for six weeks with zero error anywhere.
