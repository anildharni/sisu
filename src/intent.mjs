// The intent file (sisu.yaml): schema, defaults, read/write. Hand-editable, so
// it NEVER carries checksums (those live only in the manifest). Key order on
// write is fixed so diffs stay readable.
import { join } from "node:path";
import { parseMapping, stringify } from "../assets/lib/yaml.mjs";
import { readText, writeText, exists } from "./lib/fsx.mjs";
import { PACK_IDS } from "./packs.mjs";
import { TARGET_NAMES } from "./targets.mjs";
import { STRICT_PREDICATES } from "./canonical.mjs";

export const INTENT_FILE = "sisu.yaml";
export const PROJECT_SCHEMA = 1;
export const PROFILES = ["solo", "lead-team", "enterprise"];
export const RELEASE_MODELS = ["trunk", "integration-branch", "release-branches"];

export class IntentError extends Error {
  constructor(message) {
    super(`${INTENT_FILE}: ${message}`);
    this.name = "IntentError";
  }
}

/**
 * @typedef {{ value: unknown, evidence: "detected" | "unknown", at: string, "inputs-digest": string, inputs: string[], "override-reason"?: string }} Finding
 * @typedef {{
 *   schema: number,
 *   product: { name: string, summary: string },
 *   profile: string,
 *   targets: string[],
 *   packs: string[],
 *   release: { model: string, "default-branch": string, "integration-branch": string | null },
 *   policy: {
 *     "tier1-paths": string[],
 *     approver: string | null,
 *     floors: { "strict-predicates": string[] },
 *     knowledge: { "reverify-days": number, "loop-dead": { "min-candidates": number, "max-age-days": number, "min-promotion-rate": number, "window-days": number }, "eager-budget-bytes": number },
 *   },
 *   topology: { "agent-principal": string, "approver-principal": string, "agent-repo-role": string, "same-principal": boolean | "unknown" },
 *   "custom-oracles"?: any[],
 *   "test-convention"?: string[],
 *   detected: Record<string, Finding>,
 * }} Intent
 */

/** @returns {Intent["policy"]} */
export function defaultPolicy() {
  return {
    "tier1-paths": /** @type {string[]} */ ([]),
    approver: /** @type {string | null} */ (null),
    floors: { "strict-predicates": ["remote-wall", "no-conflicts"] },
    knowledge: {
      "reverify-days": 90,
      "loop-dead": { "min-candidates": 20, "max-age-days": 30, "min-promotion-rate": 0.05, "window-days": 60 },
      "eager-budget-bytes": 24576,
    },
  };
}

/**
 * Validate and normalize an intent object. Throws IntentError.
 * @param {Record<string, unknown>} raw
 * @returns {Intent}
 */
export function validateIntent(raw) {
  const fail = (m) => {
    throw new IntentError(m);
  };
  if (raw.schema !== PROJECT_SCHEMA) {
    if (typeof raw.schema === "number" && raw.schema < PROJECT_SCHEMA) fail(`project schema ${raw.schema} is older than this generator's ${PROJECT_SCHEMA}; see MIGRATION in harness/README.md`);
    fail(`schema must be ${PROJECT_SCHEMA}`);
  }
  const product = /** @type {any} */ (raw.product);
  if (!product || typeof product.name !== "string" || product.name.trim() === "") fail("product.name is required");
  if (typeof product.summary !== "string" || product.summary.trim().length < 20) fail("product.summary must be one paragraph (>= 20 chars)");
  if (!PROFILES.includes(/** @type {string} */ (raw.profile))) fail(`profile must be one of ${PROFILES.join("|")}`);
  const targets = /** @type {string[]} */ (raw.targets);
  if (!Array.isArray(targets) || targets.length === 0 || !targets.every((t) => TARGET_NAMES.includes(t))) fail(`targets must be a non-empty subset of ${TARGET_NAMES.join(", ")}`);
  const packs = /** @type {string[]} */ (raw.packs);
  if (!Array.isArray(packs) || !packs.every((p) => PACK_IDS.includes(p))) fail(`packs must be a subset of ${PACK_IDS.join(", ")}`);
  const release = /** @type {any} */ (raw.release ?? {});
  if (!RELEASE_MODELS.includes(release.model)) fail(`release.model must be one of ${RELEASE_MODELS.join("|")}`);
  if (typeof release["default-branch"] !== "string") fail("release.default-branch is required");
  const policyIn = /** @type {any} */ (raw.policy ?? {});
  const policy = { ...defaultPolicy(), ...policyIn, floors: { ...defaultPolicy().floors, ...(policyIn.floors ?? {}) }, knowledge: { ...defaultPolicy().knowledge, ...(policyIn.knowledge ?? {}), "loop-dead": { ...defaultPolicy().knowledge["loop-dead"], ...(policyIn.knowledge?.["loop-dead"] ?? {}) } } };
  if (!Array.isArray(policy["tier1-paths"]) || !policy["tier1-paths"].every((p) => typeof p === "string")) fail("policy.tier1-paths must be a string list");
  if (policy.approver !== null && (typeof policy.approver !== "string" || !/^@[A-Za-z0-9-]+$/.test(policy.approver))) fail("policy.approver must be null or a host username like @handle");
  if (!Array.isArray(policy.floors["strict-predicates"]) || !policy.floors["strict-predicates"].every((p) => STRICT_PREDICATES.includes(p))) fail(`policy.floors.strict-predicates must be a subset of ${STRICT_PREDICATES.join(", ")}`);
  const topoIn = /** @type {any} */ (raw.topology ?? {});
  const topology = {
    "agent-principal": topoIn["agent-principal"] ?? "unknown",
    "approver-principal": topoIn["approver-principal"] ?? "unknown",
    "agent-repo-role": topoIn["agent-repo-role"] ?? "unknown",
    "same-principal": topoIn["same-principal"] ?? "unknown",
  };
  if (!["write", "maintain", "admin", "unknown"].includes(topology["agent-repo-role"])) fail("topology.agent-repo-role must be write|maintain|admin|unknown");
  if (![true, false, "unknown"].includes(topology["same-principal"])) fail("topology.same-principal must be true|false|unknown");
  const detected = /** @type {Record<string, Finding>} */ (raw.detected ?? {});
  for (const [k, f] of Object.entries(detected)) {
    if (!f || typeof f !== "object") fail(`detected.${k} must be a mapping`);
    if (!["detected", "unknown"].includes(f.evidence)) fail(`detected.${k}.evidence must be detected|unknown`);
    if (typeof f.at !== "string") fail(`detected.${k}.at is required`);
    if (typeof f["inputs-digest"] !== "string") fail(`detected.${k}.inputs-digest is required`);
  }
  return {
    schema: PROJECT_SCHEMA,
    product: { name: product.name.trim(), summary: product.summary.trim() },
    profile: /** @type {string} */ (raw.profile),
    targets,
    packs,
    release: { model: release.model, "default-branch": release["default-branch"], "integration-branch": release["integration-branch"] ?? null },
    policy,
    topology,
    ...(raw["custom-oracles"] ? { "custom-oracles": /** @type {any[]} */ (raw["custom-oracles"]) } : {}),
    ...(raw["test-convention"] ? { "test-convention": /** @type {string[]} */ (raw["test-convention"]) } : {}),
    detected,
  };
}

/** @param {string} repoRoot @returns {Intent} */
export function readIntent(repoRoot) {
  const p = join(repoRoot, INTENT_FILE);
  if (!exists(p)) throw new IntentError("not found — run `sisu init` first");
  return validateIntent(parseMapping(readText(p)));
}

/** Serialize with the documented key order. */
export function serializeIntent(intent) {
  const ordered = {
    schema: intent.schema,
    product: intent.product,
    profile: intent.profile,
    targets: intent.targets,
    packs: intent.packs,
    release: intent.release,
    policy: intent.policy,
    topology: intent.topology,
    ...(intent["custom-oracles"] ? { "custom-oracles": intent["custom-oracles"] } : {}),
    ...(intent["test-convention"] ? { "test-convention": intent["test-convention"] } : {}),
    detected: intent.detected,
  };
  const header = [
    "# sisu intent file — hand-editable. Everything under `detected:` is machine-written",
    "# with provenance; edit a detected value only with an `override-reason`, or `doctor`",
    "# reports it as an unaudited policy change. Checksums never live here (see sisu.lock.json).",
    "",
  ].join("\n");
  return header + stringify(ordered);
}

/** @param {string} repoRoot @param {Intent} intent */
export function writeIntent(repoRoot, intent) {
  writeText(join(repoRoot, INTENT_FILE), serializeIntent(validateIntent(/** @type {any} */ (intent))));
}
