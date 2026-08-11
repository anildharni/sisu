---
kind: mechanism
id: ci.coverage-scope
title: "Every change executes something"
lifecycle: stable
effect: detective
plane: ci
bypassable-by: repo-admin
fail-mode: n/a
evidence-probe: local.ci-workflow-shape
requires:
  ci: [github-actions]
extracted-from:
  - ".github/workflows/pr-validation.yml#changes"
  - "backend/tests/ciDocsOnlyClassifiers.test.js"
---

An always-on cheap job scans secrets and classifies the diff; heavy jobs skip ONLY via a job-level if on a proven docs-only diff, and any failure or undetermined diff un-skips them. Governance paths are never docs. A job-level skip reports success and satisfies a required check — doctor renders that as skipped counts as satisfied, never as green-by-omission.
