# Build `sisu` — an agent-governance harness generator (v2.3)

## TL;DR

Build `sisu`: a CLI that installs a complete AI-agent development harness into a software
project — roles, change-control tiers, quality ratchets, hooks, an accreting knowledge base,
and an audit ledger — so that an agent working in that repo can answer, from the repo alone:
**"What am I allowed to change here, and how will I know I didn't break it?"**

`sisu` is being built as a focused, opinionated tool, not a platform. Build it accordingly:
no plugin API, no community surface beyond what a single maintainer can support.

Two properties differentiate it from every surveyed adjacent tool (posture scanners, workflow
linters, snapshot ratchets), and the design leads with them: **actor-relative enforcement
honesty** (each guardrail reports which actor it actually stops) and **measurement-identity-bound
ratchets** (a baseline is meaningless without the recorded command, config, and scope that
produced it).

## The problem this solves

Agentic development produces code fast and produces *regressions in your safety net* just as
fast — an agent under pressure will skip a test, add `@ts-ignore`, or weaken a CI gate, and the
build goes green while the guarantees quietly evaporate. Separately, every hard-won root cause
an agent discovers is lost at the end of the session; the next session rediscovers it.

`sisu` installs the two things that fix this: **guardrails that are provably enforced** (with
honest reporting about which ones are merely written down), and **a knowledge base that accretes
verified lessons and expires stale ones**.

The hardest question this tool must answer, per mechanism, is: **"against exactly which actor is
this control a wall?"** Everything in the enforcement model below exists to answer it honestly.

Positioning line, for tone: *Sisyphus's problem was never the hill — it was that nothing held.*
A ratchet is the thing that makes progress irreversible. That is the whole product.

## Prime directives — violate none of these

1. **The output must be self-sufficient.** Everything `sisu` emits is plain files: markdown,
   YAML, scripts, CI workflows. `sisu` is a generator and upgrader, **never a runtime
   dependency**. This includes ongoing maintenance: indexing, promotion checks, the expiry/drift
   tripwire, ledger capture, and the knowledge-capture helper are emitted as self-contained
   repo-local scripts, never invoked as `sisu <verb>`. A repo handed to someone else must keep
   working — gates enforcing, agents loading, knowledge maintained — with no `sisu` binary
   anywhere; hooks fire wherever their declared clone-local prerequisite (e.g. `core.hooksPath`)
   is active, and `doctor` reports them non-green where it is not. Own the flip side of this
   guarantee explicitly: a repo that works forever without sisu also *drifts* forever without
   sisu — fleet drift is out of scope by design (see NOT in scope), and `doctor --compare` per
   repo is the manual answer.
2. **Domain-agnostic, always.** A caseworker-management platform, a device-management tool, and
   a staffing product must all be equally well served. Ship the *shape*; each project grows its
   own *knowledge*. If a term, a stack, or an assumption is domain-specific, it does not belong
   in the core.
3. **Never lowest-common-denominator.** The canonical format expresses the FULL model. Weaker
   targets degrade loudly at emit time — computed against the capability manifest, not ad hoc —
   and the source is never reduced to fit the weakest target.
4. **No durable or authoritative hidden state, no phoning home.** Everything authoritative is
   files in git, diffable and auditable. No database, no embeddings, no telemetry. Two ephemera
   are permitted and must be disclosed as such: per-clone git configuration (e.g.
   `core.hooksPath`) and the expiring, hash-only session evidence kept by verification-gate
   hooks. Both are **workflow observations, not proof** — they live inside the agent's mutation
   boundary, are forgeable by construction, and are never presented as more (see the evidence
   classes in Component 1) nor written back as lasting truth. No network calls from sisu or from
   anything it emits, with exactly two user-invoked exceptions: `doctor --remote` (read-only
   queries against the user's own git host) and the emitted remote-wiring scripts of
   Component 1, which only the user runs. It must work air-gapped: a fact that needs the network
   reports `unknown` when offline — never green.
5. **No model lock-in, by non-dependence.** Never depend on a capability specific to one LLM.
   Model routing is the harness's job, not yours — do not build a router.
6. **Never three-way-merge prose.** Silent semantic corruption of a governance document is the
   worst failure mode in this system and is invisible to every oracle.
7. **Host facts are probed, never hardcoded.** Every statement about what a git host enforces
   is a point-in-time calibration that WILL go stale — this spec's own host facts were
   invalidated once between drafts (a plan-availability claim turned out to be a stale docs
   flag, not a real gate). Dated calibrations in this document are illustrations; `doctor`'s
   probes are the truth. Wherever a host fact matters, emit a probe, not a sentence.

## Reference corpus — pinned and constrained

Extract from Staffezee at commit **<REF_SHA>**, reading **only files as they exist at that
commit** — enumerate with `git ls-tree -r --name-only <REF_SHA>` and read with
`git show <REF_SHA>:<path>`; never the live worktree (`git ls-files` reads the index, not the
pin, and the working tree carries gitignored logs, local settings, and scratch scripts that are
noise, not mechanism). Treat the reference as a **requirements corpus, not a gold
master**: its prose narrates state and drifts (at spec-writing time its CLAUDE.md still said
backendEslintErrors 1506 / criticalE2eJourneys 25 while quality-baselines.json read 1502 / 39 —
the exact failure sisu's live-fact model attacks). When prose and mechanism disagree, the
mechanism — scripts, tests, configs — is the truth. The reference also has HABITS worth
rejecting even where the mechanism is sound; each is called out where it applies (mutable
action tags, copy-based hook install, tmpdir evidence, a hand-written role roster that drifted).

**Read scope (all tracked, all at <REF_SHA>):**

- `.claude/**` — governance spine, agent roles, skills, workflow scripts, pre-tool hooks, and
  `settings.json` (the hook wiring — the tracked, working precedent for repo-local enforcement)
- `CLAUDE.md` — root convention file: autonomy tiers, oracle-integrity doctrine, session
  protocol, and the "Routing work to the agent system" dispatch section (see Component 3 — that
  section exists in the root file, with its stated reason, because dispatch rules lost to
  context compaction were this harness's worst incident)
- `quality-baselines.json` — the live ratchet baselines (five debt ceilings + one coverage floor)
- `.github/CODEOWNERS` — the self-documenting register of every gate-definition path, with
  in-line reasons. Read it in full; it corroborates most of this list.
- `.githooks/**` — pre-push hook source — plus `scripts/setup-hooks.sh` / `setup-hooks.ps1`, its
  manual installer. Note the lesson, not just the files: the installer is tracked but nothing
  auto-runs it, so a fresh clone has **no** local hook until a human remembers (see Component 1).
- Ratchet machinery: `scripts/eslint-ratchet.mjs`, `scripts/strictnull-ratchet.mjs`,
  `scripts/governance-literals-check.mjs`, `scripts/workflow-expression-length.mjs`,
  `scripts/e2e-journey-floor.mjs` (extract the floor-ratchet *pattern* only — its subject, e2e
  tiering, stays out of scope), `backend/scripts/checkjs-ratchet.js`,
  `backend/scripts/eslint-ratchet.mjs`, `backend/scripts/strictnull-ratchet.js`
- CI wiring: `.github/workflows/pr-validation.yml` (the required-check jobs, ratchet steps,
  docs-only classifier, blocking secret scan) and `.gitleaks.toml`
- Harness-pinning tests — the harness testing ITSELF in CI: `backend/tests/claudeAgentRegistry.test.js`,
  `backend/tests/claudeHooks.test.js`, `backend/tests/ciDocsOnlyClassifiers.test.js`,
  `backend/tests/ciBackendGateWiring.test.js`, `backend/tests/workflowExpressionLength.test.js`.
  Read their header comments — they record the real incidents that motivated them, and several
  of the components below are generalizations of those incidents.
- `docs/development/AGENT_DRIVEN_DEVELOPMENT_STRATEGY.md` — sections 8 (operating model),
  10 (anti-patterns), and 11 (autonomy tiers) ONLY; the rest is instance history
- `package.json` + `backend/package.json` — how gate commands are wired as npm entrypoints
  (informative for stack packs, not portable content)

**Explicitly domain — do NOT extract content from:** `backend/CLAUDE.md` and `src/CLAUDE.md`
(~90% product-specific), `docs/security/RBAC_STANDARD.md`, the `backend/tests/*Lockstep.test.js`
files (product-schema drift oracles — same test *class* as the harness-pinning tests, different
subject), `e2e/**`, the deploy workflows, and everything under `backend/{prisma,middleware,
routes,services}`. Their *form* is sometimes instructive; their content is instance data.

**New designs, not extractions** — do not hunt for these in the reference; they do not exist
there: the per-fact knowledge graph and edge types, candidate→active promotion, the
agent-process ledger, the upgrade/checksum/manifest machinery, the hook-install experience, and
the `AGENTS.md` emitter. (The reference DOES have a tracked, owner-reviewed knowledge layer —
`.claude/skills/` — plus a per-session memory living *outside* its repo in the agent harness's
user directory. What is new in sisu is the per-fact granularity, the edges, and the promotion
lifecycle — not the idea of committed knowledge.)

## What v1 is deep on, and what it is deliberately shallow on

sisu is three systems: a **policy compiler** (resolver, emitters, checksums, upgrade), a
**posture auditor** (doctor, enforcement catalog, probes), and a **knowledge system**
(per-fact store, edges, promotion, ledger). The first two are extractions of mechanisms proven
in the reference; the third is a HYPOTHESIS about agent behavior — that agents will capture
under a 30-second budget and that promotion will actually happen. v1 ships all three (no
external deferrals), but is **uneven on purpose**: deep on the compiler, the auditor, and
honesty; shallow and cheaply reversible on knowledge and ledger. Concretely: the knowledge
engine ships its full schema and exactly the specified behaviors — no speculative extras — and
carries **pre-committed kill criteria**, defined before building: if, after an agreed real-use
window, the candidate→active promotion rate is ~zero and `candidate/` is a graveyard, the
designed retreat is a single human-curated tier. The two-tier directory layout makes that
retreat nearly free — that is a claimed property, not an accident. A pre-committed exit is not
a deferral (it promises no future work; it names the conditions under which less is more), and
it is this spec's own idiom — the same shape as waiver expiry and index-budget overflow.
`doctor` carries the loop's health telemetry (Component 6) so "the loop is dead" is a measured
state, never a vibe.

## Architecture

### The two-layer split (this is what makes everything else tractable)

- `harness/` — **mechanism**. `sisu`-owned. Regenerated wholesale on `upgrade`. Checksummed.
- `project/` — **knowledge**. User-owned. `upgrade` never touches it.
- `overrides/` — user customization of mechanism, preserved by construction across upgrades.
  Override semantics are **whole-file replacement only** — never patching, never merging
  (directive 6) — and overrides are applied **exactly once, by the resolver** (below), never a
  second time by an emitter.
- **Canonical granularity rule (load-bearing, decided before the tree is authored):** canonical
  source files are SMALL — one mechanism, one role, one rule per file — and emitters COMPOSE
  them into large target files. Compose at emit; override at source granularity. Because the
  unit of override is the unit of the file, a coarse tree turns a one-line customization into a
  fork of a whole document that forfeits every future canonical improvement to it — and enough
  such forks turn stale-base warnings into a wall the user learns to ignore, which is exactly
  how a silently-reverted security fix gets through the mechanism built to stop it. The
  composition order and the composed set are recorded in the artifact graph. The reference
  corroborates both directions: its monolithic root file's hand-written role roster drifted
  (the file itself confesses it and tells readers to re-derive by grep), while its per-file
  `.claude/agents/*.md` layer was machine-checkable and got pinned by a registry test.

### The policy resolver — pure, and the one producer of truth

```
   stack/SCM detection  →  normalized findings, committed under `detected:` in the intent file
                                       |
canonical mechanisms + committed intent file + project policy + overrides
                          |
                 PURE policy resolver      (overrides applied here, exactly once;
                          |                 same commit ⇒ same bytes on any machine)
              resolved artifact graph
               ├─ final bytes and paths (composed from small canonical sources)
               ├─ ownership + checksums    (the complete sisu-owned write set)
               ├─ capabilities / floors / named --strict predicates, per target
               └─ evidence-probe specifications
                  /                    \
        target emitters               doctor + live probes (ephemeral report only)
```

- **The resolver is a pure function of committed inputs.** Detection (stack, package manager,
  test runner, CI, git host, credential topology…) runs at `init` and writes its normalized
  findings into the intent file, where they are auditable in git; live machine or remote state
  NEVER participates in producing bytes or checksums. This is the property everything
  downstream leans on: `upgrade`'s dirty-tree refusal, the per-file checksum warnings, and
  `doctor --compare`'s structural diff are all meaningless if two machines emit different bytes
  from the same commit.
- **Detected findings are data, not policy — and the file must keep them apart.** Machine-
  written findings live under a `detected:` namespace, each stamped with the commit it was
  detected against plus a digest of the detection inputs (the manifest/lockfile/config paths
  the probe read — a PARTIAL digest, disclosed as such). `doctor` carries a standing probe that
  re-runs detection and diffs against the committed findings, so staleness is loud. A manual
  edit inside `detected:` is flagged as an override requiring a stated reason — otherwise a
  human "fixing" a finding is a silent, unaudited policy change wearing the costume of a fact,
  the 1506-vs-1502 failure reproduced inside sisu's own control file.
- **Emitters are pure functions too.** An emitter takes (graph node, target contract version)
  and nothing else — no clock, no environment, no installed-tool probing. One emitter that
  peeks at `claude --version` to "adapt" quietly destroys byte-reproducibility. Target
  knowledge (a tool's discovery chain, size caps like Codex's ~32 KiB combined instruction
  budget) enters as COMMITTED CONSTANTS keyed by target contract version; line endings, path
  separators, and mode bits resolve from the declared product contract, never from
  `process.platform`. The rule ships with its oracle: the byte-reproducibility test in the
  acceptance matrix.
- **Exactly one producer of resolved policy.** The resolver returns a resolved **artifact
  graph** — final bytes and paths, ownership and checksums, per-target capabilities/floors/
  predicates, and the specifications of the evidence probes `doctor` will run. Emitters RENDER
  the graph into a target layout; they never apply policy or overrides themselves. `doctor`
  consumes the same graph; its live local/remote findings are an **ephemeral report**, never
  written back as lasting truth.
- Exactly **two** committed control files, clearly typed, never a third:
  - the **intent file** (hand-editable): schema version, profile, targets, stack packs, release
    model, policy floors, credential-topology declarations, and the `detected:` findings block;
  - the **generated manifest** (the single lock): generator version, resolved pack content
    hashes, target contract versions, the owned write set, **checksums (only here — a checksum
    inside a hand-editable file is a second producer of truth)**, capabilities, `--strict`
    predicates, and override metadata.
- **Exactly three version axes**, with one stated compatibility policy: generator version,
  project schema version, target contract version. Stack packs and the mechanism catalog ship
  WITH the generator, never independently — independent pack versioning is a distribution
  concern for a product with third-party authors, a category this tool rules out by
  construction. (The manifest still records each resolved pack's content hash — that is
  auditability, not a version axis.) Policy: project schema older than generator → `upgrade`
  STOPS with a migration path; target contract drift → loud degradation per directive 3.

### The enforcement model — actor-relative, honestly reported

Every mechanism in the catalog carries three orthogonal fields plus evidence:

- **effect**: `blocking` | `preventive` | `detective` | `advisory` | `none` — where
  `preventive` means "stops the convenient path, not a determined actor".
- **plane**: `agent-runtime` | `local-git` | `ci` | `repository` | `organization`.
- **bypassable-by**: the WEAKEST actor class that can nullify the mechanism —
  `workspace-write` | `repo-write` | `repo-admin` | `org-admin` | `none`. Actor classes are
  nested, so this single ordinal carries the whole resistance profile; a boolean-per-actor
  matrix invites inconsistent fill-in and encodes nothing more.
- **evidence**: `{ kind: declared | observed, observed-at, probe }` — `unknown` lives here, so
  "blocking, but the evidence is stale" is representable without lying about the mechanism.

**The catalog is an internal API.** Mechanism ids are the join key for four consumers — doctor
rows, `--compare`, the extraction map, and the `--strict` predicates — and the extraction map
records them against a pinned reference SHA, so an id is never reused or silently repurposed.
The catalog carries a SCHEMA version (its content ships with the generator — see the version
axes), and each mechanism carries a lifecycle state: `experimental` | `stable` | `deprecated`.
Deprecation is the only retirement path, and a deprecated mechanism still renders in doctor —
"omission is permitted; silence is not" applied to the catalog itself. Lifecycle is orthogonal
to the enforcement tuple: an `experimental` mechanism can still be `blocking`.

`doctor --strict` evaluates **named predicates from a fixed set defined in the manifest schema**
(e.g. `effect = blocking AND plane ∈ {ci, repository, organization} AND bypassable-by ≥
repo-admin`) — never an enum rank. There is no total order over mechanisms: a self-disabling
local hook and a CI-run detective ratchet would rank exactly backwards under any linear scale.
No user-authored predicate DSL — a DSL is a second producer of truth.

**Hard rule, verified empirically (throwaway repos, git 2.52):** a repo-managed git hook is
defeated by `git push --no-verify`, by `git -c core.hooksPath=/dev/null push` (also with a
nonexistent dir or empty value — a command-line `-c` outranks repo config), or by editing the
tracked hook. Pro Git says it plainly: *"If your intent with these scripts is to enforce a
policy, you'll probably want to do that on the server side."* So a repo-managed hook is always
`effect: preventive, plane: local-git, bypassable-by: workspace-write` and **may never satisfy a
`--strict` floor**. Hooks earn their keep as fast feedback and accident prevention — the
reference designs them this way on purpose (they fail open and defer to CI) — not as walls.

Host calibration — per directive 7 these are dated illustrations; the probes are the truth
(all verified against official GitHub docs/changelogs, 2026-08-21):

- Repo-level rulesets are editable and disable-able by repo admins → `bypassable-by:
  repo-admin`; organization-level rulesets can only be tightened from below → they resist
  `repo-admin`. Org rulesets — **including the "require workflows to pass before merging"
  rule — are available on the Team plan** (GitHub Changelog 2025-06-16; the rule renders only
  in the enterprise docs version because of a stale 2023 docs feature-flag, a documentation
  artifact this spec previously mistook for a plan gate — the fpt REST reference documents the
  org `workflows` rule type in full). Its gotchas carry over: org/enterprise scope only; the
  required workflow must declare `pull_request`/`pull_request_target`/`merge_group` in `on:`;
  event filters are IGNORED (it always runs — which conflicts with docs-only cost-skip
  economics); and it blocks direct pushes on targeted branches.
- "Workflow execution protections" are in public preview (Changelog 2026-06-18) at
  enterprise/org/repo scope — actor rules and event rules on the rulesets framework, with
  evaluate mode. Probe, don't depend.
- Anyone with WRITE permission can set a commit status of any name, so a required check not
  bound to its source is spoofable at `repo-write`; binding the check to its **expected GitHub
  App** is the documented defense. CODEOWNERS is resolved from the PR **base** branch.
- Since 2025-12-08, `pull_request_target` takes BOTH its workflow file and its checkout ref
  from the default branch (GITHUB_REF/GITHUB_SHA resolve there), closing the outdated-workflow
  ("zombie") class — the rule "never explicitly check out untrusted PR code in privileged
  workflows" stands regardless.
- An Actions policy can REQUIRE full-SHA pinning of actions (Changelog 2025-08-15), and
  immutable releases are GA (2025-10-28; the separate "immutable actions" OCI approach was
  closed as not planned — superseded by immutable releases).

`doctor --remote`'s probes cover all of these — ruleset source level, check-source binding,
CODEOWNERS enforcement, workflow-protection state — each row stamped `observed-at`.

### Canonical source → emitters

One canonical tree of markdown + YAML frontmatter with a **documented schema**. Write the schema
down explicitly — the primary consumers of this format are AI agents, and a written spec is the
difference between an agent that reliably generates these files and one that guesses. sisu's own
CI lints the canonical tree against that schema (labeled `detective` — it is a conformance
validator, not a consumer's parser); Component 11 only verifies EMITTED output, and an
unenforced written schema drifts by exactly the mechanism this tool exists to stop.

Emitters compile canonical → a target harness's layout. **v1 targets: Claude Code (full
fidelity) and a portable, human-readable fallback (`AGENTS.md`).** The fallback's honest claim
is calibrated per tool and recorded in the manifest as an automatic-load status: `observed`
for tools with a documented discovery chain (e.g. Codex: root-down directory precedence,
~32 KiB default COMBINED instruction cap with silent truncation — keep the emitted fallback
under it), `needs-config` where a setting must be flipped, `needs-import-shim` where a bridge
line is required (Claude Code does not auto-load AGENTS.md; its documented bridge is an
`@AGENTS.md` import from CLAUDE.md — irrelevant for repos using the full-fidelity Claude
target, load-bearing for fallback-only repos), and `advisory` for arbitrary tools. Never claim
"works in any tool"; that is an unverifiable capability assertion of exactly the kind `doctor`
exists to kill. Add other targets only when actually adopted.

Emitted directories are **build output**: one-way, regenerable, never hand-edited. Checksums
warn if someone edits them — naming each modified file individually — and point them at
`overrides/`.

### CLI surface

`init` · `emit --target <harness>` · `doctor [--remote] [--strict] [--compare] [--format=json]` · `upgrade` · `index`
(`adopt`, for retrofitting existing repos, is **designed for but not built** in v1. `index` and
every other recurring maintenance operation also exists as an emitted repo-local script — the
CLI verbs are conveniences over those scripts, never the only path.)

`doctor`'s output is a CONTRACT, not a printout: a versioned JSON schema ships alongside the
human table from day one, with stable field order and volatile fields (observed-at, durations,
run ids) segregated so runs diff cleanly. The CI boundary is pre-decided: remote probes never
run in CI anywhere; `--format=json` is for sisu's OWN repo's CI (the dogfood lane) and for
human diffing — `doctor` is NEVER emitted into a consuming repo's jobs, or every emitted repo
acquires a sisu runtime dependency and directive 1 is dead. Downstream posture-in-CI, where
wanted, is a probe specification rendered into the emitted self-verification suite
(Component 11) — the artifact graph already carries the probe specs.

## Components to build

**1. Governance spine.** Three autonomy tiers (Tier 0 permanently blocked / Tier 1 stop-and-ask /
Tier 2 CI-gated autonomous), the oracle-integrity doctrine (never weaken a gate to make it pass),
CODEOWNERS provisioning, branch-protection wiring, and pre-tool hooks. Rules:

- **Profile ≠ credential topology.** The profile captured at `init` (solo / lead+team /
  enterprise) records team shape and sets defaults; whether a guardrail can structurally enforce
  depends on FOUR separate facts, each detected-or-`unknown` in the intent file: agent
  principal, approver principal, the agent's repo role, and same-principal-as-human (derived).
  The reference proves they are independent: ONE human running a two-principal topology
  (owner-approver + write-only agent identity) gets structural CODEOWNERS enforcement that a
  naive "solo → omit CODEOWNERS" rule would throw away, while an enterprise employee running the
  agent on their own admin credential gets none. Emit decisions key on topology; `doctor
  --remote` verifies role and separation where the host answers and reports `unknown` offline.
  sisu never attempts to attest which credential produced a historical commit — that is
  unknowable from the repo, and machinery pretending otherwise manufactures false assurance.
- Profiles may **omit** mechanisms they cannot enforce; `doctor` still lists EVERY catalog
  mechanism, installed or not, with its state and the reason for omission. Omission is
  permitted; silence is not.
- **sisu never mutates remote policy** — not implicitly, not behind a flag. Branch-protection
  and CODEOWNERS wiring is emitted as reviewable, checked-in wiring scripts or documented
  commands that ONLY the user invokes — never called by `init`, `emit`, `doctor`, or any emitted
  hook — and a wiring script prints the mutations it intends before applying them. Where the
  host supports it, the wiring binds each required check to its expected App source, and — on
  hosts/plans where the probe confirms availability — offers the org-plane options (org-level
  required workflows, workflow execution protections) with their trade-offs stated (the
  required-workflows rule ignores event filters, so it defeats docs-only cost skips). `init`
  records branch-protection state as `unknown` until `doctor --remote` actually observes it.
- **CODEOWNERS fails silently in four documented ways, so provisioning ships with probes**:
  a file over 3 MB is not loaded at all; an invalid line is skipped (ONLY that line — the rest
  of the file still applies, so the probe asserts per-line behavior and reads the host's
  CODEOWNERS-errors API where available); an owner without write access (or a non-visible
  team) is silently ignored; `!` negation is unsupported. Plus: the code-owner-review rule must
  be separately enabled, and the CODEOWNERS file must own itself. Every one of these leaves a
  merge gate that LOOKS configured while enforcing nothing — doctor's favorite meal.
- **Coverage-scope invariant.** Every mechanism declares the change-set it claims to cover, and
  for every change in that set something must EXECUTE: either the required job runs, or the
  mechanism also runs in an always-on cheap job whose failure un-skips the required job.
  Deliberate skip patterns (e.g. a docs-only cost control) are legal ONLY when the skip-decider
  is fail-safe toward running, lives in the owned/gated set, and is pinned by an EXECUTED test —
  the reference runs this pattern soundly and got burned only where a governance-shaped change
  slipped through the docs classifier, which is why the classifier carve-outs exist. `doctor`
  renders "skipped counts as satisfied" as a first-class row, never green-by-omission. GitHub
  mechanics the emitter must respect (verified): a job-level `if:` skip reports SUCCESS and
  satisfies the required check, while a workflow-level path filter leaves the check PENDING and
  blocks the merge — so intended skips are job-level `if:`, aggregator/verdict jobs run under
  `always()` and inspect `needs.*.result` explicitly (a skipped aggregator is itself
  "satisfied"), required workflows declare `merge_group` where merge queues exist, and
  third-party actions in emitted workflows are **pinned to full commit SHAs** (the reference
  uses mutable `@v5` tags — extract the lesson, not the habit).
- **Verification-gate hooks decide on state, not text — and their evidence is classed
  honestly.** A hook whose job is "was X actually verified before Y is allowed" decides on a
  content hash of the verified artifact (keyed by repo + session, with a TTL) — never by
  pattern-matching the invoking command's text, which the reference proved is defeated *by
  construction* (`add && diff && commit` is one tool call, so the commit runs before anything
  was read; and a hook that inspects tool-invocation text is blind to the same command wrapped
  in a script). Every emitted hook declares **fail-open or fail-closed** explicitly (surfaced in
  doctor's actual-enforcement column) and ships an **executed** test suite covering the known
  bypass shapes: piped/redirected output, wrapper scripts, `-C`-style path decoys, cross-session
  reuse, staleness, mention-vs-invocation. Evidence comes in two classes and is labeled:
  **artifact-verification** — a named oracle ran against subject hash X with verdict Y,
  objective only when produced outside the agent's mutation boundary (CI is the canonical
  producer) — versus **review-observation** — the configured workflow observed the artifact
  being presented, which proves neither comprehension nor even authorship of the evidence,
  because the store lives on the agent's own machine, writable by the same OS user (verified in
  the reference: plain JSON under the OS temp dir). sisu never presents the second class as the
  first, and builds no attestation/signing subsystem — in-boundary evidence is UX; CI, whose
  verdict the agent cannot write, is the artifact-verification plane.
- **Ownership follows the mechanism→checker relationship.** The files that VERIFY a protected
  mechanism are gated too, wherever the stack's test convention places them (`tests/`,
  `__tests__/`, `_test.go` beside the source) — gating a directory does not gate the thing that
  verifies it. Reference incident: `.claude/` was owner-gated from the start while its only
  checker was not, so an agent could have weakened the oracle and self-merged.
- **Local git hooks: no copy-based installers.** Point `core.hooksPath` at the tracked hooks
  directory so there is no copy and no drift (the reference's copy installer is precisely why
  its installed hooks never re-sync and why it grew a version-stamp workaround). The unavoidable
  residue — one per-clone `git config` — is reported honestly by `doctor` as
  "installed on THIS machine: yes / no / unknown", never hidden.

**2. Quality ratchets.** Measure current debt → freeze it as a baseline → the baseline may only
tighten, never loosen. Wired as blocking CI steps inside already-required jobs. Stack-agnostic
mechanism over stack-specific measurements. On a greenfield repo debt CEILINGS start at zero,
which makes them strictly stronger; coverage FLOORS must instead initialize from a real
measurement or an explicit non-vacuous minimum — a floor of zero asserts nothing. Rules:

- **Measurement identity.** Each metric records a DECLARED identity: the command, the config
  files it reads, the path scope, and — where present — a lockfile hash, with the honest
  disclosure that transitive influences (plugin versions, `extends` chains) are OUTSIDE the
  declared identity (a hash sold as complete when it is partial is worse than none). Changing
  the identity and the baseline in one commit is legal and loud; an identity change arriving
  with a silently lower number fails. This is what stops "improving" a baseline by narrowing
  scope or swapping the parser — the guard the reference delegates entirely to CODEOWNERS,
  which the shared-credential topology cannot provide. No surveyed ratchet tool binds
  measurement identity; this is one of sisu's two differentiators — build it like one.
- **Debt ceilings vs absolute invariants** are different metric classes. A secret scan is
  always-zero — never baselined, never waivable — and its allowlist file is itself part of the
  owned/gated set (the allowlist IS the soft-baseline surface).
- **Waivers are the only legal loosening**, and only for debt ceilings: human-approved, with
  MANDATORY expiry, no auto-renew; an expired waiver is a hard fail, never a silent revert to
  the loosened number; the waiver file lives in the owned/gated set; `doctor` lists every active
  waiver with days remaining; under a same-principal topology the approver field is labeled
  `self-attested` and says so. Make the MECHANICS frictionless — scaffold the waiver file with
  metric identity and expiry prefilled — but keep the deliberation expensive: approval is the
  point, and a 30-second approval on a same-principal setup converts the ratchet into a
  suggestion. (What actually catches an agent routing AROUND the ratchet is the
  measurement-identity guard, which fires whether or not a waiver exists.)
- **Non-vacuity discipline**: an oracle born from a discovered failure ships a regression case
  built from the ACTUAL historical failing input, demonstrated red before the fix went in —
  "a test exists" is never evidence the checker catches what it was written for. When the
  historical input cannot be made to pass cleanly, record a documented known over-block rather
  than quietly loosening the oracle.

**3. Role library.** ~15 generic agent roles: scout, gatekeeper, architect, implementer, validator,
reviewer, diagnostician, archaeologist, librarian, docs-scribe, handoff-scribe, operator,
researcher, release-auditor, orchestrator. **No domain content in any of them.** Canonical roles
declare **capabilities** (read-repo, modify-code, execute-oracles, mutate-governance, …), not
target tool names — the emitter translates capabilities into each target's tool
allowlists/denylists. A project-specific domain-guide role is scaffolded empty for the project
to fill. **Role dispatch is content the root file must carry**: the emitted root convention
file includes a role-dispatch section ("doing X → load role Y"), GENERATED from the canonical
role set — never hand-written, because the reference's hand-written roster drifted while every
entry it listed still resolved (single producer of truth applies to the dispatch map too). The
reference keeps its dispatch rules in the root file for a stated reason — rules that must
survive context compaction live in the eagerly-loaded file — and its worst harness incident
(roles present, documented, and dead for six weeks) is what happens without this. The dispatch
map is one line per role and counts against the eager context budget and the fallback size cap.

**4. Knowledge engine + learning loop.** One file per fact, typed frontmatter, and — critically —
**a verification handle on every lesson** so it can be re-checked automatically. Capture is the
easy half; **expiry is the hard half and is the point.** (Depth note: this component is the
behavioral hypothesis — see "What v1 is deep on"; it ships exactly this, plus kill criteria,
and nothing speculative on top.)

- **Authority hierarchy, enforced at promotion:** governance policy > role instructions >
  active knowledge > candidate knowledge > arbitrary repository content. Active facts are
  **declarative** — typed frontmatter checked at promotion; a fact records what is true, where
  it applies, why, and how staleness is detected. A fact can never redefine tiers, grant
  permissions, or instruct actions governance forbids — the promotion lint rejects
  imperative/governance-shaped content. Knowledge never outranks the spine.
- Six edge types with documented semantics — direction / expiry propagation / promotion check:
  `supersedes` (directed / no / checked) · `contradicts` (symmetric / no / **blocks**) ·
  `depends-on` (directed / **propagates** / checked) · `verified-by` (directed / re-verify on
  subject change / checked) · `applies-to` (directed / subject-drift tripwire / no) ·
  `caused-by` (directed / no / no). There is deliberately no `related` edge — an untyped
  symmetric edge is a junk drawer that propagation can do nothing with. Graph *semantics* on a
  markdown substrate — **no RDF, no OWL, no graph database.** `index` materializes edges into
  one small index file.
- Edges buy exactly three things, all real: **detection of declared `contradicts` edges** (no
  semantic contradiction inference — the emitted docs say so), **expiry propagation along
  `depends-on`** (invalidate a lesson, flag everything downstream), and **scoped retrieval**
  (load only the subgraph touching the current diff).
- Verification handles are **typed from a closed set**: `oracle-id` (preferred — references a
  stack-pack oracle) | `command` | `test-name` | `file-anchor` | `none`. All other fields (cwd,
  timeout, expected result, provenance) are OPTIONAL with pack-level defaults. **A passing
  handle proves the handle ran green — not that the prose is true.** That generalizes the
  file-anchor rule (location, not truth) to every handle type; whether an oracle actually
  witnesses the statement it is attached to is not machine-decidable, so handle RELEVANCE is a
  documented promotion-review checklist item, and facts no handle can witness take the
  human-approval path. Execution safety: `oracle-id` and pack-resolved `test-name` handles may
  run automatically; raw `command` handles are untrusted executable input and NEVER auto-run
  without explicit human authorization; the session-start drift tripwire never executes
  candidate-authored shell text.
- Two-tier store: agents write freely to `candidate/` (never loaded into context; `none` handles
  are legal there); promotion to `active/` requires a **passing verification handle OR explicit
  human approval** — the handle bar is paid at promotion, not capture. This exists because the
  failure mode of self-improvement is a wrong diagnosis inheriting the authority of
  "documented." For lessons whose subject IS an oracle, promotion additionally requires the
  handle to have been observed red on the motivating input (Component 2's non-vacuity rule,
  applied to knowledge), linked by a `caused-by` edge to the incident.
- **Hard constraint: capturing a lesson must cost an agent under ~30 seconds of effort.** Past
  that, agents quietly stop doing it and the loop is dead while still looking alive. A budget
  without an affordance is a wish: **emit the capture helper** — a repo-local script that
  scaffolds a candidate fact (frontmatter prefilled, handle slot ready) so the 30 seconds are
  real. (This is not new machinery — directive 1 already requires every recurring maintenance
  operation to exist as an emitted script; the helper is the missing instance.)
- A session-start drift tripwire reports knowledge whose subject has changed since last verification.

**5. Agent-process ledger.** Local, git-committed, zero-telemetry **run journal and workflow
provenance** — one file per run/task (no contention between concurrent agents): run id, commits
before/after, gates run with subject hash and verdict **plus the CI run URL/id for each verdict
where one exists** — the pointer to the one record the agent cannot write, which turns a
transcription into a spot-checkable transcription. The pointer itself is agent-written, so it
carries evidence-level `self-attested` until `doctor --remote` resolves it, `unknown` when
hostless — and it is never rendered as if it were the CI verdict. Knowledge captured and
promoted; agent identity and human approval each as `{ value, evidence-level }`; cost OPTIONAL.
Entries are designed for aggregate consumption — stable field order, greppable one-line
summaries — because nobody reads four hundred run files; they grep them. A record committed by
the same agent whose behavior it records is NOT a tamper-independent audit artifact, and its
docs say so plainly. The ledger must not lie about the loop it exists to evidence.

**6. `doctor`.** A three-column truth table — *mechanism | intended enforcement | actual
enforcement in this setup* — where actual enforcement is the enforcement-model tuple (effect,
plane, bypassable-by, evidence), covering both harness capability and repo reality. Every
catalog mechanism appears, installed, omitted, or deprecated; local-hook rows carry
installed-on-THIS-machine state; skip-pattern rows state "skipped counts as satisfied"
explicitly; every remote-derived row is stamped `observed-at`. Doctor also carries the
**knowledge-loop health rows**: candidate count and age distribution, promotion rate, overdue
re-verifications, active waivers with days remaining, detected-findings staleness — with the
pre-committed "loop is dead" threshold rendered against them (see kill criteria). `--remote`
performs the read-only git-host queries files cannot answer (branch protection exists? at which
source level — repository rulesets are `bypassable-by: repo-admin`, organization rulesets are
not; is each required check bound to its expected App; is CODEOWNERS enforced, loadable, and
error-free per the host's CODEOWNERS-errors API; is the agent identity separate from the
human's); offline, those rows report `unknown` — never green. `--strict` evaluates the named
predicates declared in the manifest and exits non-zero on any unmet floor, per target — one
strong target must not mask a weaker one. `--compare` emits to a temp dir, takes a
**structural** diff against an existing repo's harness, and joins it against the **extraction
map** (below) BY MECHANISM ID: a reference artifact mapped `mechanism` with no canonical
counterpart IS a gap finding; artifacts mapped `project` or `excluded` are not; anything
unmapped reports `unclassified` and is never silently dropped — human review is bounded to the
unclassified bucket. **Every competitor claims guardrails; `sisu` reports which ones are
actually walls — and against which actor.** (Seed the probe catalog from the survey's verified
inventories — posture scanners' branch-protection/token-permission/dangerous-workflow checks,
secret-scan push-protection and allowlist-breadth probes — as a checklist to draw on, not a
dependency.)

**7. `init`.** Asks exactly **five** questions — a hard cap, not a budget: product name; one
paragraph on what it does and who uses it; team shape; harness target(s); release model.
Everything else is **detected** — stack, package manager, test runner, linter, CI, git host,
branch-protection state, existing agent config, credential topology — and detection WRITES its
normalized findings into the intent file's `detected:` block (the resolver never re-detects).
Detection over interrogation is the difference between a 90-second `init` and one people
abandon. Rules that keep the cap honest instead of a claim of omniscience: (a) any fact
detection cannot resolve is recorded as an explicit `unknown` finding, surfaced by `doctor` —
never silently guessed; (b) a local git name/email is NOT a valid CODEOWNERS principal — the
approver is emitted as an explicit TODO reported at `advisory` (the local identity may be shown
as a suggestion) until a host-verified username is confirmed, e.g. via `doctor --remote`; (c)
exactly ONE uncounted safety confirmation before `init` executes any detected oracle command —
showing the exact command, its working directory, and the sentence "this command is
repository-controlled code" (a `test` script can be anything). `init` also verifies the emitted
maintenance runtime is present (Component 8) and fails loudly if not.

**No API key, no LLM call, ever.** Instead `init` writes `SETUP.prompt.md` — "run this in your
agent" — and the user's own agent does the analysis, reads the real codebase, and generates the
seed knowledge files **into `candidate/`, never directly into `active/`** — the first agent run
must not bypass the promotion gate that exists to contain exactly that agent's mistakes. This
eliminates all credential handling and makes the first-run experience a demonstration of the
product itself.

**8. Stack packs.** A pack declares its oracle commands — as **argv arrays, not shell strings,
wherever possible** (quoting, injection, and cross-platform pain all live in shell strings) —
each with its green condition, parser, metric direction, and checker paths; the ratchet system
is stack-agnostic on top. Ship TS/Node, Python, and a declare-your-own pack. `init` must
**verify the declared oracles actually run** — an unverified oracle is worse than none. v1 emits
its maintenance scripts in exactly **one runtime**, declared in the manifest and reported by
`doctor`; when a project's stack does not already carry that runtime, `init` fails loudly with
the stated reason — a governance toolchain must never be acquired silently. Document the
distinction so it cannot be misread: the APPLICATION stack (a pack: Python) and the sisu
MAINTENANCE runtime (e.g. Node) are different things — "Python support" never means "no
maintenance runtime needed". Python-native script emission is a declared `unsupported`
combination in v1, reported as such (directive 3: loud degradation, not silent reduction).

**9. `upgrade`.** `harness/` regenerated wholesale; `project/` untouched; `overrides/` applied
by the resolver. The contract: whole-file override semantics only, at canonical-source
granularity (never patch or merge — directive 6); defined collision rules; **every override
records the canonical hash it was based on (`based-on-canonical-hash`), and `upgrade` flags a
STALE OVERRIDE both when the harness file disappears AND when the canonical base changed
underneath a still-existing override** — otherwise a security fix in canonical is silently
reverted on every upgrade by a file that looks intentional (small canonical sources keep these
warnings rare and precise instead of a wall the user learns to ignore); and when `project/` is
on an older schema than the generator, `upgrade` STOPS with a stated migration path rather than
silently reading old-shaped frontmatter. **No transactional replacement layer and no rollback
journal** — emitted output is build output, every input is committed, and `git checkout` of the
owned paths already is the rollback. For that to be well-defined, the artifact graph declares
the **complete sisu-owned write set** — `harness/`, generated root convention files, CI
workflow files, hook sources, and the manifest — and ownership, checksums, and the dirty-tree
refusal apply to that whole set, not only `harness/`. Checksums cover **content and mode bits**
(a hook that loses its executable bit is functionally changed); **symlinks are refused anywhere
in the owned write set** (build output never needs one), and override/target paths that
traverse outside the repo are rejected. `upgrade` refuses to run while any owned path is dirty;
the checksum warning names every modified file and points at `overrides/`; and the **manifest
is written LAST**, so an interrupted run leaves a detectable manifest/checksum mismatch instead
of a silently half-upgraded tree.

**10. Progressive disclosure (architecture, not a gate).** Only two things load eagerly: the
root convention file (including the generated role-dispatch section) and a one-line-per-item
index. Everything else loads on demand behind a description. Declare an explicit **context
budget** for the eagerly-loaded set, and make `index` FAIL LOUDLY when the budget is exceeded —
that converts an unbounded scaling risk into a dated, evidenced trigger. Do NOT build
sharded/hierarchical indexes in v1: a single-user repo will not hit the budget for a long time,
and sharding introduces a retrieval-routing decision this spec deliberately rules out until the
loud failure proves it necessary.

**11. Emitted self-verification suite.** Per target, `emit` also generates a small test suite
wired into the project's own already-required oracle command (via its stack pack), asserting:
every emitted role/config file loads — using the consuming tool's REAL parser where it is
callable; where it is not, the emitted check is a conformance validator built from the tool's
DOCUMENTED frontmatter reference and labeled `detective`, with a cold-session load probe
retained as the authoritative check (the reference's own registry test is exactly such a
validator, not the real loader; note the consuming tools publish official machine-readable
schemas only for some artifacts — e.g. Claude Code's settings.json has one, its
subagent/SKILL frontmatter do not); every role→role and role→knowledge reference resolves to a
file on disk; **the role-dispatch map is checked BIDIRECTIONALLY — every dispatch target
resolves AND every non-omitted role appears in the map** (the reference failed the completeness
half: its roster's entries all resolved while the roster itself was missing entries); every
capability-restricting field on a restricted role is present (omission silently upgrades
privilege, never downgrades it). The manifest records each target's **contract version** — the
tool version the emitted layout and suite were tested against, plus the committed target
constants (discovery chains, size caps, hook-timeout defaults) — because "generated correctly"
is meaningless without "according to which version of the consumer". **Cold-session loader
tests run under a clean temporary HOME/config location AND assert the workspace carries no
local settings overlay** (for Claude Code: a temp `CLAUDE_CONFIG_DIR` relocates user-level
settings/history/plugins, but a `.claude/settings.local.json` in the workspace still applies —
isolation is only real if the test checks both). A developer's global config silently supplying
the file the repo is missing would falsify the one empirical test the whole spec rests on.
This suite is categorically different from `doctor`: doctor is point-in-time and human-invoked,
while this runs on every commit in the handed-off repo with no sisu binary present
(directive 1). Reference incident that mandates it: two agent-role files sat silently
unloadable for six weeks — present, documented, and dead, with zero error anywhere — because
permissive-parser config fails in a way indistinguishable from health.

## The extraction map (a committed deliverable)

A committed artifact classifying every reference-corpus artifact, with per-entry fields:
`source-path`, `source-blob-sha` (at <REF_SHA>), `classification` (`mechanism` | `project` |
`hybrid` | `excluded`), `mechanism-ids` (stable ids like `governance.oracle-integrity`,
`ratchet.measurement-identity` — what `doctor --compare` joins on), `source-sections` (required
for `hybrid`: name the mechanism parts at section/rule granularity — a file-level `hybrid` is
unactionable), and one line of `reason`. An automated completeness test asserts every path in
the reference read scope maps to exactly one classification — no silently disappearing files.
Classification is human-authored (yours, reviewed at the checkpoint); the join is mechanical.

## The product contract

Decided at the checkpoint (below), recorded in the manifest, reported by `doctor`: the
supported OS set; ONE git host; ONE CI provider; ONE emitted maintenance runtime; and each
target's contract version with its committed target constants. Every other combination is
state `unsupported` and degrades loudly (directive 3) — never silently. Warning that makes this
section necessary: the reference harness is Windows/PowerShell-flavoured at exactly the layer
sisu must emit (its pre-push hook is a `powershell.exe` shim), so an unstated platform contract
means the extraction silently inherits Windows path assumptions as if they were mechanism.

## Explicitly NOT in scope

Do not build, and do not helpfully add: application scaffolding of any kind (no `create-*`
behavior — detect the stack, wire its oracles, write no app code) · brownfield `adopt` (design
for it, don't build it) · multi-agent workflow scripts · an AI-review CI gate · e2e test tiering
· app-level observability (Sentry/OTel) beyond an optional dormant pack stub · a plugin API or
emitter SDK · any OSS artifact — no public README, LICENSE, CONTRIBUTING, badges, changelog for
strangers, or marketing copy · telemetry or any network call (beyond the two directive-4
exceptions) · a model router · embeddings or vector search · an attestation/signing subsystem ·
a retrieval system (sharded indexes, rankers) · a policy-predicate DSL · **fleet drift
management** — many emitted repos drifting apart over time is an owned consequence of
directive 1; `doctor --compare` run per repo is the manual answer, and nothing more ships.

## Definition of done

1. **Adversarial sweep is clean.** Run agents against the extracted canonical layer with an
   explicit hunt list: domain vocabulary that leaked in; stack assumptions hardcoded where a
   declared command belongs; single-developer assumptions; OS/path assumptions (the reference is
   Windows-flavoured — hunt hardest here); Claude-specific idioms below the emitter boundary;
   gates that cannot be expressed for a non-JS ecosystem. Then run the named **attack families**
   against an emitted repo: hook bypass (`--no-verify`, `-c core.hooksPath=…`, editing the
   tracked hook — expected result: acknowledged as `bypassable-by: workspace-write`, remote wall
   holds); gate tampering (required job renamed / deleted / `if: false` / `continue-on-error` /
   checker replaced with `echo` — self-verification or ownership catches each); status spoofing
   (same-name commit status from a write credential — App binding rejects, or doctor reports the
   binding absent); ownership evasion (weaken the checker instead of the mechanism; rename a
   protected path — the stricter of old/new classification applies); CODEOWNERS silent-failure
   shapes (oversized file, invalid line, non-write owner — probes report each); path attacks
   (traversal in override paths, symlinks in the owned set, case-collision on case-insensitive
   filesystems — all rejected); parser attacks (malformed-but-ignored YAML, duplicate role ids —
   emitted suite fails); knowledge attacks (candidate lesson carrying prompt injection never
   enters context; an active-fact attempt to override governance is rejected by the promotion
   lint); evidence attacks (forged, stale, or cross-repo session evidence — rejected, or
   honestly classed as review-observation); measurement attacks (parser returns zero/empty →
   loud failure; scope silently narrowed → identity change → block); supply chain (mutable
   action tags → SHA pins; `pull_request_target` never checks out untrusted code).

2. **The real test — a second project.** `init` a small project in a genuinely different domain
   and stack (e.g. a Python/FastAPI caseworker slice). Have a **cold agent, given only that
   repo, complete one real task**: add an endpoint with a permission gate and a test. It passes
   if the agent can answer *"what am I allowed to change, and how will I know I didn't break
   it?"* from the repo alone, without being told. The cold session runs under a clean temporary
   HOME/config dir AND a workspace with no local settings overlay (Component 11) — global agent
   config on the test machine must not be able to supply what the repo lacks. The dogfood repo
   (How to work) never counts toward this criterion — sisu's own stack is exactly the one most
   at risk of being mistaken for mechanism.

3. **`doctor --compare` against the reference repo, read-only**, joined through the extraction
   map by mechanism id, with an honest report of anything canonical cannot express and a bounded
   `unclassified` bucket. Do **not** migrate that repo — it is live.

4. **The emitted oracles are proven non-vacuous.** In the second project, deliberately break one
   emitted role file and one emitted cross-reference — the self-verification suite must go red;
   seed one known bypass shape against an emitted verification-gate hook — its executed test
   suite must catch it. An oracle never seen red is not yet evidence (this is Component 2's own
   discipline, applied to sisu's output).

5. **The acceptance matrix is green — pairwise, with two named exceptions.** Cheap universal
   properties run across the FULL matrix (both targets × every profile × all three packs):
   emits cleanly, self-verification suite passes, byte-identical re-emit (same commit, second
   machine, across the DECLARED OS set — with line-ending and mode-bit normalization exercised).
   Deep behavioral suites run on one representative cell per axis: ratchet behavior (tightening
   passes, loosening fails, measurement-parser failure is loud, identity change without a
   stated baseline change fails, waiver expiry is a hard fail, non-vacuity per Component 2);
   the knowledge lifecycle end-to-end (candidate capture via the emitted helper, promotion,
   declared-contradiction block, `depends-on` expiry propagation, authority-hierarchy lint
   rejection, index rebuild + budget-overflow failure, ledger capture with CI-pointer
   labeling); post-override capability state and checksums, including a stale-base override
   flagged; `upgrade` refusal on a dirty owned tree and on an older `project/` schema, plus
   interrupted-upgrade detection via the manifest-last rule. The two full-coverage exceptions,
   because they make per-axis claims: `doctor --strict` runs on EVERY target (one strong target
   must not mask a weaker one), and omission-with-reason rendering runs on EVERY profile.

## How to work

- Build in a **new standalone private repo**. Do not modify the reference repo at all.
- **One batched checkpoint before implementation.** Propose — with a RECOMMENDED DEFAULT for
  every item, so approval can be "as proposed" — the installed directory tree; the canonical
  file-granularity rule (with the override-resolution argument written down); ownership and
  mutation rules; the emitter-purity rule and its committed target constants; the
  product-contract values (OS set, git host, CI provider, emitted runtime, target contract
  versions); SCM/CI and offline behavior; the enforcement-model catalog with each mechanism's
  intended tuple, lifecycle state, and the named `--strict` predicates; the doctor JSON output
  schema and the CI boundary; the `detected:` provenance design; the three version axes and
  compatibility policy; override and upgrade semantics; the knowledge-loop kill criteria and
  health thresholds; the pairwise acceptance-matrix plan; and the schemas/state machines for
  policies, ratchets, facts, edges, and verification handles. One checkpoint, once — not a
  phase gate per component. Presenting these as open questions without recommendations is
  offloading the design; do not.
- **One externally usable v1** — every component in "Components to build" ships in it; no staged
  external releases and no v2 deferrals (a pre-committed kill criterion is an exit, not a
  deferral). Build through **internal vertical slices**, ordered so the highest-information
  work runs earliest:
  - The FIRST slice is end-to-end thin (`init` → `emit` → `doctor` against one trivial
    project) and includes: **byte-reproducibility** (emit twice, second machine, across the
    declared OS set, diff — determinism bugs are geometrically cheaper at three files than
    three hundred), a **skeletal `upgrade`** (owned-set computation + checksums + stale-base
    flag, nothing more — override semantics dictate canonical granularity, so this constraint
    must exist before the canonical tree grows), and a **cold-agent SMOKE** (spine plus one
    ratchet: can an agent answer the two questions at all?). The full-rigor cold-agent test
    (DoD #2, different domain and stack) remains the final gate — the smoke validates the bet,
    the gate validates the product.
  - **Dogfood from the thin slice onward**: sisu's own repo runs a sisu-emitted harness —
    pinned to a RELEASED generator version and upgraded deliberately, never emitted from HEAD
    (a bug in HEAD must not disarm the gates that would catch it: the guinea pig cannot eat the
    fence). Dogfood is additive evidence only and never counts toward DoD #2.
  - Then: canonical schema + pure resolver + manifest → CI/CODEOWNERS wiring + `doctor
    --remote` + gate-mutation attacks → ratchets → knowledge lifecycle → full upgrade/overrides
    → the fallback target + degradation reporting → ledger + `--compare` + the cold-agent gate.
- Every abstraction you lift from the reference harness: record it in the extraction map —
  what was mechanism, what was domain, and where you drew the line. That line is the whole
  product, and getting it wrong is invisible from the inside.
- Where a decision outside the checkpoint's scope would still change the *shape* of the system,
  stop and ask rather than assume.
- Report status honestly. If something is stubbed, say stubbed. Never call skipped or excluded
  work green — that is the exact discipline this tool exists to enforce.
