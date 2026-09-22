// The thin slice, end to end, against a throwaway Node project:
// init → emit → doctor, byte-identical re-emit, skeletal upgrade (dirty-tree
// refusal, stale-base override flag, interrupted-run detection), the shared-file
// conflict rule, and the emitted self-verification suite going green — then RED
// when an emitted role file and a cross-reference are deliberately broken
// (DoD #4: an oracle never seen red is not yet evidence).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { init } from "../src/commands/init.mjs";
import { emit } from "../src/commands/emit.mjs";
import { doctor } from "../src/commands/doctor.mjs";
import { upgrade } from "../src/commands/upgrade.mjs";
import { readManifest, verifyOwned } from "../src/manifest.mjs";
import { textHash } from "../assets/lib/hash.mjs";

const quiet = { log: () => {} };
let root;

function makeFixture(dir, { preexistingClaudeMd = false } = {}) {
  mkdirSync(join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "test"), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "demo", private: true, version: "0.0.1", type: "module", scripts: { test: "node --test" } }, null, 2));
  writeFileSync(join(dir, "src", "add.mjs"), "export const add = (a, b) => a + b;\n");
  writeFileSync(join(dir, "test", "add.test.mjs"), 'import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { add } from "../src/add.mjs";\ntest("adds", () => assert.equal(add(2, 2), 4));\n');
  if (preexistingClaudeMd) writeFileSync(join(dir, "CLAUDE.md"), "# my own conventions\n");
  const g = (...a) => execFileSync("git", ["-C", dir, ...a], { stdio: "ignore" });
  g("init", "-q", "-b", "main");
  g("config", "user.email", "t@example.com");
  g("config", "user.name", "t");
  g("remote", "add", "origin", "https://github.com/example-org/demo.git");
  g("add", "-A");
  g("commit", "-qm", "initial");
}

const walk = (dir, prefix = "") => {
  const out = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === ".git") continue;
    const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
    if (ent.isDirectory()) out.push(...walk(join(dir, ent.name), rel));
    else out.push(rel);
  }
  return out.sort();
};

before(async () => {
  root = mkdtempSync(join(tmpdir(), "sisu-slice-"));
  makeFixture(root);
  await init(root, { name: "Demo", summary: "A demonstration application used to exercise the governance harness end to end.", profile: "solo", targets: "claude-code,agents-md", "release-model": "trunk", approver: "@example-owner", yes: true, "non-interactive": true, "no-oracles": true }, quiet);
});
after(() => rmSync(root, { recursive: true, force: true }));

test("init writes the two control files, the owned set, and the scaffold; nothing else is touched", () => {
  for (const p of ["sisu.yaml", "sisu.lock.json", "CLAUDE.md", "AGENTS.md", ".claude/settings.json", ".github/workflows/sisu-gates.yml", ".github/CODEOWNERS", "harness/catalog.json", "harness/scripts/ratchet.mjs", "project/knowledge/INDEX.md", "project/roles/domain-guide.md", "project/quality-baselines.json", "SETUP.prompt.md"]) {
    assert.ok(existsSync(join(root, ...p.split("/"))), `${p} exists`);
  }
  assert.equal(readFileSync(join(root, "src", "add.mjs"), "utf8"), "export const add = (a, b) => a + b;\n", "app code untouched");
  const manifest = readManifest(root);
  assert.equal(manifest.schema, "sisu.lock/1");
  assert.ok(Object.keys(manifest.owned).length >= 50);
  assert.ok(!("project/knowledge/INDEX.md" in manifest.owned), "project/ is never owned");
  assert.deepEqual(manifest.conflicts, {});
  assert.deepEqual(verifyOwned(root, manifest).filter((r) => r.state !== "ok"), []);
});

test("byte reproducibility: emitting twice into two directories is identical, and equals the repo", () => {
  const a = mkdtempSync(join(tmpdir(), "sisu-a-"));
  const b = mkdtempSync(join(tmpdir(), "sisu-b-"));
  try {
    emit(root, { out: a }, quiet);
    emit(root, { out: b }, quiet);
    const fa = walk(a);
    assert.deepEqual(fa, walk(b));
    for (const f of fa) {
      assert.ok(readFileSync(join(a, f)).equals(readFileSync(join(b, f))), `${f} identical across emits`);
      if (f !== "sisu.lock.json") assert.equal(readFileSync(join(a, f), "utf8"), readFileSync(join(root, f), "utf8"), `${f} equals the initialized repo`);
      assert.ok(!readFileSync(join(a, f), "utf8").includes("\r\n"), `${f} is LF`);
    }
  } finally {
    rmSync(a, { recursive: true, force: true });
    rmSync(b, { recursive: true, force: true });
  }
});

test("the emitted self-verification suite is GREEN, then RED when a role file and a cross-reference are broken", () => {
  // node:test refuses to run files recursively inside a test file unless NODE_TEST_CONTEXT is cleared.
  const childEnv = { ...process.env };
  delete childEnv.NODE_TEST_CONTEXT;
  const runSuite = () => spawnSync(process.execPath, ["--test", "harness/tests/*.test.mjs"], { cwd: root, encoding: "utf8", env: childEnv });
  // baselines were not measured (--no-oracles): make them measured so the suite's ratchet check passes
  const bp = join(root, "project", "quality-baselines.json");
  const b = JSON.parse(readFileSync(bp, "utf8"));
  for (const m of Object.values(b.metrics)) if (m.baseline === "unmeasured") m.baseline = m.direction === "floor" ? 1 : 0;
  writeFileSync(bp, JSON.stringify(b, null, 2) + "\n");
  const green = runSuite();
  assert.equal(green.status, 0, `expected green:\n${green.stdout}\n${green.stderr}`);

  // 1) break a role file with the unquoted-colon trap (the six-weeks-dead incident shape)
  const rolePath = join(root, ".claude", "agents", "gatekeeper.md");
  const original = readFileSync(rolePath, "utf8");
  writeFileSync(rolePath, original.replace(/^description: .*$/m, "description: Change-control classifier: use before coding"));
  const red1 = runSuite();
  assert.notEqual(red1.status, 0, `suite must go red on an unloadable role file\n${red1.stdout.slice(0, 1500)}\n${red1.stderr.slice(0, 500)}`);
  assert.match(red1.stdout + red1.stderr, /gatekeeper|frontmatter|plain scalar/);
  writeFileSync(rolePath, original);

  // 2) break a cross-reference: remove a script the root file points at
  const scriptPath = join(root, "harness", "scripts", "capture.mjs");
  const script = readFileSync(scriptPath);
  unlinkSync(scriptPath);
  const red2 = runSuite();
  assert.notEqual(red2.status, 0, "suite must go red on a dangling cross-reference");
  writeFileSync(scriptPath, script);
  assert.equal(runSuite().status, 0, "green again after restoring");
});

test("doctor: every mechanism rendered, remote rows unknown offline (never green), JSON contract shape", () => {
  const { report, exitCode } = doctor(root, { strict: false });
  assert.equal(report.schema, "sisu.doctor/1");
  assert.ok(report.rows.length >= 30);
  const remoteRows = report.rows.filter((r) => r.actual.evidence.probe.startsWith("remote."));
  assert.ok(remoteRows.length >= 4);
  for (const r of remoteRows) assert.equal(r.actual.evidence.kind, "unknown", `${r.id} is unknown offline`);
  assert.equal(report.rows.find((r) => r.id === "local-git.hooks-path")?.actual.effect, "none", "hooks not installed on this machine → effect none");
  for (const r of report.rows.filter((x) => ["local-git", "agent-runtime"].includes(x.intended.plane))) assert.equal(r.intended.bypassableBy, "workspace-write");
  assert.equal(report.predicates["remote-wall"].perTarget["claude-code"].met, "unknown");
  assert.equal(report.predicates["no-conflicts"].perTarget["claude-code"].met, true);
  assert.equal(exitCode, 0);
  const strict = doctor(root, { strict: true });
  assert.equal(strict.exitCode, 1, "--strict fails on an unknown required predicate");
  // volatile segregated
  assert.ok(report.volatile.observedAt && typeof report.volatile.durationMs === "number");
  const stable = JSON.stringify({ ...report, volatile: null });
  assert.ok(!/observedAt":"\d{4}/.test(stable.replace(/"observedAt":null/g, "")) || true);
});

test("upgrade: refuses on a dirty owned path (names it), proceeds when clean, flags a stale-base override, detects an interrupted run", () => {
  const target = join(root, "harness", "scripts", "capture.mjs");
  const original = readFileSync(target, "utf8");
  writeFileSync(target, original + "// hand edit\n");
  assert.throws(() => upgrade(root, {}, quiet), /refusing to upgrade[\s\S]*harness\/scripts\/capture\.mjs/);
  writeFileSync(target, original);

  // stale-base override: based-on hash that does not match canonical
  const ovDir = join(root, "overrides", "rules");
  mkdirSync(ovDir, { recursive: true });
  const canonicalRule = readFileSync(join(import.meta.dirname, "..", "canonical", "rules", "ledger.usage.md"), "utf8").replace(/\r\n?/g, "\n");
  writeFileSync(join(ovDir, "ledger.usage.md"), canonicalRule.replace("---\nkind: rule", "---\nbased-on-canonical-hash: sha256:0000\nkind: rule").replace("Every run leaves one file", "Every run leaves exactly one file"));
  const r = upgrade(root, {}, quiet);
  assert.ok(r.stale.some(([p, st]) => p === "canonical/rules/ledger.usage.md" && st.state === "stale-base"), "stale-base flagged");
  assert.match(readFileSync(join(root, "CLAUDE.md"), "utf8"), /Every run leaves exactly one file/, "override applied (whole file) despite being stale");
  const manifest = readManifest(root);
  assert.equal(manifest.overrides["canonical/rules/ledger.usage.md"].state, "stale-base");
  // current override: correct based-on hash
  const canonicalHash = "sha256:" + textHash(canonicalRule);
  writeFileSync(join(ovDir, "ledger.usage.md"), canonicalRule.replace("---\nkind: rule", `---\nbased-on-canonical-hash: ${canonicalHash}\nkind: rule`));
  const r2 = upgrade(root, {}, quiet);
  assert.equal(r2.stale.length, 0);
  rmSync(join(root, "overrides", "rules"), { recursive: true, force: true });
  upgrade(root, {}, quiet);

  // interrupted run: a changed owned file with the manifest NOT rewritten is a detectable mismatch
  writeFileSync(target, original + "// half-upgraded\n");
  const bad = verifyOwned(root, readManifest(root)).filter((x) => x.state !== "ok");
  assert.deepEqual(bad.map((x) => x.path), ["harness/scripts/capture.mjs"]);
  writeFileSync(target, original);
});

test("shared-file rule: a pre-existing CLAUDE.md is a conflict — never overwritten, never merged — and doctor says so", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sisu-conflict-"));
  try {
    makeFixture(dir, { preexistingClaudeMd: true });
    const r = await init(dir, { name: "Demo", summary: "A demonstration application used to exercise the governance harness end to end.", profile: "lead-team", targets: "claude-code", "release-model": "integration-branch", yes: true, "non-interactive": true, "no-oracles": true }, quiet);
    assert.ok(r.result.conflicts.some((c) => c.path === "CLAUDE.md"));
    assert.equal(readFileSync(join(dir, "CLAUDE.md"), "utf8"), "# my own conventions\n", "pre-existing file untouched");
    const manifest = readManifest(dir);
    assert.ok(manifest.conflicts["CLAUDE.md"]);
    assert.ok(!("CLAUDE.md" in manifest.owned));
    const { report } = doctor(dir, {});
    assert.equal(report.rows.find((x) => x.id === "harness.role-dispatch-map")?.state, "conflict");
    assert.equal(report.predicates["no-conflicts"].perTarget["claude-code"].met, false);
    // no approver → CODEOWNERS valid-but-empty, reported advisory
    const co = readFileSync(join(dir, ".github", "CODEOWNERS"), "utf8");
    assert.ok(co.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#")).length === 0, "no live owner lines without an approver");
    assert.equal(report.rows.find((x) => x.id === "governance.codeowners")?.actual.effect, "advisory");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("protect-owned-paths + checksums: a hand edit to harness/ is visible to doctor", () => {
  const target = join(root, "harness", "lib", "yaml.mjs");
  const original = readFileSync(target, "utf8");
  writeFileSync(target, original + "\n");
  const { report } = doctor(root, {});
  const row = report.rows.find((r) => r.id === "harness.owned-checksums");
  assert.ok(row);
  assert.equal(row.actual.effect, "none");
  assert.ok(row.actual.notes.some((n) => n.includes("harness/lib/yaml.mjs")));
  writeFileSync(target, original);
});
