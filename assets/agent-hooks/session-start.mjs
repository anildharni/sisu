#!/usr/bin/env node
// SessionStart hook — the knowledge drift tripwire. Prints (to stdout, which the
// agent runtime shows as context) the active facts whose subject changed since
// verification, overdue re-verifications, expired waivers and the loop-health
// line. It NEVER executes candidate-authored shell text. FAIL-OPEN.
// Blind spot, stated: the absence of a warning and the absence of this hook look
// identical from inside a session — harness/tests asserts it is still wired.
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { driftReport } from "../scripts/drift.mjs";
import { findRepoRoot } from "../scripts/common.mjs";

async function main() {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const root = process.env.CLAUDE_PROJECT_DIR ?? findRepoRoot(join(here, "..", ".."));
    const r = driftReport(root);
    const lines = [];
    lines.push(`[sisu] knowledge: ${r.active} active, ${r.candidates} candidate (${r.staleCandidates} older than ${r.maxAgeDays}d); loop: ${r.loop}`);
    for (const f of r.drifted) lines.push(`[sisu] DRIFT ${f.id}: subject changed since verification (${f.verifiedAt ?? "never"}) — presumptively stale, re-verify`);
    for (const f of r.overdue) lines.push(`[sisu] OVERDUE ${f.id}: last verified ${f.verifiedAt ?? "never"} (> ${r.reverifyDays}d)`);
    for (const w of r.expiredWaivers) lines.push(`[sisu] EXPIRED WAIVER ${w.file} (${w.metric}, expired ${w.expires}) — the ratchet will fail`);
    if (!r.drifted.length && !r.overdue.length && !r.expiredWaivers.length) lines.push("[sisu] no knowledge drift detected (a clean run says nothing about facts with no subject)");
    process.stdout.write(lines.join("\n") + "\n");
    process.exit(0);
  } catch (e) {
    process.stdout.write(`[sisu] drift tripwire could not run (${e?.message ?? e}) — treat the library as unverified this session\n`);
    process.exit(0);
  }
}

main();
