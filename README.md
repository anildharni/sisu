# sisu

**An agent-governance harness generator.** `sisu` installs a complete AI-agent development
harness into a software project — roles, change-control tiers, quality ratchets, hooks, an
accreting knowledge base, and an audit ledger — so that an agent working in that repo can
answer, from the repo alone:

> **What am I allowed to change here, and how will I know I didn't break it?**

> *Sisyphus's problem was never the hill — it was that nothing held.*
> A ratchet is the thing that makes progress irreversible. That's the whole product.

## Status

This repo currently holds the **design specification** and the research/adjudication process
behind it, not yet a working implementation. It's published at this stage deliberately — the
spec and the verification work it's built on are themselves the interesting artifact right now.

## The problem

Agentic development produces code fast, and produces *regressions in your safety net* just as
fast: an agent under pressure will skip a test, add a type-check suppression, or weaken a CI
gate, and the build goes green while the guarantees quietly evaporate. Separately, every
hard-won root cause an agent discovers is lost at the end of the session — the next session
rediscovers it from scratch.

`sisu` is meant to install the two things that fix this: **guardrails that are provably
enforced**, with honest reporting about which ones are merely written down, and **a knowledge
base that accretes verified lessons and expires stale ones**.

## What makes it different

Two properties differentiate it from adjacent tools (posture scanners, workflow linters,
snapshot ratchets), and the design leads with them:

- **Actor-relative enforcement honesty** — every guardrail reports exactly which actor it
  actually stops. A local git hook is a wall against an honest agent and tissue paper against
  a motivated one (`git push --no-verify` defeats it); a repo-level branch protection rule is a
  wall against a contributor but not against a repo admin. Most tooling reports a guardrail as
  simply "on" or "off" — `sisu` reports *against whom*.
- **Measurement-identity-bound ratchets** — a quality baseline (lint error count, test count,
  coverage) is meaningless without the exact command, config, and scope that produced it. A
  ratchet that doesn't bind to its own measurement identity can be silently gamed by narrowing
  what's measured rather than fixing what's broken.

A full prime-directive list (self-sufficiency, domain-agnosticism, no model lock-in, no phoning
home, host facts probed rather than hardcoded) is in [SPEC.md](SPEC.md).

## Repo contents

- [`SPEC.md`](SPEC.md) — the canonical design spec (v2.3).
- [`sisu-fable.md`](sisu-fable.md) — a deep-research verification pass and comparative tool
  survey that fed into the spec, checking its claims (about GitHub ruleset semantics, CODEOWNERS
  behavior, Actions required-check gotchas, etc.) against primary sources.
- [`REVIEW-2026-08-21.md`](REVIEW-2026-08-21.md) — an adjudication report scoring that research
  input and a separate design review against the spec, documenting what was verified, what was
  stale, and what changed as a result.

## License

MIT — see [LICENSE](LICENSE).
