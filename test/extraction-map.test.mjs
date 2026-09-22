// Completeness: every path in the reference read scope maps to exactly one
// classification; every mechanism id resolves to a canonical mechanism; hybrids
// name sections; mechanism entries with no ids are DECLARED gaps (and there must
// be a stated reason). No silently disappearing files.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseMapping } from "../assets/lib/yaml.mjs";
import { loadCanonical } from "../src/canonical.mjs";

const root = join(import.meta.dirname, "..");
const map = /** @type {any} */ (parseMapping(readFileSync(join(root, "extraction-map.yaml"), "utf8")));
const scope = readFileSync(join(root, "extraction", "read-scope.txt"), "utf8")
  .split(/\r?\n/)
  .filter(Boolean)
  .map((l) => ({ sha: l.slice(0, 40), path: l.slice(41) }));
const canonical = loadCanonical(root);
const ids = new Set(canonical.mechanisms.map((m) => m.id));

test("every read-scope path has exactly one entry with the pinned blob sha", () => {
  assert.ok(scope.length >= 70, "read scope is populated");
  const byPath = new Map();
  for (const e of map.entries) {
    assert.ok(!byPath.has(e["source-path"]), `duplicate entry ${e["source-path"]}`);
    byPath.set(e["source-path"], e);
  }
  for (const s of scope) {
    const e = byPath.get(s.path);
    assert.ok(e, `unmapped read-scope path ${s.path}`);
    assert.equal(e["source-blob-sha"], s.sha, `${s.path}: blob sha matches the pinned reference`);
  }
  assert.equal(map.entries.length, scope.length, "no entries outside the read scope");
  assert.equal(map.reference.sha, "b444f93efa24f4a6c20509d52e9c448775ef3760");
});

test("classifications are valid, hybrids name sections, mechanism ids resolve, gaps are declared", () => {
  const gaps = [];
  for (const e of map.entries) {
    assert.ok(["mechanism", "project", "hybrid", "excluded"].includes(e.classification), `${e["source-path"]}: classification`);
    assert.ok(typeof e.reason === "string" && e.reason.length > 15, `${e["source-path"]}: reason`);
    if (e.classification === "hybrid") assert.ok(Array.isArray(e["source-sections"]) && e["source-sections"].length > 0, `${e["source-path"]}: hybrid needs source-sections`);
    for (const id of e["mechanism-ids"] ?? []) assert.ok(ids.has(id), `${e["source-path"]}: unknown mechanism id ${id}`);
    if ((e.classification === "mechanism" || e.classification === "hybrid") && !(e["mechanism-ids"] ?? []).length) {
      assert.match(e.reason, /GAP/, `${e["source-path"]}: a mechanism with no ids must be a declared GAP`);
      gaps.push(e["source-path"]);
    }
  }
  // the known v1 gap: the GitHub expression-length cap guard (deliberately not extracted)
  assert.deepEqual(gaps.sort(), ["backend/tests/workflowExpressionLength.test.js", "scripts/workflow-expression-length.mjs"]);
});

test("every canonical mechanism with extracted-from points at read-scope paths or spec documents", () => {
  const paths = new Set(scope.map((s) => s.path));
  for (const m of canonical.mechanisms) {
    for (const ref of m.extractedFrom) {
      const p = ref.split("#")[0];
      assert.ok(paths.has(p) || p.startsWith("REVIEW-") || p.endsWith("/"), `${m.id}: extracted-from ${ref} not in read scope`);
    }
  }
});
