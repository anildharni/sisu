---
kind: mechanism
id: ci.aggregator-verdict
title: "Aggregator runs under always() and inspects results"
lifecycle: stable
effect: blocking
plane: ci
bypassable-by: repo-admin
fail-mode: n/a
evidence-probe: local.ci-workflow-shape
requires:
  ci: [github-actions]
extracted-from:
  - "backend/tests/ciBackendGateWiring.test.js"
---

The required check is an aggregator job with a fixed name, no matrix, always() in its condition, and a verdict step that reads every needs.*.result explicitly and fails on anything but success. Without always() a failed upstream job skips the aggregator, and a skipped required check counts as satisfied.
