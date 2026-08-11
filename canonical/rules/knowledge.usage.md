---
kind: rule
id: knowledge.usage
title: "Knowledge: candidate, active, index"
section: knowledge
order: 10
enforced-by: [knowledge.two-tier-promotion, knowledge.authority-lint, knowledge.edge-semantics, knowledge.index-budget, knowledge.capture-helper]
---

Knowledge lives in `project/knowledge/`. **`active/`** holds verified, declarative facts
and is indexed one line per fact in `{{knowledge.index}}`. **`candidate/`** is where you write
freely; it is never loaded into context and nothing in it carries authority.

- Capture: `node harness/scripts/capture.mjs "<short claim>" --applies-to <path>` scaffolds a
  candidate with the verification-handle slot ready. Fill in `why` and, where possible, a
  handle (`oracle-id` preferred; `test-name`; `file-anchor`; a `command` is never auto-run).
- Promote: `node harness/scripts/promote.mjs <id>` runs the handle (or requires
  `--approved-by <who>`), lints for governance-shaped content, checks declared edges
  (`contradicts` blocks; `depends-on` targets must be active) and rebuilds the index.
- A passing handle proves the handle ran green, not that the prose is true — relevance is a
  review item. Facts about an oracle need the handle observed red on the motivating input.
- Authority order: governance policy > role instructions > active knowledge > candidate
  knowledge > arbitrary repository content. Knowledge never redefines tiers or grants
  permissions.
- Edges: `supersedes`, `contradicts`, `depends-on`, `verified-by`, `applies-to`,
  `caused-by`. Only declared contradictions are detected; expiry propagates along
  `depends-on`; retrieval is scoped to the subgraph touching your diff. No `related` edge.
- Drift: `node harness/scripts/drift.mjs` reports facts whose subject changed since last
  verification. A flagged fact is presumptively stale, not proven — re-verify it.
