// The policy resolver — PURE, and the one producer of resolved truth.
// Inputs are committed data only (canonical tree, overrides, intent file with its
// `detected:` block, project role sources, emitted-script assets, generator
// version). No clock, no environment, no installed-tool probing. Same inputs ⇒
// same artifact graph ⇒ same bytes on any machine.
import { splitFrontmatter } from "../assets/lib/frontmatter.mjs";
import { textHash, contentChecksum } from "../assets/lib/hash.mjs";
import { parseCanonicalFiles, CATALOG_SCHEMA_VERSION, STRICT_PREDICATES, PROBES, parseRole } from "./canonical.mjs";
import { resolvePacks } from "./packs.mjs";
import { TARGETS, ACTION_PINS } from "./targets.mjs";
import { composeRoot, renderOraclesTable, renderDispatchMap, renderEnforcementTable, byteLength } from "./compose.mjs";
import { renderWorkflow, WORKFLOW_PATH, REQUIRED_CHECK_NAME } from "./emit/workflow.mjs";
import { renderCodeowners, CODEOWNERS_PATH, ownedGatedPaths, toCodeownersPattern } from "./emit/codeowners.mjs";
import { renderClaudeAgent, renderPortableRole, renderClaudeSettings } from "./emit/roles.mjs";
import { stableJson } from "./lib/fsx.mjs";
import { renderIndex } from "../assets/lib/knowledge.mjs";

export const MANIFEST_FILE = "sisu.lock.json";
export const MANIFEST_SCHEMA = "sisu.lock/1";

export const PREDICATE_DEFINITIONS = Object.freeze({
  "remote-wall": "effect = blocking AND plane IN (ci, repository, organization) AND bypassable-by >= repo-admin, for every installed mechanism tagged remote-wall",
  "evidence-fresh": "every remote-derived row has evidence.kind = observed and age <= 30 days",
  "self-verification-green": "harness.self-verification last observed green on HEAD",
  "topology-resolved": "none of the four topology facts is unknown",
  "no-conflicts": "no mechanism is in state conflict",
});

/**
 * @typedef {{ path: string, content: string, mode: "0644" | "0755", composedFrom: string[], target: string, kind: "owned" | "scaffold" }} Artifact
 * @typedef {{ id: string, title: string, lifecycle: string, intended: { effect: string, plane: string, bypassableBy: string, failMode: string },
 *   state: "installed" | "omitted" | "deprecated", reason: string | null, targets: string[], evidenceProbe: string, strict: string[], covers: string[], body: string }} CatalogRow
 * @typedef {{
 *   canonicalFiles: Record<string, string>,
 *   overrides: Record<string, string>,
 *   intent: import("./intent.mjs").Intent,
 *   projectRoles: Record<string, string>,
 *   assets: Record<string, { text: string, mode: "0644" | "0755" }>,
 *   generatorVersion: string,
 * }} ResolveInputs
 */

/**
 * Apply overrides (whole-file, exactly once, here). Returns the file map and
 * the override register for the manifest.
 * @param {Record<string, string>} canonicalFiles @param {Record<string, string>} overrides
 */
export function applyOverrides(canonicalFiles, overrides) {
  const files = { ...canonicalFiles };
  /** @type {Record<string, { basedOn: string | null, canonicalHash: string | null, state: string }>} */
  const register = {};
  for (const [rel, text] of Object.entries(overrides).sort(([a], [b]) => (a < b ? -1 : 1))) {
    const canonicalPath = `canonical/${rel}`;
    let basedOn = null;
    try {
      const fm = splitFrontmatter(text).data;
      basedOn = typeof fm?.["based-on-canonical-hash"] === "string" ? fm["based-on-canonical-hash"] : null;
    } catch {
      basedOn = null;
    }
    const current = canonicalFiles[canonicalPath];
    if (current === undefined) {
      register[canonicalPath] = { basedOn, canonicalHash: null, state: "stale-orphan" };
      continue; // not applied: nothing to replace
    }
    const canonicalHash = "sha256:" + textHash(current);
    let state = "current";
    if (!basedOn) state = "missing-based-on";
    else if (basedOn !== canonicalHash) state = "stale-base";
    register[canonicalPath] = { basedOn, canonicalHash, state };
    files[canonicalPath] = text;
  }
  return { files, register };
}

/**
 * Decide install state for a mechanism given the intent.
 * @param {import("./canonical.mjs").Mechanism} m @param {import("./intent.mjs").Intent} intent
 * @returns {{ state: "installed" | "omitted" | "deprecated", reason: string | null, targets: string[] }}
 */
export function installState(m, intent) {
  const host = /** @type {string} */ (intent.detected["git-host"]?.value ?? "unknown");
  const ci = /** @type {string} */ (intent.detected.ci?.value ?? "unknown");
  const req = m.requires;
  const targets = req.targets ? intent.targets.filter((t) => req.targets.includes(t)) : intent.targets.slice();
  if (m.lifecycle === "deprecated") return { state: "deprecated", reason: "deprecated mechanism — still rendered", targets };
  if (req.targets && targets.length === 0) return { state: "omitted", reason: `requires target ${req.targets.join("|")}`, targets: [] };
  if (req.host && !req.host.includes(host)) return { state: "omitted", reason: `requires host ${req.host.join("|")} (detected: ${host})`, targets };
  if (req.ci) {
    const ok = req.ci.includes(ci) || (ci === "none" && host === "github" && req.ci.includes("github-actions"));
    if (!ok) return { state: "omitted", reason: `requires CI ${req.ci.join("|")} (detected: ${ci}; host: ${host}) — unsupported combination`, targets };
  }
  if (req.topology === "separate-principal" && intent.topology["same-principal"] === true) {
    return { state: "omitted", reason: "same-principal topology: cannot structurally enforce", targets };
  }
  if (req.packs && !req.packs.some((p) => intent.packs.includes(p))) return { state: "omitted", reason: `requires pack ${req.packs.join("|")}`, targets };
  return { state: "installed", reason: null, targets };
}

/**
 * Resolve everything. Pure.
 * @param {ResolveInputs} inputs
 */
export function resolve(inputs) {
  const { intent } = inputs;
  const { files, register: overrideRegister } = applyOverrides(inputs.canonicalFiles, inputs.overrides);
  const canonical = parseCanonicalFiles(files);
  const packs = resolvePacks(intent.packs, intent);
  const oracles = applicableOraclesFromIntent(packs, intent);
  const ratchets = oracles.filter((o) => o.kind === "ratchet");

  // ---- catalog
  /** @type {CatalogRow[]} */
  const catalog = canonical.mechanisms
    .map((m) => {
      const st = installState(m, intent);
      return {
        id: m.id,
        title: m.title,
        lifecycle: m.lifecycle,
        intended: { effect: m.effect, plane: m.plane, bypassableBy: m.bypassableBy, failMode: m.failMode },
        state: st.state,
        reason: st.reason,
        targets: st.targets,
        evidenceProbe: m.evidenceProbe,
        strict: m.strict,
        covers: m.covers,
        body: m.body,
      };
    })
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  const installed = (id) => catalog.find((r) => r.id === id)?.state === "installed";

  // ---- roles (canonical + project-owned sources replacing scaffolds)
  const roles = canonical.roles.map((r) => {
    if (r.scaffold && inputs.projectRoles[r.name] !== undefined) {
      const parsed = parseRole(`project/roles/${r.name}.md`, inputs.projectRoles[r.name]);
      return { ...parsed, scaffold: false, source: `project/roles/${r.name}.md` };
    }
    return r;
  });
  const emittedRoles = roles.filter((r) => !r.scaffold);

  // ---- gated paths (from the committed detection, never the live tree)
  const detectedGate = /** @type {string[]} */ (Array.isArray(intent.detected["gate-definition-paths"]?.value) ? intent.detected["gate-definition-paths"].value : []);
  const gateDefinitionPaths = [...new Set(detectedGate)].map(toCodeownersPattern).sort();
  const tier1Paths = intent.policy["tier1-paths"].map(toCodeownersPattern);
  const gatedPaths = [...new Set([...ownedGatedPaths(), ...gateDefinitionPaths, ...tier1Paths])];

  // ---- artifacts
  /** @type {Artifact[]} */
  const artifacts = [];
  /** @type {Record<string, string[]>} */
  const composition = {};
  const add = (path, content, opts = {}) => {
    const a = { path, content, mode: opts.mode ?? "0644", composedFrom: opts.composedFrom ?? [], target: opts.target ?? "common", kind: opts.kind ?? "owned" };
    artifacts.push(a);
    if (a.composedFrom.length) composition[path] = a.composedFrom;
    return a;
  };

  // vendored runtime + scripts + tests (verbatim assets)
  const hasClaude = intent.targets.includes("claude-code");
  for (const [rel, asset] of Object.entries(inputs.assets).sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (rel.startsWith("agent-hooks/") && !hasClaude) continue;
    if (rel === "tests/agent-hooks.test.mjs" && !hasClaude) continue;
    add(`harness/${rel}`, asset.text, { mode: asset.mode, composedFrom: [`assets/${rel}`] });
  }

  // git hook shims
  add("harness/git-hooks/pre-push", "#!/bin/sh\n# GENERATED by sisu. Installed via core.hooksPath (node harness/scripts/setup-hooks.mjs).\n# Fast feedback only — defeated by --no-verify; CI is the wall.\nexec node \"$(dirname \"$0\")/../scripts/pre-push.mjs\" \"$@\"\n", { mode: "0755" });

  // catalog.json
  const probes = [...new Set(catalog.map((r) => r.evidenceProbe))].filter((p) => p !== "none").sort();
  const strictPredicates = Object.fromEntries(
    STRICT_PREDICATES.map((p) => [p, { definition: PREDICATE_DEFINITIONS[p], mechanisms: catalog.filter((r) => r.strict.includes(p)).map((r) => r.id) }]),
  );
  add(
    "harness/catalog.json",
    stableJson({
      schema: `sisu.catalog/${CATALOG_SCHEMA_VERSION}`,
      generator: inputs.generatorVersion,
      mechanisms: catalog.map(({ body, ...r }) => r),
      probes,
      strictPredicates,
      requiredCheck: REQUIRED_CHECK_NAME,
      targets: Object.fromEntries(intent.targets.map((t) => [t, { contract: TARGETS[t].contract }])),
    }),
  );

  // CI workflow + CODEOWNERS (GitHub only)
  const host = intent.detected["git-host"]?.value;
  const branches = [intent.release["default-branch"], ...(intent.release["integration-branch"] ? [intent.release["integration-branch"]] : [])];
  if (installed("ci.required-gates")) {
    add(WORKFLOW_PATH, renderWorkflow({ branches, packs, oracles, hasRatchets: ratchets.length > 0, hasAgentHooks: hasClaude }));
  }
  if (host === "github" && installed("governance.codeowners")) {
    add(CODEOWNERS_PATH, renderCodeowners({ approver: intent.policy.approver, tier1Paths, gateDefinitionPaths, ownedPaths: ownedGatedPaths() }));
  }

  // roles + root files per target
  const values = {
    "product.name": intent.product.name,
    "product.summary": intent.product.summary,
    "policy.tier1-paths": tier1Paths.length ? tier1Paths.map((p) => `  - \`${p}\``).join("\n") : "  - _(none declared yet — add paths under `policy.tier1-paths` in `sisu.yaml`)_",
    "policy.gated-paths": gatedPaths.map((p) => `- \`${p}\``).join("\n"),
    "policy.approver": intent.policy.approver ?? "**TODO** — no host-verified approver yet; CODEOWNERS is valid-but-empty and enforces nothing until `policy.approver` is set (reported at advisory by doctor)",
    "oracles.table": renderOraclesTable(oracles),
    "knowledge.index": "project/knowledge/INDEX.md",
    "release.integration-branch": intent.release["integration-branch"] ?? intent.release["default-branch"],
    "enforcement.table": renderEnforcementTable(catalog),
  };
  const rulesForRoot = canonical.rules;
  /** @type {Record<string, any>} */
  const capabilities = {};
  for (const target of intent.targets) {
    const t = TARGETS[target];
    const rolesLocation = target === "claude-code" ? TARGETS["claude-code"].agentsDir : TARGETS["agents-md"].rolesDir;
    const dispatch = renderDispatchMap(emittedRoles, rolesLocation);
    let preamble = "";
    if (target === "agents-md") {
      const al = TARGETS["agents-md"].autoLoad;
      preamble = `_Portable fallback (AGENTS.md contract ${t.contract}). Automatic-load status per tool, as calibrated — never "works in any tool": ${Object.entries(al)
        .map(([k, v]) => `${k}: ${v}`)
        .join(" · ")}. For Claude Code the documented bridge is an \`@AGENTS.md\` import from CLAUDE.md._`;
    }
    const { content, composedFrom } = composeRoot({
      target,
      rules: rulesForRoot,
      mechanisms: catalog,
      values: { ...values, "roles.location": rolesLocation, "dispatch.map": dispatch },
      preamble,
    });
    // The target constant is the hard cap; the project's policy may only tighten it.
    const budget = Math.min(t.eagerBudgetBytes, Number(intent.policy.knowledge["eager-budget-bytes"]) || t.eagerBudgetBytes);
    const size = byteLength(content);
    if (target === "agents-md" && size > TARGETS["agents-md"].emittedCapBytes) {
      throw new Error(`AGENTS.md is ${size} bytes, over the emitted cap ${TARGETS["agents-md"].emittedCapBytes} (Codex combined cap ${TARGETS["agents-md"].combinedCapBytes} truncates silently). Loud degradation per directive 3 — trim rules via overrides/.`);
    }
    add(t.rootFile, content, { target, composedFrom: [...composedFrom, ...emittedRoles.map((r) => r.source)] });
    capabilities[target] = {
      contract: t.contract,
      rootFile: t.rootFile,
      rootBytes: size,
      eagerBudgetBytes: budget,
      roles: emittedRoles.map((r) => r.name),
      agentHooks: target === "claude-code" ? Object.keys(inputs.assets).filter((k) => k.startsWith("agent-hooks/")).map((k) => k.slice("agent-hooks/".length)) : [],
      autoLoad: target === "claude-code" ? "native" : TARGETS["agents-md"].autoLoad,
    };
    for (const role of emittedRoles) {
      if (target === "claude-code") {
        const r = renderClaudeAgent(role);
        add(r.path, r.content, { target, composedFrom: [role.source] });
      } else {
        const r = renderPortableRole(role);
        add(r.path, r.content, { target, composedFrom: [role.source] });
      }
    }
    if (target === "claude-code") {
      add(TARGETS["claude-code"].settingsFile, renderClaudeSettings({ hooks: capabilities[target].agentHooks }), { target });
    }
  }

  // harness README (points at overrides/, documents the shared-file and runtime rules)
  add("harness/README.md", renderHarnessReadme({ generatorVersion: inputs.generatorVersion, targets: intent.targets, packs: intent.packs }));

  // ---- scaffold (written by init only where absent; NOT owned)
  const scaffold = renderScaffold({ roles, ratchets, intent });

  // ---- owned set + checksums
  artifacts.sort((a, b) => (a.path < b.path ? -1 : 1));
  const owned = Object.fromEntries(artifacts.map((a) => [a.path, contentChecksum(a.content, a.mode)]));
  const intentHash = "sha256:" + textHash(JSON.stringify(stripVolatile(intent)));

  const manifest = {
    schema: MANIFEST_SCHEMA,
    generator: inputs.generatorVersion,
    projectSchema: intent.schema,
    catalogSchema: CATALOG_SCHEMA_VERSION,
    contract: { os: ["windows", "linux"], osUntested: ["macos"], gitHost: "github", ci: "github-actions", runtime: "node>=20", targets: Object.fromEntries(intent.targets.map((t) => [t, TARGETS[t].contract])) },
    targets: capabilities,
    packs: Object.fromEntries(packs.map((p) => [p.id, p.contentHash])),
    oracles: oracles.map((o) => ({ id: o.id, title: o.title, kind: o.kind, direction: o.direction ?? null, argv: o.argv, cwd: o.cwd, pack: o.pack, fast: o.fast, parser: o.parser ?? null, parserArgs: o.parserArgs ?? null, configFiles: o.configFiles, scope: o.scope, lockfile: packs.find((p) => p.id === o.pack)?.lockfile ?? null })),
    owned,
    ownedPathsNote: "checksum = sha256 of LF-normalized content; mode recorded separately (0644|0755). Partial by design: symlinks refused, binaries not emitted.",
    strictPredicates,
    overrides: overrideRegister,
    composition,
    intentHash,
    actionPins: ACTION_PINS,
    requiredCheck: REQUIRED_CHECK_NAME,
    gatedPaths,
    writtenLast: true,
  };

  return { artifacts, scaffold, catalog, probes, strictPredicates, oracles, ratchets, gatedPaths, manifest, canonical, roles, packs };
}

/** Remove nothing today; placeholder for fields that must not affect the intent hash. */
function stripVolatile(intent) {
  return intent;
}

/**
 * Applicable oracles from the COMMITTED `detected.applicable-oracles` finding
 * (resolver purity: the live tree never participates). Custom oracles are
 * always applicable — they are declared, not detected.
 * @param {import("./packs.mjs").Pack[]} packs @param {import("./intent.mjs").Intent} intent
 */
export function applicableOraclesFromIntent(packs, intent) {
  const ids = new Set(/** @type {string[]} */ (Array.isArray(intent.detected["applicable-oracles"]?.value) ? intent.detected["applicable-oracles"].value : []));
  return packs.flatMap((p) => p.oracles.filter((o) => p.id === "custom" || ids.has(o.id)).map((o) => ({ ...o, pack: p.id })));
}

function renderHarnessReadme({ generatorVersion, targets, packs }) {
  return `# harness/ — generated mechanism (do not edit)

Generated by sisu ${generatorVersion} for targets ${targets.join(", ")} with packs ${packs.join(", ")}.
Everything here is **build output**: regenerated wholesale on \`sisu upgrade\`, checksummed in
\`sisu.lock.json\`. To customize a mechanism, put a whole-file replacement of its CANONICAL
source under \`overrides/<kind>/<id>.md\` with \`based-on-canonical-hash\` in its frontmatter,
then re-emit. Never edit files here; \`doctor\` names every modified file.

This directory works with **no sisu binary present**. Maintenance scripts (Node >= 20):

| script | purpose |
|---|---|
| \`scripts/ratchet.mjs\` | run every ratchet metric; identities bound; waivers checked |
| \`scripts/waiver.mjs\` | scaffold a time-limited waiver for one metric |
| \`scripts/index.mjs\` | rebuild \`project/knowledge/INDEX.md\`; \`--check\` enforces the budget and promotion bar |
| \`scripts/capture.mjs\` | scaffold a candidate fact (under thirty seconds) |
| \`scripts/promote.mjs\` | promote candidate → active (handle must pass, or \`--approved-by\`) |
| \`scripts/drift.mjs\` | report active facts whose subject changed since verification |
| \`scripts/ledger.mjs\` | start / gate / end a run entry |
| \`scripts/setup-hooks.mjs\` | point \`core.hooksPath\` at \`harness/git-hooks\` (per clone) |
| \`scripts/wire-remote.mjs\` | PRINT the host mutations for branch protection; applies only with \`--apply\`, only when you run it |
| \`scripts/cold-load-check.mjs\` | run the consuming tool under an isolated config dir and assert the roles load |
| \`tests/\` | the self-verification suite: \`node --test "harness/tests/*.test.mjs"\` |

Evidence classes: anything produced on this machine is **review-observation** (UX). CI verdicts are
**artifact-verification**. Local git hooks and agent hooks are speed bumps, never walls.

MIGRATION: if \`sisu.yaml\` declares an older \`schema\` than the generator supports, \`upgrade\` stops
and names the migration steps; it never reads old-shaped files silently.
`;
}

/**
 * Scaffold files for project/ and overrides/ (init-only, user-owned afterwards).
 * @param {{ roles: any[], ratchets: any[], intent: import("./intent.mjs").Intent }} input
 * @returns {Artifact[]}
 */
function renderScaffold({ roles, ratchets, intent }) {
  /** @type {Artifact[]} */
  const out = [];
  const sc = (path, content) => out.push({ path, content, mode: "0644", composedFrom: [], target: "common", kind: "scaffold" });
  sc("project/README.md", `# project/ — your knowledge (never touched by upgrade)

- \`knowledge/candidate/\` — agents write freely here; never loaded into context.
- \`knowledge/active/\` — promoted facts; indexed in \`knowledge/INDEX.md\`.
- \`ledger/runs/\` — one file per run.
- \`waivers/\` — time-limited ratchet waivers.
- \`quality-baselines.json\` — ratchet baselines with measurement identities (gated path).
- \`roles/domain-guide.md\` — the one role you fill with your product's domain.
`);
  sc("project/knowledge/candidate/.gitkeep", "");
  sc("project/knowledge/active/.gitkeep", "");
  sc("project/knowledge/INDEX.md", renderIndex([]));
  sc("project/ledger/runs/.gitkeep", "");
  sc("project/waivers/.gitkeep", "");
  for (const r of roles.filter((x) => x.scaffold)) {
    sc(`project/roles/${r.name}.md`, inputsRoleScaffold(r));
  }
  sc("overrides/README.md", `# overrides/ — whole-file replacements of canonical sources

Mirror the canonical path: \`overrides/mechanisms/<id>.md\`, \`overrides/rules/<id>.md\`,
\`overrides/roles/<name>.md\`. Copy the canonical file, add
\`based-on-canonical-hash: sha256:<hash>\` to its frontmatter (\`sisu doctor\` prints the current
hash), edit, re-emit. Patching or merging is never done: an override replaces the whole file.
\`upgrade\` flags an override whose canonical base changed (stale-base) or disappeared (orphan).
`);
  sc("SETUP.prompt.md", renderSetupPrompt(intent));
  return out;
}

function inputsRoleScaffold(r) {
  return `---
kind: role
name: ${r.name}
title: ${JSON.stringify(r.title)}
description: ${JSON.stringify(r.description)}
capabilities: [${r.capabilities.join(", ")}]
model: ${r.model}
dispatch: ${JSON.stringify(r.dispatch)}
---

${r.body.trim()}
`;
}

function renderSetupPrompt(intent) {
  return `# SETUP — run this in your agent (no API key, no LLM call by sisu)

You are working in the repository for **${intent.product.name}**: ${intent.product.summary}

Read \`${intent.targets.includes("claude-code") ? "CLAUDE.md" : "AGENTS.md"}\` first. Then, as the \`scout\` and \`librarian\` roles:

1. Read the real codebase (entry points, tests, configs). Do not trust any document's numbers.
2. For each non-obvious, verifiable fact about this codebase (where an invariant is enforced,
   which oracle covers an area, a convention with its example), run
   \`node harness/scripts/capture.mjs "<claim>" --applies-to <path>\` and fill \`why\` and a
   verification handle. Write into \`project/knowledge/candidate/\` ONLY — never into \`active/\`.
   The first agent run must not bypass the promotion gate that exists to contain its mistakes.
3. Fill \`project/roles/domain-guide.md\` with this product's domain vocabulary and invariants.
4. Run the oracles in the Session protocol table and report real numbers.
5. End with a Handoff Block and \`node harness/scripts/ledger.mjs end\`.
`;
}
