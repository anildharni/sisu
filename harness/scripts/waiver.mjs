#!/usr/bin/env node
// Scaffold a time-limited waiver for ONE debt-ceiling metric. The MECHANICS are
// frictionless (identity and expiry prefilled); the DELIBERATION is not — the
// file lands in a gated path and needs owner review, and under a same-principal
// topology the approver is labelled self-attested, which the ratchet prints.
//
// Usage: node harness/scripts/waiver.mjs <metric-id> --raise-to <n> --reason "<why>" [--approver @handle] [--days 30]
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { findRepoRoot, readBaselines, readIntent, parseArgs, writeText, todayIso, WAIVERS_DIR } from "./common.mjs";
import { stringify } from "../lib/yaml.mjs";

export function main(argv = process.argv.slice(2)) {
  const { opts, positional } = parseArgs(argv);
  const id = positional[0];
  if (!id) throw new Error("usage: waiver.mjs <metric-id> --raise-to <n> --reason <why> [--approver @handle] [--days 30]");
  const root = findRepoRoot();
  const baselines = readBaselines(root);
  const m = baselines?.metrics?.[id];
  if (!m) throw new Error(`unknown metric ${id} (see project/quality-baselines.json)`);
  if (m.direction !== "ceiling") throw new Error(`waivers apply to debt ceilings only; ${id} is a ${m.direction}. Lowering a floor is a Tier-1 baseline edit, not a waiver.`);
  const raiseTo = Number(opts["raise-to"]);
  if (!Number.isFinite(raiseTo) || raiseTo <= Number(m.baseline)) throw new Error(`--raise-to must be a number above the baseline ${m.baseline}`);
  const reason = typeof opts.reason === "string" ? opts.reason : null;
  if (!reason || reason.length < 10) throw new Error("--reason is required (>= 10 chars) — approval is the point");
  const days = Number(opts.days ?? 30);
  if (!Number.isFinite(days) || days < 1 || days > 90) throw new Error("--days must be 1..90 (no auto-renew; re-approve explicitly)");
  const intent = /** @type {any} */ (readIntent(root));
  const same = intent?.topology?.["same-principal"];
  const approver = typeof opts.approver === "string" ? opts.approver : intent?.policy?.approver ?? "unknown";
  const evidence = same === false && approver !== "unknown" ? "human" : "self-attested";
  const created = todayIso();
  const expires = new Date(Date.parse(created) + days * 86400000).toISOString().slice(0, 10);
  const doc = {
    kind: "waiver",
    metric: id,
    "raise-to": raiseTo,
    reason,
    approver: { value: approver, "evidence-level": evidence },
    created,
    expires,
    "identity-hash": m["identity-hash"],
    note: "Expired waivers are a hard fail. This file lives in a gated path: owner review is required to merge it.",
  };
  const file = `${WAIVERS_DIR}/${id.replace(/[^a-z0-9.-]/gi, "-")}-${created}.yaml`;
  writeText(join(root, ...file.split("/")), stringify(doc));
  console.log(`[waiver] wrote ${file} (approver evidence: ${evidence}; expires ${expires})`);
  if (evidence === "self-attested") console.log("[waiver] NOTE: same-principal or unknown topology — this approval is self-attested and the ratchet will say so.");
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    main();
  } catch (e) {
    console.error(`[waiver] ${e.message}`);
    process.exit(1);
  }
}
