#!/usr/bin/env node
// pre-push gate: runs the FAST oracles and the ratchets before a push leaves the
// machine. Under an agent session (CLAUDECODE / CLAUDE_CODE_ENTRYPOINT set) it
// defers to CI immediately instead of pretending to review. FAIL-OPEN on
// internal errors; the only fail-closed path is a real red oracle/ratchet.
// Defeated by --no-verify or a hooksPath override: it is fast feedback, not a wall.
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { findRepoRoot, readManifest, run } from "./common.mjs";
import { evaluate } from "./ratchet.mjs";

function main() {
  try {
    if (process.env.CLAUDECODE || process.env.CLAUDE_CODE_ENTRYPOINT) {
      console.log("[pre-push] agent session detected — deferring to CI (the required check is the wall)");
      process.exit(0);
    }
    const root = findRepoRoot(dirname(fileURLToPath(import.meta.url)));
    const manifest = readManifest(root);
    let failed = 0;
    for (const o of (manifest?.oracles ?? []).filter((x) => x.kind === "invariant" && x.fast)) {
      const res = run(o.argv, { cwd: join(root, ...(o.cwd ?? ".").split("/")) });
      const ok = res.exitCode === 0;
      console.log(`[pre-push] ${o.id}: ${ok ? "pass" : "FAIL"}`);
      if (!ok) {
        failed += 1;
        console.log((res.stdout + res.stderr).split("\n").slice(-20).join("\n"));
      }
    }
    const { rows } = evaluate(root);
    for (const r of rows) {
      console.log(`[pre-push] ratchet ${r.id}: ${r.status}${r.message ? ` — ${r.message}` : ""}`);
      if (r.status === "FAIL") failed += 1;
    }
    if (failed) {
      console.error(`[pre-push] ${failed} gate(s) red. Fix the cause; do not bypass (bypass is Tier 0 for agents; humans: CI re-runs everything anyway).`);
      process.exit(1);
    }
    console.log("[pre-push] fast gates green — CI runs the full set");
    process.exit(0);
  } catch (e) {
    console.log(`[pre-push] could not run (${e?.message ?? e}) — FAIL-OPEN; CI is the wall`);
    process.exit(0);
  }
}

main();
