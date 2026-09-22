// Acceptance matrix (CHECKPOINT §14): cheap universal properties across the FULL
// matrix — both targets × every profile × all three packs — resolve cleanly,
// byte-identical re-resolve, every mechanism rendered with a state and a reason
// when omitted. Full coverage for per-target strict evaluation and per-profile
// omission rendering; unsupported host/CI combinations degrade loudly.
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "../src/resolve.mjs";
import { validateIntent } from "../src/intent.mjs";
import { loadCanonicalFiles, loadAssets, GENERATOR_VERSION } from "../src/manifest.mjs";
import { TARGETS } from "../src/targets.mjs";

const canonicalFiles = loadCanonicalFiles();
const assets = loadAssets();
/** @template T @param {T | undefined} x @returns {T} */
const must = (x) => {
  assert.ok(x !== undefined, "expected a value");
  return /** @type {T} */ (x);
};
const finding = (value) => ({ value, evidence: value === "unknown" ? "unknown" : "detected", at: "no-commit", "inputs-digest": "sha256:x;partial", inputs: [] });

/** @param {{ targets: string[], profile: string, pack: string, host?: string, ci?: string, samePrincipal?: boolean | "unknown" }} o */
function intentFor({ targets, profile, pack, host = "github", ci = "none", samePrincipal = "unknown" }) {
  const applicable = pack === "node" ? ["node.test", "node.lint-errors"] : pack === "python" ? ["python.test", "python.lint-errors"] : [];
  return validateIntent({
    schema: 1,
    product: { name: "Matrix", summary: "A synthetic project used to exercise every cell of the acceptance matrix." },
    profile,
    targets,
    packs: [pack],
    release: { model: "integration-branch", "default-branch": "main", "integration-branch": "dev" },
    policy: { approver: "@owner", "tier1-paths": ["src/auth/**"] },
    topology: { "same-principal": samePrincipal },
    ...(pack === "custom" ? { "custom-oracles": [{ id: "custom.lint", title: "Custom lint", kind: "ratchet", direction: "ceiling", argv: ["make", "lint-count"], parser: "number" }, { id: "custom.test", title: "Custom test", kind: "invariant", argv: ["make", "test"] }] } : {}),
    detected: { "git-host": finding(host), ci: finding(ci), "repo-slug": finding(host === "github" ? "org/repo" : "unknown"), "default-branch": finding("main"), "applicable-oracles": finding(applicable), "gate-definition-paths": finding(pack === "node" ? ["package.json"] : pack === "python" ? ["pyproject.toml"] : []) },
  });
}

const TARGET_SETS = [["claude-code"], ["agents-md"], ["claude-code", "agents-md"]];
const PROFILES = ["solo", "lead-team", "enterprise"];
const PACKS = ["node", "python", "custom"];

for (const targets of TARGET_SETS) {
  for (const profile of PROFILES) {
    for (const pack of PACKS) {
      test(`cell ${targets.join("+")} × ${profile} × ${pack}: resolves, is deterministic, renders every mechanism`, () => {
        const inputs = { canonicalFiles, overrides: {}, intent: intentFor({ targets, profile, pack }), projectRoles: {}, assets, generatorVersion: GENERATOR_VERSION };
        const g1 = resolve(inputs);
        const g2 = resolve(inputs);
        assert.deepEqual(g1.artifacts.map((a) => [a.path, a.content, a.mode]), g2.artifacts.map((a) => [a.path, a.content, a.mode]), "byte-identical re-resolve");
        assert.deepEqual(g1.manifest, g2.manifest);
        assert.ok(g1.catalog.length >= 30);
        for (const row of g1.catalog) {
          assert.ok(["installed", "omitted", "deprecated"].includes(row.state));
          if (row.state !== "installed") assert.ok(row.reason, `${row.id}: omission needs a reason`);
        }
        for (const t of targets) {
          const root = must(g1.artifacts.find((a) => a.path === TARGETS[t].rootFile));
          for (const row of g1.catalog) assert.ok(root.content.includes(`\`${row.id}\``), `${t}: enforcement table renders ${row.id} (omission is permitted; silence is not)`);
          assert.ok(Buffer.byteLength(root.content) <= TARGETS[t].eagerBudgetBytes, `${t}: root under the eager budget`);
          for (const role of g1.manifest.targets[t].roles) assert.ok(g1.artifacts.some((a) => a.path === `${t === "claude-code" ? ".claude/agents" : "harness/roles"}/${role}.md`));
        }
        if (!targets.includes("claude-code")) {
          assert.ok(!g1.artifacts.some((a) => a.path.startsWith("harness/agent-hooks/")), "no agent hooks without the claude-code target");
          assert.equal(must(g1.catalog.find((r) => r.id === "agent-hooks.deny-tier0-bypass")).state, "omitted");
        }
        assert.ok(g1.artifacts.some((a) => a.path === ".github/workflows/sisu-gates.yml"));
        const wf = must(g1.artifacts.find((a) => a.path === ".github/workflows/sisu-gates.yml")).content;
        for (const m of wf.matchAll(/uses:\s*([^\s#]+)/g)) assert.match(String(m[1]), /@[0-9a-f]{40}$/);
        if (pack === "python") assert.ok(wf.includes("actions/setup-python@"), "python pack adds the python setup step");
        if (pack === "custom") assert.ok(wf.includes("make test"), "custom invariant oracle rendered as a CI step");
        const baselineOracles = g1.ratchets.map((o) => o.id);
        assert.deepEqual(baselineOracles, pack === "node" ? ["node.lint-errors"] : pack === "python" ? ["python.lint-errors"] : ["custom.lint"]);
      });
    }
  }
}

test("per-profile omission rendering: a same-principal topology omits agent-identity separation WITH a reason, in every profile", () => {
  for (const profile of PROFILES) {
    const g = resolve({ canonicalFiles, overrides: {}, intent: intentFor({ targets: ["claude-code"], profile, pack: "node", samePrincipal: true }), projectRoles: {}, assets, generatorVersion: GENERATOR_VERSION });
    const row = must(g.catalog.find((r) => r.id === "governance.agent-identity-separation"));
    assert.equal(row.state, "omitted");
    assert.match(String(row.reason), /same-principal/);
    const root = must(g.artifacts.find((a) => a.path === "CLAUDE.md")).content;
    assert.match(root, /governance\.agent-identity-separation`[^\n]*omitted — same-principal/);
  }
});

test("unsupported host/CI combinations degrade loudly: every remote-plane mechanism is omitted with the reason, nothing silently reduced", () => {
  const g = resolve({ canonicalFiles, overrides: {}, intent: intentFor({ targets: ["claude-code", "agents-md"], profile: "enterprise", pack: "node", host: "gitlab", ci: "gitlab-ci" }), projectRoles: {}, assets, generatorVersion: GENERATOR_VERSION });
  for (const id of ["governance.codeowners", "governance.branch-protection", "ci.required-gates", "ci.secret-scan", "ratchet.debt-ceiling"]) {
    const row = must(g.catalog.find((r) => r.id === id));
    assert.equal(row.state, "omitted", id);
    assert.match(String(row.reason), /requires (host|CI)/);
  }
  assert.ok(!g.artifacts.some((a) => a.path.startsWith(".github/")), "no GitHub artifacts for a non-GitHub host");
  assert.ok(g.artifacts.some((a) => a.path === "CLAUDE.md") && g.artifacts.some((a) => a.path === "AGENTS.md"), "root files still emitted");
});

test("per-target strict predicates: agents-md and claude-code carry independent remote-wall mechanism sets in the manifest", () => {
  const g = resolve({ canonicalFiles, overrides: {}, intent: intentFor({ targets: ["claude-code", "agents-md"], profile: "lead-team", pack: "node" }), projectRoles: {}, assets, generatorVersion: GENERATOR_VERSION });
  assert.ok(g.manifest.strictPredicates["remote-wall"].mechanisms.includes("ci.required-gates"));
  assert.ok(g.manifest.strictPredicates["remote-wall"].mechanisms.includes("governance.codeowners"));
  assert.deepEqual(Object.keys(g.manifest.targets).sort(), ["agents-md", "claude-code"]);
  assert.equal(g.manifest.targets["agents-md"].agentHooks.length, 0);
  assert.ok(g.manifest.targets["claude-code"].agentHooks.length >= 4);
});
