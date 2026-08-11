---
kind: mechanism
id: governance.agent-identity-separation
title: "Agent identity separate from the approver"
lifecycle: stable
effect: blocking
plane: organization
bypassable-by: org-admin
fail-mode: n/a
evidence-probe: remote.agent-identity
requires:
  host: [github]
  topology: separate-principal
strict: [remote-wall]
extracted-from:
  - "CLAUDE.md#Repo ownership & agent identity"
---

When the agent pushes under a write-only identity and a different principal approves, a code-owner-gated change structurally cannot be self-merged. This is a property of credential topology, not of team size: one human with two principals gets it, an enterprise employee running the agent on their own admin credential does not. Omitted with reason under a same-principal topology; sisu never attempts to attest which credential produced a historical commit.
