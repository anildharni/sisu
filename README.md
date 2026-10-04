# sisu

**An agent-governance harness generator.** `sisu` installs a complete AI-agent development
harness into a software project — roles, change-control tiers, quality ratchets, hooks, an
accreting knowledge base, and an audit ledger — so that an agent working in that repo can
answer, from the repo alone:

> **What am I allowed to change here, and how will I know I didn't break it?**

> *Sisyphus's problem was never the hill — it was that nothing held.*
> A ratchet is the thing that makes progress irreversible. That's the whole product.

## Status

The generator is **implemented and exercised**, and dogfoods itself: the `CLAUDE.md`,
`.claude/agents/`, `harness/` and `.github/workflows/` in this repo are emitted by the
generator in this repo.

Verified by running the commands, not by reading this file:

| gate | command | result |
|---|---|---|
| typecheck | `npm run check` | 0 errors (`tsc --checkJs`) |
| canonical lint | `npm run lint:canonical` | OK |
| generator tests | `npm test` | **66 pass, 0 fail, 0 skipped** |
| agent-hook tests | `npm run test:assets` | **41 pass, 0 fail, 0 skipped** |
| all of the above | `npm run gate` | exit 0 |

107 tests, nothing skipped. The emitted self-verification suite is also asserted **RED** when
a role file or a cross-reference is deliberately broken — a gate never observed failing is not
yet evidence.

### Honestly not done

Stated here because a harness that hides its own gaps has already failed at its one job:

- **The cold-agent load check has not been executed.** A Python fixture project initializes and
  passes its emitted suite, but a cold agent under an isolated `CLAUDE_CONFIG_DIR` has no
  credentials, so `harness/scripts/cold-load-check.mjs` must be run by the owner.
- **`doctor --remote` has only run against a mocked `gh`** (status-spoofing, org-ruleset and
  CODEOWNERS error shapes). It has not been pointed at a real GitHub repository.
- **Byte-reproducibility is verified on one machine only** (two output directories, identical
  bytes, equal to the initialized repo). Not yet confirmed on Linux or a second machine.
- **No release tag exists**, so the dogfood is emitted from `HEAD` rather than from a release.
- **One declared v1 gap**: the GitHub expression-length cap guard is not extracted
  (recorded in `extraction-map.yaml`, reported by `sisu compare`).
- **`policy.approver` is unset**, so `.github/CODEOWNERS` is valid-but-empty and enforces
  nothing. `doctor` reports this at advisory.

## The problem

Agentic development produces code fast, and produces *regressions in your safety net* just as
fast: an agent under pressure will skip a test, add a type-check suppression, or weaken a CI
gate, and the build goes green while the guarantees quietly evaporate. Separately, every
hard-won root cause an agent discovers is lost at the end of the session — the next session
rediscovers it from scratch.

`sisu` installs the two things that fix this: **guardrails that are provably enforced**, with
honest reporting about which ones are merely written down, and **a knowledge base that accretes
verified lessons and expires stale ones**.

## What makes it different

Two properties differentiate it from adjacent tools (posture scanners, workflow linters,
snapshot ratchets), and the design leads with them:

- **Actor-relative enforcement honesty** — every guardrail reports exactly which actor it
  actually stops. A local git hook is a wall against an honest agent and tissue paper against
  a motivated one (`git push --no-verify` defeats it); a repo-level branch protection rule is a
  wall against a contributor but not against a repo admin. Most tooling reports a guardrail as
  simply "on" or "off" — `sisu` reports *against whom*. Every mechanism carries the tuple
  (effect, plane, bypassable-by, evidence-probe) and renders into
  [`harness/catalog.json`](harness/catalog.json).
- **Measurement-identity-bound ratchets** — a quality baseline (lint error count, test count,
  coverage) is meaningless without the exact command, config, and scope that produced it. A
  ratchet that doesn't bind to its own measurement identity can be silently gamed by narrowing
  what's measured rather than fixing what's broken. Changing the identity without an explicit
  `--rebaseline` is a hard failure, not a quiet re-baseline.

A full prime-directive list (self-sufficiency, domain-agnosticism, no model lock-in, no phoning
home, host facts probed rather than hardcoded) is in [SPEC.md](SPEC.md).

## Quickstart

Requires **Node ≥ 20** on `PATH`. The generator has **zero runtime dependencies** (dev-only:
`typescript`, `@types/node`).

```sh
npm install
npm run gate                      # typecheck + canonical lint + both test suites

node bin/sisu.mjs init            # interactive: install the harness into a target repo
node bin/sisu.mjs doctor          # what is installed, and against whom it holds
node bin/sisu.mjs doctor --strict # exit 1 if a named enforcement floor is unmet
node bin/sisu.mjs doctor --remote # read-only `gh api` checks against your own host
node bin/sisu.mjs upgrade         # regenerate the owned set; refuses on dirty owned paths
node bin/sisu.mjs compare         # declared-vs-extracted drift against the reference corpus
```

Nothing above makes a network call except `doctor --remote`. Offline, every remote-derived row
reports `unknown` — never green.

Inside a repo that has the harness installed, the maintenance scripts are repo-local and need
no `sisu` on `PATH`:

```sh
node harness/scripts/ratchet.mjs        # every quality metric against its baseline
node harness/scripts/index.mjs --check  # knowledge index currency + eager-context budget
node harness/scripts/drift.mjs          # facts whose subject changed since verification
node harness/scripts/ledger.mjs start   # open a run journal entry
```

## Repo contents

**Design and research** — the spec and the verification work behind it:

- [`SPEC.md`](SPEC.md) — the canonical design spec (v2.3).
- [`sisu-fable.md`](sisu-fable.md) — a deep-research verification pass and comparative tool
  survey that fed into the spec, checking its claims (GitHub ruleset semantics, CODEOWNERS
  behavior, Actions required-check gotchas) against primary sources.
- [`REVIEW-2026-08-21.md`](REVIEW-2026-08-21.md) — an adjudication report scoring that research
  input and a separate design review against the spec: what was verified, what was stale, and
  what changed as a result.
- [`CHECKPOINT.md`](CHECKPOINT.md) — the single batched design checkpoint: every decision taken
  during the build, with its argument.

**Implementation**:

| path | what it is |
|---|---|
| [`canonical/`](canonical/) | the source of truth, one mechanism / rule / role per file — `mechanisms/`, `rules/`, `roles/`, `schema/` |
| [`src/`](src/) | the generator: resolver, composer, emitters, detection, manifest, commands |
| [`assets/`](assets/) | vendored runtime (`lib/`) and emitted scripts, copied byte-identically into `harness/` |
| [`bin/sisu.mjs`](bin/sisu.mjs) | CLI entry point |
| [`test/`](test/) | generator tests, including the attack families and the pairwise acceptance matrix |
| [`extraction-map.yaml`](extraction-map.yaml) | provenance: which reference-corpus lesson each mechanism was extracted from, and the declared gaps |

**Emitted into this repo by itself** (do not hand-edit; use [`overrides/`](overrides/)):

| path | what it is |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | the composed root convention file |
| [`.claude/agents/`](.claude/agents/) | the 16 roles |
| [`harness/`](harness/) | vendored libs, maintenance scripts, git hooks, agent hooks, the self-verification suite, `catalog.json` |
| [`.github/workflows/`](.github/workflows/) | the emitted required-check workflow |
| [`sisu.yaml`](sisu.yaml) / [`sisu.lock.json`](sisu.lock.json) | intent file and generated manifest |
| [`project/`](project/) | user-owned: knowledge, ledger, waivers, quality baselines |

## Product contract

Combinations outside this table are reported `unsupported` and degrade loudly rather than
pretending to work.

| axis | supported |
|---|---|
| OS | `windows`, `linux` (CI on ubuntu). `macos` — untested |
| git host | `github` only |
| CI provider | `github-actions` only |
| maintenance runtime | `node` ≥ 20, must already be on `PATH` or `init` fails loudly |
| application stack packs | `node`, `python`, `custom` (declare your own oracles) |
| agent targets | `claude-code` (full fidelity), `agents-md` (fallback, degrades loudly) |

## Related

[`sisu-recall`](https://github.com/anildharni/sisu-recall) — authority- and staleness-aware
retrieval over this repo's governance corpus, with a judge-free evaluation harness built on
`harness/catalog.json` as its answer key. Deliberately a separate repository: `SPEC.md` rules
embeddings and vector search out of scope for `sisu` itself.

## License

MIT — see [LICENSE](LICENSE).
