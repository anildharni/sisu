#!/usr/bin/env node
// Knowledge drift tripwire. Reports (never fixes):
//  - active facts whose subject (applies-to) changed since verification
//  - facts downstream of a drifted one via depends-on (expiry propagation)
//  - overdue re-verifications (verified-at older than policy.knowledge.reverify-days)
//  - expired waivers
//  - loop health against the pre-committed kill criteria
// It never executes candidate-authored shell text. Exit 0 always unless --strict.
import { join } from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { findRepoRoot, readIntent, parseArgs, readText, WAIVERS_DIR } from "./common.mjs";
import { loadTier, factSubjectHash, propagateStale, loopHealth } from "../lib/knowledge.mjs";
import { parseMapping } from "../lib/yaml.mjs";

/** @param {string} root @param {{ today?: string }} [opts] */
export function driftReport(root, opts = {}) {
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const intent = /** @type {any} */ (readIntent(root));
  const kp = intent?.policy?.knowledge ?? {};
  const reverifyDays = Number(kp["reverify-days"] ?? 90);
  const kill = { "min-candidates": 20, "max-age-days": 30, "min-promotion-rate": 0.05, "window-days": 60, ...(kp["loop-dead"] ?? {}) };
  const active = loadTier(root, "active");
  const candidates = loadTier(root, "candidate");
  const live = active.facts.filter((f) => f.status !== "superseded");
  const drifted = [];
  for (const f of live) {
    if (!f.appliesTo.length) continue;
    const h = factSubjectHash(root, f);
    if (f.subjectHash && h !== f.subjectHash) drifted.push({ id: f.id, file: f.file, verifiedAt: f.verifiedAt, reason: "subject changed" });
  }
  const propagated = [];
  for (const d of drifted) for (const id of propagateStale(d.id, live)) if (!drifted.some((x) => x.id === id) && !propagated.some((x) => x.id === id)) propagated.push({ id, via: d.id });
  const overdue = live.filter((f) => {
    if (!f.verifiedAt) return f.promotedBy?.["evidence-level"] !== "human";
    return (Date.parse(today) - Date.parse(f.verifiedAt)) / 86400000 > reverifyDays;
  }).map((f) => ({ id: f.id, file: f.file, verifiedAt: f.verifiedAt }));
  const expiredWaivers = [];
  const wdir = join(root, ...WAIVERS_DIR.split("/"));
  if (existsSync(wdir)) {
    for (const f of readdirSync(wdir).filter((x) => /\.ya?ml$/.test(x)).sort()) {
      try {
        const w = parseMapping(readText(join(wdir, f)));
        if (typeof w.expires === "string" && w.expires < today) expiredWaivers.push({ file: `${WAIVERS_DIR}/${f}`, metric: w.metric, expires: w.expires });
      } catch {
        expiredWaivers.push({ file: `${WAIVERS_DIR}/${f}`, metric: "?", expires: "unparseable" });
      }
    }
  }
  const health = loopHealth({ candidates: candidates.facts, active: live }, kill, today);
  return {
    today,
    active: live.length,
    candidates: candidates.facts.length,
    staleCandidates: health.staleCandidates,
    maxAgeDays: kill["max-age-days"],
    reverifyDays,
    drifted,
    propagated,
    overdue,
    expiredWaivers,
    parseErrors: [...active.errors, ...candidates.errors],
    loop: health.loop,
    promotionRate: health.promotionRate,
    kill,
  };
}

export function main(argv = process.argv.slice(2)) {
  const { opts } = parseArgs(argv);
  const r = driftReport(findRepoRoot());
  if (opts.json) {
    process.stdout.write(JSON.stringify(r, null, 2) + "\n");
  } else {
    console.log(`[drift] ${r.active} active, ${r.candidates} candidate (${r.staleCandidates} older than ${r.maxAgeDays}d); promotion rate ${r.promotionRate === null ? "n/a" : (r.promotionRate * 100).toFixed(0) + "%"}; loop: ${r.loop}`);
    for (const d of r.drifted) console.log(`[drift] DRIFTED ${d.id} — ${d.reason} (verified ${d.verifiedAt ?? "never"}) ${d.file}`);
    for (const p of r.propagated) console.log(`[drift] PROPAGATED ${p.id} — depends on drifted ${p.via}`);
    for (const o of r.overdue) console.log(`[drift] OVERDUE ${o.id} — verified ${o.verifiedAt ?? "never"} (> ${r.reverifyDays}d) ${o.file}`);
    for (const w of r.expiredWaivers) console.log(`[drift] EXPIRED WAIVER ${w.file} (${w.metric}, ${w.expires})`);
    for (const e of r.parseErrors) console.log(`[drift] UNPARSEABLE ${e.file}: ${e.errors.join("; ")}`);
    if (!r.drifted.length && !r.propagated.length && !r.overdue.length && !r.expiredWaivers.length && !r.parseErrors.length) console.log("[drift] nothing flagged (facts without applies-to are not watched — say so when you cite them)");
  }
  const flagged = r.drifted.length + r.propagated.length + r.overdue.length + r.expiredWaivers.length + r.parseErrors.length;
  process.exit(opts.strict && flagged ? 1 : 0);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
