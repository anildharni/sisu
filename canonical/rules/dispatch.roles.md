---
kind: rule
id: dispatch.roles
title: "Routing work to roles"
section: dispatch
order: 10
enforced-by: [harness.role-dispatch-map, harness.self-verification]
---

Roles live in `{{roles.location}}`. This map is GENERATED from the role set and checked in
both directions by the self-verification suite; do not hand-edit it. Doing X → load role Y:

{{dispatch.map}}

Genuinely multi-step work starts at `orchestrator`, which classifies, gates and briefs before
any specialist builds. A single question or a change that already has a brief goes straight to
the matching specialist. The `implementer` never self-directs scope: it needs an approved
brief. For non-trivial logic changes, run a fresh-context `reviewer` pass on the diff before
committing — the author rationalizes its own diff. Roles consume knowledge by reading the
index and the fact files it names; a role file that restates a fact will drift from it.
