// Ratchet behaviour (DoD #5 deep suite): tightening passes, loosening fails,
// a measurement parser that gets nothing fails LOUDLY (never a silent zero),
// an identity change without an explicit rebaseline fails, rebaseline rewrites
// hash and number together, waiver expiry is a hard fail, a vacuous floor is
// rejected, and the lock-it-in nudge fires when debt drops.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluate } from "../assets/scripts/ratchet.mjs";
import { identityHash } from "../assets/lib/identity.mjs";

let root;
const metricsPath = () => join(root, "project", "quality-baselines.json");
const writeMetrics = (metrics) => writeFileSync(metricsPath(), JSON.stringify({ schema: "sisu.baselines/1", metrics }, null, 2));
const setCount = (n) => writeFileSync(join(root, "count.txt"), String(n));
const identity = { argv: ["node", "count.mjs"], cwd: ".", "config-files": ["count.config"], scope: ["."], lockfile: null };
const metric = (over = {}) => ({ direction: "ceiling", baseline: 10, identity, "identity-hash": identityHash(root, identity).hash, parser: "number", "measured-at": "x", ...over });
/** @template T @param {T | undefined} x @returns {T} */
const must = (x) => {
  assert.ok(x !== undefined, "expected a row");
  return /** @type {T} */ (x);
};
const statusOf = (id = "m.count") => must(evaluate(root, { today: "2026-10-03" }).rows.find((r) => r.id === id));

before(() => {
  root = mkdtempSync(join(tmpdir(), "sisu-ratchet-"));
  mkdirSync(join(root, "project", "waivers"), { recursive: true });
  writeFileSync(join(root, "sisu.yaml"), "schema: 1\ntopology:\n  same-principal: unknown\n");
  writeFileSync(join(root, "count.mjs"), 'import { readFileSync } from "node:fs"; process.stdout.write(readFileSync("count.txt", "utf8"));\n');
  writeFileSync(join(root, "crash.mjs"), "process.exit(1);\n");
  writeFileSync(join(root, "count.config"), "scope=all\n");
  setCount(10);
});
after(() => rmSync(root, { recursive: true, force: true }));

test("at baseline → OK; above → FAIL (loosening); below → LOCK-IT-IN nudge (tightening is free)", () => {
  writeMetrics({ "m.count": metric() });
  assert.equal(statusOf().status, "OK");
  setCount(11);
  const r = statusOf();
  assert.equal(r.status, "FAIL");
  assert.match(r.message, /above the baseline/);
  setCount(7);
  const l = statusOf();
  assert.equal(l.status, "LOCK-IT-IN");
  assert.match(l.message, /lower "m.count" to 7/);
  setCount(10);
});

test("measurement identity: a changed config file without a rebaseline FAILS; --rebaseline rewrites hash AND number together", () => {
  writeMetrics({ "m.count": metric() });
  writeFileSync(join(root, "count.config"), "scope=narrowed\n"); // the 'improve the number by narrowing scope' attack
  setCount(3);
  const r = statusOf();
  assert.equal(r.status, "FAIL");
  assert.equal(r.identity, "CHANGED");
  assert.match(r.message, /measurement identity changed/);
  const rb = evaluate(root, { rebaseline: "m.count", today: "2026-10-03" }).rows[0];
  assert.equal(rb.status, "REBASELINED");
  const saved = JSON.parse(readFileSync(metricsPath(), "utf8")).metrics["m.count"];
  assert.equal(saved.baseline, 3);
  assert.equal(saved["identity-hash"], identityHash(root, identity).hash);
  assert.match(saved["identity-hash"], /;partial$/);
  assert.equal(statusOf().status, "OK");
});

test("a parser that gets nothing is a loud FAIL, never a silent zero; an unmeasured baseline fails; a vacuous floor fails", () => {
  writeMetrics({
    "m.crash": metric({ identity: { ...identity, argv: ["node", "crash.mjs"] }, "identity-hash": identityHash(root, { ...identity, argv: ["node", "crash.mjs"] }).hash }),
    "m.unmeasured": metric({ baseline: "unmeasured" }),
    "m.floor0": metric({ direction: "floor", baseline: 0 }),
  });
  const rows = evaluate(root, { today: "2026-10-03" }).rows;
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.equal(by["m.crash"].status, "FAIL");
  assert.match(by["m.crash"].message, /expected a number|exited 1|no output/);
  assert.equal(by["m.unmeasured"].status, "FAIL");
  assert.match(by["m.unmeasured"].message, /unmeasured/);
  assert.equal(by["m.floor0"].status, "FAIL");
  assert.match(by["m.floor0"].message, /asserts nothing/);
});

test("floors only rise: below the floor FAILS; above nudges to raise", () => {
  writeMetrics({ "m.count": metric({ direction: "floor", baseline: 10 }) });
  setCount(9);
  assert.equal(statusOf().status, "FAIL");
  setCount(12);
  const r = statusOf();
  assert.equal(r.status, "LOCK-IT-IN");
  assert.match(r.message, /RAISE/);
  setCount(10);
});

test("waivers: an unexpired waiver raises the effective ceiling (and says who approved, at what evidence level); an EXPIRED waiver is a hard fail", () => {
  writeMetrics({ "m.count": metric() });
  setCount(12);
  writeFileSync(join(root, "project", "waivers", "m.count-2026-09-01.yaml"), "kind: waiver\nmetric: m.count\nraise-to: 12\nreason: migration in flight\napprover:\n  value: \"@owner\"\n  evidence-level: self-attested\ncreated: 2026-09-01\nexpires: 2026-12-01\n");
  const ok = statusOf();
  assert.equal(ok.status, "OK", ok.message);
  assert.equal(ok.effective, 12);
  assert.match(ok.waiver, /self-attested/);
  writeFileSync(join(root, "project", "waivers", "m.count-2026-09-01.yaml"), "kind: waiver\nmetric: m.count\nraise-to: 12\nreason: migration in flight\napprover:\n  value: \"@owner\"\n  evidence-level: self-attested\ncreated: 2026-08-01\nexpires: 2026-09-01\n");
  const expired = statusOf();
  assert.equal(expired.status, "FAIL");
  assert.match(expired.message, /EXPIRED/);
  rmSync(join(root, "project", "waivers", "m.count-2026-09-01.yaml"));
  setCount(10);
});

test("a missing or mis-schemed baselines file cannot be checked and fails", () => {
  writeFileSync(metricsPath(), JSON.stringify({ schema: "something-else", metrics: {} }));
  const rows = evaluate(root).rows;
  assert.equal(rows[0].status, "FAIL");
  assert.match(rows[0].message, /schema/);
});
