#!/usr/bin/env node
// Quality ratchets — stack-agnostic. Reads project/quality-baselines.json:
//
//   { "schema": "sisu.baselines/1",
//     "metrics": { "<oracle-id>": {
//        "direction": "ceiling" | "floor",
//        "baseline": <number> | "unmeasured",
//        "identity": { "argv": [...], "cwd": ".", "config-files": [...], "scope": [...], "lockfile": "..."|null },
//        "identity-hash": "sha256:...;partial",
//        "parser": "<parser id>", "parser-args": {...},
//        "measured-at": "<commit sha>" } } }
//
// Rules (SPEC Component 2):
//  - ceilings only fall; floors only rise; a floor of 0 or an "unmeasured" baseline FAILS
//  - the measurement identity (argv, cwd, scope, config files, lockfile) is hashed; if it
//    changed and the stored hash did not, FAIL — re-baseline explicitly with --rebaseline,
//    which rewrites hash AND number together in this gated file, loudly
//  - a parser that gets empty/unparseable output FAILS (never a silent zero)
//  - the only legal loosening of a ceiling is an unexpired waiver in project/waivers/;
//    an EXPIRED waiver is a hard fail, never a silent revert
// Identity hashes are PARTIAL (declared inputs only) and are printed as such.
//
// Usage: node harness/scripts/ratchet.mjs [metric-id ...] [--rebaseline <id>] [--json]
import { join } from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { findRepoRoot, readBaselines, writeBaselines, run, gitHead, parseArgs, readText, WAIVERS_DIR, readIntent } from "./common.mjs";
import { identityHash, expandConfig } from "../lib/identity.mjs";
import { parseCount, MeasureError } from "../lib/measure.mjs";
import { parseMapping } from "../lib/yaml.mjs";

/** @param {string} root @returns {any[]} */
export function loadWaivers(root) {
  const dir = join(root, ...WAIVERS_DIR.split("/"));
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
    .sort()
    .map((f) => {
      const w = parseMapping(readText(join(dir, f)));
      return { file: `${WAIVERS_DIR}/${f}`, ...w };
    });
}

/** @param {string} root @param {string} id @param {any} m */
export function measure(root, id, m) {
  if (m.parser === "file-count") {
    const dir = m["parser-args"]?.dir;
    const suffix = m["parser-args"]?.suffix ?? "";
    if (typeof dir !== "string") throw new MeasureError(`${id}: file-count needs parser-args.dir`);
    const full = join(root, ...dir.split("/"));
    if (!existsSync(full)) throw new MeasureError(`${id}: subject directory ${dir} not found — refusing to report a pass over zero`);
    return readdirSync(full).filter((f) => f.endsWith(suffix)).length;
  }
  const cwd = join(root, ...(m.identity.cwd ?? ".").split("/"));
  const res = run(m.identity.argv, { cwd });
  if (res.error && res.stdout === "" && res.stderr === "") throw new MeasureError(`${id}: could not run ${m.identity.argv.join(" ")}: ${res.error}`);
  return parseCount({ parser: m.parser, parserArgs: m["parser-args"] }, res);
}

/**
 * Evaluate every metric. Returns rows; never exits (the CLI wrapper does).
 * @param {string} root @param {{ only?: string[], rebaseline?: string | null, today?: string }} [opts]
 */
export function evaluate(root, opts = {}) {
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const file = readBaselines(root);
  if (!file || file.schema !== "sisu.baselines/1" || typeof file.metrics !== "object") {
    return { rows: [{ id: "*", status: "FAIL", message: "project/quality-baselines.json missing or not schema sisu.baselines/1 — the gate cannot be checked" }], file };
  }
  const waivers = loadWaivers(root);
  const rows = [];
  const ids = Object.keys(file.metrics)
    .sort()
    .filter((id) => !opts.only?.length || opts.only.includes(id));
  for (const id of ids) {
    const m = file.metrics[id];
    /** @type {{ id: string, direction: string, baseline: any, measured: number | null, effective: number | null, status: string, message: string, identity: string, waiver: string | null }} */
    const row = { id, direction: m.direction, baseline: m.baseline, measured: null, effective: null, status: "OK", message: "", identity: "unchanged", waiver: null };
    try {
      if (!["ceiling", "floor"].includes(m.direction)) throw new MeasureError(`direction must be ceiling|floor`);
      const idh = identityHash(root, m.identity);
      if (opts.rebaseline === id) {
        const measured = measure(root, id, m);
        const old = { baseline: m.baseline, hash: m["identity-hash"] };
        m.baseline = measured;
        m["identity-hash"] = idh.hash;
        m["measured-at"] = gitHead(root);
        file.metrics[id] = m;
        writeBaselines(root, file);
        row.measured = measured;
        row.status = "REBASELINED";
        row.message = `baseline ${old.baseline} → ${measured}; identity ${String(old.hash).slice(0, 23)}… → ${idh.hash.slice(0, 23)}… (this edit is in a gated file; it needs owner review)`;
        rows.push(row);
        continue;
      }
      if (m["identity-hash"] !== idh.hash) {
        row.identity = "CHANGED";
        row.status = "FAIL";
        row.message = `measurement identity changed (argv/cwd/scope/config/lockfile) but the stored hash did not. Stored ${String(m["identity-hash"]).slice(0, 23)}…, computed ${idh.hash.slice(0, 23)}… [partial]. Re-baseline explicitly: node harness/scripts/ratchet.mjs --rebaseline ${id}`;
        rows.push(row);
        continue;
      }
      if (m.baseline === "unmeasured") throw new MeasureError(`baseline is "unmeasured" — initialize with --rebaseline ${id} (a floor must come from a real measurement or an explicit non-vacuous minimum)`);
      if (typeof m.baseline !== "number" || !Number.isFinite(m.baseline)) throw new MeasureError(`baseline must be a number`);
      if (m.direction === "floor" && m.baseline <= 0) throw new MeasureError(`a floor of ${m.baseline} asserts nothing — set a real minimum`);
      const measured = measure(root, id, m);
      row.measured = measured;
      let effective = m.baseline;
      // waivers (ceilings only)
      const active = waivers.filter((w) => w.metric === id);
      for (const w of active) {
        if (typeof w.expires !== "string") throw new MeasureError(`waiver ${w.file} has no expires date`);
        if (w.expires < today) {
          row.status = "FAIL";
          row.message = `waiver ${w.file} EXPIRED on ${w.expires} — expired waivers are a hard fail, never a silent revert; remove it or fix the debt`;
          row.waiver = w.file;
        }
      }
      if (row.status === "FAIL") {
        rows.push(row);
        continue;
      }
      if (m.direction === "ceiling") {
        for (const w of active) {
          if (typeof w["raise-to"] === "number" && w["raise-to"] > effective) {
            effective = w["raise-to"];
            row.waiver = `${w.file} (to ${w["raise-to"]}, expires ${w.expires}, approver evidence: ${w.approver?.["evidence-level"] ?? "unknown"})`;
          }
        }
        row.effective = effective;
        if (measured > effective) {
          row.status = "FAIL";
          row.message = `${measured - effective} above the ${effective === m.baseline ? "baseline" : "waived ceiling"}. Fix the real errors; never add suppressions (Tier 0). A time-limited waiver is the only legal loosening: node harness/scripts/waiver.mjs ${id} --raise-to ${measured}`;
        } else if (measured < m.baseline) {
          row.status = "LOCK-IT-IN";
          row.message = `debt reduced — lower "${id}" to ${measured} in project/quality-baselines.json in this PR (headroom is a silent regression budget)`;
        }
      } else {
        row.effective = m.baseline;
        if (measured < m.baseline) {
          row.status = "FAIL";
          row.message = `coverage dropped below the floor ${m.baseline}. If intentional this is a Tier-1 change: say so, get owner approval, lower the baseline in the same PR.`;
        } else if (measured > m.baseline) {
          row.status = "LOCK-IT-IN";
          row.message = `coverage grew — RAISE "${id}" to ${measured} in project/quality-baselines.json in this PR`;
        }
      }
    } catch (e) {
      row.status = "FAIL";
      row.message = e instanceof MeasureError ? e.message : `unexpected error: ${e.message}`;
    }
    rows.push(row);
  }
  return { rows, file };
}

export function main(argv = process.argv.slice(2)) {
  const { opts, positional } = parseArgs(argv);
  const root = findRepoRoot();
  const rows = /** @type {any[]} */ (evaluate(root, { only: positional, rebaseline: typeof opts.rebaseline === "string" ? opts.rebaseline : null }).rows);
  if (opts.json) {
    process.stdout.write(JSON.stringify({ schema: "sisu.ratchet/1", rows }, null, 2) + "\n");
  } else {
    for (const r of rows) {
      const head = r.measured === null ? `[ratchet] ${r.id}:` : `[ratchet] ${r.id}: measured ${r.measured} (baseline ${r.baseline}, ${r.direction}${r.effective !== null && r.effective !== r.baseline ? `, waived to ${r.effective}` : ""})`;
      const line = `${head} ${r.status}${r.message ? ` — ${r.message}` : ""}`;
      (r.status === "FAIL" ? console.error : console.log)(line);
    }
    if (!rows.length) console.log("[ratchet] no metrics declared (project/quality-baselines.json has an empty metrics map)");
  }
  process.exit(rows.some((r) => r.status === "FAIL") ? 1 : 0);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
