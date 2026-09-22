// Emitted self-verification suite (harness.self-verification). Runs on every
// commit in the handed-off repo with NO sisu binary present: `node --test "harness/tests/*.test.mjs"`.
// Zero dependencies. Labelled DETECTIVE: the role-file check is a conformance
// validator built from the consuming tool's documented frontmatter table, not the
// tool's real loader — the authoritative check is harness/scripts/cold-load-check.mjs.
// Reference incident: two role files sat unloadable for six weeks with zero error anywhere.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync, lstatSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { splitFrontmatter } from "../lib/frontmatter.mjs";
import { textHash } from "../lib/hash.mjs";
import { check as indexCheck } from "../scripts/index.mjs";
import { findRepoRoot } from "../scripts/common.mjs";

const root = findRepoRoot(dirname(fileURLToPath(import.meta.url)));
const read = (p) => readFileSync(join(root, ...p.split("/")), "utf8").replace(/\r\n?/g, "\n");
const has = (p) => existsSync(join(root, ...p.split("/")));
const manifest = JSON.parse(read("sisu.lock.json"));
const catalog = JSON.parse(read("harness/catalog.json"));

const ROOT_FILES = { "claude-code": "CLAUDE.md", "agents-md": "AGENTS.md" };
const ROLE_DIRS = { "claude-code": ".claude/agents", "agents-md": "harness/roles" };
// Claude Code subagent frontmatter — documented reference table (no official JSON schema exists).
const CLAUDE_AGENT_KEYS = new Set(["name", "description", "tools", "disallowedTools", "model", "permissionMode", "maxTurns", "skills", "mcpServers"]);
const CLAUDE_MODELS = new Set(["sonnet", "opus", "haiku", "inherit"]);

test("manifest and catalog are present and well-formed (anti-vacuity: enough mechanisms and roles)", () => {
  assert.equal(manifest.schema, "sisu.lock/1");
  assert.ok(Array.isArray(catalog.mechanisms) && catalog.mechanisms.length >= 20, "catalog has >= 20 mechanisms");
  assert.equal(new Set(catalog.mechanisms.map((m) => m.id)).size, catalog.mechanisms.length, "mechanism ids unique");
  for (const target of Object.keys(manifest.targets)) assert.ok(manifest.targets[target].roles.length >= 10, `${target}: >= 10 roles`);
});

test("every emitted role file loads under the documented frontmatter table (detective validator)", () => {
  for (const [target, cap] of Object.entries(manifest.targets)) {
    for (const role of cap.roles) {
      const p = `${ROLE_DIRS[target]}/${role}.md`;
      assert.ok(has(p), `${p} exists`);
      const text = read(p);
      assert.notEqual(text.charCodeAt(0), 0xfeff, `${p}: no BOM`);
      const data = /** @type {any} */ (splitFrontmatter(text).data); // throws on the unquoted-colon trap
      assert.ok(data, `${p}: frontmatter present`);
      assert.equal(data.name, role, `${p}: name matches file`);
      assert.match(String(data.name), /^[a-z0-9][a-z0-9-]*$/);
      assert.ok(typeof data.description === "string" && data.description.length > 20, `${p}: description`);
      if (target === "claude-code") {
        for (const k of Object.keys(data)) assert.ok(CLAUDE_AGENT_KEYS.has(k), `${p}: unknown frontmatter key ${k}`);
        if (data.model !== undefined) assert.ok(CLAUDE_MODELS.has(data.model), `${p}: model ${data.model}`);
        if (data.tools !== undefined) assert.equal(typeof data.tools, "string", `${p}: tools is a comma-separated string`);
      }
    }
  }
});

test("restricted roles carry their capability-restricting fields (omission upgrades privilege)", () => {
  const cap = manifest.targets["claude-code"];
  if (!cap) return;
  for (const role of cap.roles) {
    const text = read(`.claude/agents/${role}.md`);
    const { data: d, body } = splitFrontmatter(text);
    const data = /** @type {any} */ (d);
    const m = body.match(/capabilities: ([a-z, -]+) -->/);
    assert.ok(m, `${role}: generated capability comment present`);
    const caps = m[1].split(",").map((s) => s.trim());
    assert.ok(typeof data.tools === "string" && data.tools.length > 0, `${role}: tools allowlist present (a missing key inherits everything)`);
    if (!caps.includes("modify-code")) {
      assert.ok(typeof data.disallowedTools === "string" && /\bEdit\b/.test(data.disallowedTools) && /\bWrite\b/.test(data.disallowedTools), `${role}: lacks modify-code → disallowedTools must deny Edit and Write`);
      assert.ok(!/\bEdit\b|\bWrite\b/.test(data.tools), `${role}: Edit/Write not in tools`);
    }
    if (!caps.includes("spawn-agents")) assert.ok(!/\bAgent\b/.test(data.tools), `${role}: Agent not in tools`);
  }
});

test("role-dispatch map is complete in BOTH directions (every target resolves AND every role appears)", () => {
  for (const [target, cap] of Object.entries(manifest.targets)) {
    const rootText = read(ROOT_FILES[target]);
    const section = rootText.split(/^## Roles and dispatch/m)[1]?.split(/^## /m)[0];
    assert.ok(section, `${target}: dispatch section present`);
    const lines = [...section.matchAll(/→ `([a-z0-9-]+)` \(`([^`]+)`\)/g)];
    assert.ok(lines.length >= 10, `${target}: dispatch map has entries`);
    for (const [, role, path] of lines) assert.ok(has(path), `${target}: dispatch target ${role} → ${path} resolves on disk`);
    const listed = new Set(lines.map((l) => l[1]));
    for (const role of cap.roles) assert.ok(listed.has(role), `${target}: role ${role} appears in the dispatch map`);
    for (const role of listed) assert.ok(cap.roles.includes(role), `${target}: dispatch names ${role}, which is not an emitted role`);
  }
});

test("root-file cross-references to harness scripts and the knowledge index resolve", () => {
  for (const target of Object.keys(manifest.targets)) {
    const rootText = read(ROOT_FILES[target]);
    const refs = new Set([...rootText.matchAll(/(harness\/scripts\/[a-z-]+\.mjs|project\/knowledge\/INDEX\.md|\.github\/CODEOWNERS)/g)].map((m) => m[1]));
    assert.ok(refs.size >= 3, `${target}: references present`);
    for (const r of refs) {
      if (r === ".github/CODEOWNERS" && !manifest.owned[r]) continue; // not emitted on non-GitHub hosts / pre-existing
      assert.ok(has(r), `${target}: ${r} exists`);
    }
  }
});

test("owned files match the manifest checksums (hand-edited build output is detected)", () => {
  const skipMode = process.platform === "win32";
  for (const [p, checksum] of Object.entries(manifest.owned)) {
    const full = join(root, ...p.split("/"));
    assert.ok(existsSync(full), `${p} missing`);
    assert.ok(!lstatSync(full).isSymbolicLink(), `${p} is a symlink (refused in the owned set)`);
    const [shaPart, modePart] = checksum.split(";");
    assert.equal("sha256:" + textHash(readFileSync(full, "utf8")), shaPart, `${p} content differs from manifest — build output was edited; use overrides/`);
    if (!skipMode && modePart === "mode:0755") assert.ok(statSync(full).mode & 0o100, `${p} lost its executable bit`);
  }
});

test("CI workflow shape: pinned actions, always() verdict with the required-check name, merge_group, governance carve-out", () => {
  const p = ".github/workflows/sisu-gates.yml";
  if (!manifest.owned[p]) return; // not emitted (host/CI unsupported) — doctor reports the omission
  const wf = read(p);
  for (const m of wf.matchAll(/uses:\s*([^\s#]+)/g)) assert.match(m[1], /@[0-9a-f]{40}$/, `unpinned action ${m[1]}`);
  assert.ok(wf.includes(`name: ${JSON.stringify(manifest.requiredCheck)}`), "required check job present with exact name");
  const verdict = wf.split(/\n  verdict:\n/)[1];
  assert.ok(verdict && /if: \$\{\{ always\(\) \}\}/.test(verdict), "verdict runs under always()");
  assert.ok(/needs\.gates\.result|GATES_RESULT/.test(verdict), "verdict inspects needs.*.result explicitly");
  assert.ok(!/strategy:/.test(verdict.split(/\n  [a-z-]+:\n/)[0]), "verdict has no matrix (a matrix renames the check)");
  assert.ok(/^  merge_group:/m.test(wf), "merge_group declared");
  for (const must of ["harness/*", "sisu.lock.json", ".claude/*", "project/quality-baselines.json"]) assert.ok(wf.includes(must), `governance carve-out includes ${must}`);
  assert.ok(/\*\) DOCS_ONLY=false; break ;;/.test(wf), "catch-all arm refuses to treat unknown files as docs");
});

test("agent hooks are wired and present (a silently un-wired fail-open hook looks healthy)", () => {
  const cap = manifest.targets["claude-code"];
  if (!cap) return;
  const settings = JSON.parse(read(".claude/settings.json"));
  const flat = JSON.stringify(settings.hooks);
  for (const h of cap.agentHooks) {
    if (h === "shell-text.mjs") continue; // library, not a hook
    assert.ok(has(`harness/agent-hooks/${h}`), `${h} exists`);
    assert.ok(flat.includes(`harness/agent-hooks/${h}`), `${h} is wired in .claude/settings.json`);
  }
  assert.ok(Array.isArray(settings.hooks.SessionStart) && settings.hooks.SessionStart.length === 1, "session-start tripwire wired");
});

test("CODEOWNERS covers the gated set when an approver is set; valid lines only; self-owned", () => {
  const p = ".github/CODEOWNERS";
  if (!manifest.owned[p]) return;
  const text = read(p);
  assert.ok(Buffer.byteLength(text) < 3 * 1024 * 1024, "under the 3 MB load limit");
  const live = text.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#"));
  for (const l of live) {
    assert.match(l, /^\S+\s+@\S+/, `invalid CODEOWNERS line (silently skipped by GitHub): ${l}`);
    assert.ok(!l.startsWith("!"), "negation is unsupported");
  }
  if (live.length) {
    assert.ok(live.some((l) => l.startsWith("/.github/CODEOWNERS")), "CODEOWNERS owns itself");
    for (const g of manifest.gatedPaths) assert.ok(live.some((l) => l.startsWith(g + " ") || l.startsWith(g)), `gated path ${g} is owned`);
  }
});

test("knowledge: active facts meet the promotion bar, no active contradictions, index current, eager budget holds", () => {
  const r = indexCheck(root);
  assert.deepEqual(r.problems, [], r.problems.join("\n"));
});

test("ratchet baselines: schema, bound identities, no vacuous floors, no unmeasured baselines", () => {
  const p = "project/quality-baselines.json";
  if (!has(p)) return;
  const b = JSON.parse(read(p));
  assert.equal(b.schema, "sisu.baselines/1");
  for (const [id, m] of Object.entries(b.metrics)) {
    assert.ok(["ceiling", "floor"].includes(m.direction), `${id}: direction`);
    assert.match(String(m["identity-hash"]), /^sha256:[0-9a-f]{64};partial$/, `${id}: identity hash bound (and labelled partial)`);
    assert.ok(Array.isArray(m.identity?.argv) && m.identity.argv.length, `${id}: argv array`);
    assert.notEqual(m.baseline, "unmeasured", `${id}: baseline unmeasured — initialize with ratchet.mjs --rebaseline ${id}`);
    if (m.direction === "floor") assert.ok(m.baseline > 0, `${id}: a floor of ${m.baseline} asserts nothing`);
  }
});

test("harness/ carries no symlinks and the vendored runtime is intact", () => {
  const walk = (d) => {
    for (const ent of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, ent.name);
      assert.ok(!ent.isSymbolicLink(), `${full} is a symlink`);
      if (ent.isDirectory()) walk(full);
    }
  };
  walk(join(root, "harness"));
  for (const f of ["lib/yaml.mjs", "lib/frontmatter.mjs", "lib/hash.mjs", "lib/measure.mjs", "lib/identity.mjs", "lib/knowledge.mjs", "scripts/common.mjs"]) assert.ok(has(`harness/${f}`), `harness/${f}`);
});
