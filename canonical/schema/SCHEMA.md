# sisu canonical schema (v1)

This document is the written contract for every file sisu reads or emits. Its primary
readers are AI agents, so it is explicit. `sisu lint-canonical` validates the canonical tree
against it (labelled `detective`: a conformance validator, not a consumer's parser).

## sisu-yaml (the YAML subset)

Every YAML sisu reads or writes — frontmatter, `sisu.yaml`, waivers — uses a strict subset
implemented once in `assets/lib/yaml.mjs` and vendored unchanged into `harness/lib/`:

- comments: `# …` at line start or after whitespace, outside quotes
- block mappings `key: value`, nested by indentation (spaces only)
- block sequences `- item`; `- key: value` begins a mapping item whose continuation lines
  are indented exactly two more spaces than the dash
- scalars: plain strings, `"double-quoted"` (JSON escapes), `'single-quoted'` (`''` escape),
  integers, decimals, `true`/`false`, `null`/`~`/empty
- flow sequences of scalars `[a, b, "c"]`; the empty forms `[]` and `{}`
- block scalars `|`, `|-`, `>`, `>-`
- NOT supported (hard error): anchors, aliases, tags, multi-document streams, complex keys,
  flow mappings with content, nested flow collections, multi-line plain scalars, tabs for
  indentation, duplicate keys, and **a plain scalar containing `: `** — quote it.
- dates are strings; no implicit coercion beyond numbers/booleans/null.

## Canonical tree

```
canonical/
  mechanisms/<id>.md     one enforcement mechanism per file (catalog entry + prose)
  rules/<id>.md          one agent-facing governance rule per file
  roles/<name>.md        one generic agent role per file
  schema/SCHEMA.md       this document
```

All files: LF, UTF-8 without BOM, frontmatter first.

### mechanism frontmatter

| key | type | required | notes |
|---|---|---|---|
| `kind` | `mechanism` | yes | |
| `id` | string `^[a-z][a-z0-9-]*(\.[a-z0-9-]+)+$` | yes | stable; never reused |
| `title` | string | yes | |
| `lifecycle` | `experimental` \| `stable` \| `deprecated` | yes | deprecated still renders in doctor |
| `effect` | `blocking` \| `preventive` \| `detective` \| `advisory` \| `none` | yes | preventive = stops the convenient path only |
| `plane` | `agent-runtime` \| `local-git` \| `ci` \| `repository` \| `organization` | yes | |
| `bypassable-by` | `workspace-write` \| `repo-write` \| `repo-admin` \| `org-admin` \| `none` | yes | weakest actor class that nullifies it |
| `fail-mode` | `open` \| `closed` \| `n/a` | yes | hooks must state it |
| `evidence-probe` | probe id or `none` | yes | the doctor probe that can observe it; `none` ⇒ declared only |
| `covers` | string[] | no | claimed change-set (coverage-scope invariant) |
| `requires` | mapping | no | `targets: []`, `host: []`, `ci: []`, `topology: separate-principal`, `packs: []` — all any-of; unmet ⇒ omitted with reason |
| `strict` | string[] | no | predicate names from the fixed set |
| `renders` | string[] | no | root-file sections this mechanism's body is composed into |
| `extracted-from` | string[] | no | reference paths (extraction map join) |

Body: 1–6 sentences for the root convention file's enforcement table / section. No
domain vocabulary. No stack assumptions beyond what the stack pack supplies.

### rule frontmatter

| key | type | required |
|---|---|---|
| `kind` | `rule` | yes |
| `id` | string (same grammar as mechanisms) | yes |
| `title` | string | yes |
| `section` | one of the root sections: `answer`, `tiers`, `oracle-integrity`, `change-control`, `session`, `dispatch`, `knowledge`, `ledger`, `evidence`, `enforcement` | yes |
| `order` | integer | yes |
| `targets` | string[] (default both) | no |
| `enforced-by` | mechanism ids | no |

Body: the rule text. Rules may use `{{product.name}}`, `{{policy.tier1-paths}}` and the
other placeholders listed in `src/compose.mjs`; nothing else is templated.

### role frontmatter

| key | type | required | notes |
|---|---|---|---|
| `kind` | `role` | yes | |
| `name` | `^[a-z][a-z0-9-]*$` | yes | emitted file name and agent name |
| `title` | string | yes | |
| `description` | string | yes | quoted; ≥ 20 chars; rendered as the target's description |
| `capabilities` | subset of `read-repo`, `modify-code`, `execute-oracles`, `mutate-governance`, `write-knowledge`, `spawn-agents`, `network` | yes | emitter maps to each target's tool allow/deny lists |
| `model` | `inherit` \| `fast` \| `strong` | yes | abstract tier |
| `dispatch` | string | yes | "doing X" — one line in the generated dispatch map |
| `scaffold` | boolean | no | true ⇒ emitted into `project/roles/` for the project to fill |

## Intent file (`sisu.yaml`)

```yaml
schema: 1
product:
  name: <string>
  summary: <one paragraph>
profile: solo | lead-team | enterprise
targets: [claude-code, agents-md]
packs: [node]            # node | python | custom
release:
  model: trunk | integration-branch | release-branches
  default-branch: main
  integration-branch: dev        # optional
policy:
  tier1-paths: [...]             # stop-and-ask paths; also CODEOWNERS-gated
  approver: "@handle" | null     # host-verified username; null ⇒ TODO (advisory)
  floors:
    strict-predicates: [remote-wall, no-conflicts]
  knowledge:
    reverify-days: 90
    loop-dead:
      min-candidates: 20
      max-age-days: 30
      min-promotion-rate: 0.05
      window-days: 60
    eager-budget-bytes: 24576
topology:
  agent-principal: <string|unknown>
  approver-principal: <string|unknown>
  agent-repo-role: write|maintain|admin|unknown
  same-principal: true|false|unknown
detected:                         # machine-written; see provenance rules
  <finding-id>:
    value: <any>
    evidence: detected | unknown
    at: <HEAD sha | no-commit>
    inputs-digest: sha256:<hex>   # partial
    inputs: [paths]
    override-reason: <string>     # only when a human edited the value
```

## Manifest (`sisu.lock.json`)

Stable key order (sorted). Fields: `schema` (`sisu.lock/1`), `generator`, `projectSchema`,
`targets` → `{ contract, constants-hash, capabilities, autoLoad }`, `packs` → content
hashes, `contract` (product contract), `owned` → `{ path: checksum }` where checksum is
`sha256:<hex of LF-normalized content>;mode:<0644|0755>`, `strictPredicates`,
`overrides` → `{ canonicalPath: { basedOn, state } }`, `catalogSchema`, `intentHash`,
`composition` → `{ emittedPath: [canonical ids] }`, `runtime` (`node`), `writtenAt`
(generator run id; **not** a timestamp — timestamps break byte reproducibility).

## Knowledge files

Fact file `project/knowledge/{candidate,active}/<slug>.md`:

```yaml
kind: fact
id: <slug>
title: <short claim>
status: candidate | active | stale | superseded
applies-to: [paths or globs]            # subject
why: <one paragraph>
verification:
  kind: oracle-id | command | test-name | file-anchor | none
  oracle-id: <pack oracle id>           # when kind=oracle-id
  command: [argv]                       # when kind=command — NEVER auto-run
  test-name: <string>
  file-anchor: { path, contains }
  expected: pass | fail
  cwd: <path>
  timeout-ms: <int>
edges:
  - type: supersedes | contradicts | depends-on | verified-by | applies-to | caused-by
    target: <fact id | path | incident id>
created: <ISO date>
verified-at: <ISO date> | null
subject-hash: sha256:<hex> | null       # hash of applies-to files at last verification
promoted-by: { value, evidence-level }  # evidence-level: ci | human | self-attested
```

Edge semantics (direction / expiry propagation / promotion check):
`supersedes` directed / no / checked · `contradicts` symmetric / no / **blocks** ·
`depends-on` directed / **propagates** / checked · `verified-by` directed / re-verify on
subject change / checked · `applies-to` directed / subject-drift tripwire / no ·
`caused-by` directed / no / no. There is no `related` edge.

Promotion lint rejects imperative or governance-shaped content in active facts: lines
beginning with `always`, `never`, `you must`, `agents must`, `tier 0`, `tier 1`,
`permission`, `allowed to`, or that mention changing tiers, gates, or baselines.

## Ratchets, waivers, ledger

See `assets/scripts/ratchet.mjs`, `waiver.mjs`, `ledger.mjs` headers — each script documents
the exact file shape it reads and writes, and the emitted `harness/README.md` links them.
