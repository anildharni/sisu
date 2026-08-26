// Canonical tree loader + schema validator (SCHEMA.md is the written contract;
// this file is its executable twin). Pure: reads files, returns data, throws on
// any schema violation. No environment, no clock.
import { join } from "node:path";
import { splitFrontmatter } from "../assets/lib/frontmatter.mjs";
import { textHash } from "../assets/lib/hash.mjs";
import { listFiles, readText, toPosix } from "./lib/fsx.mjs";

export const EFFECTS = ["blocking", "preventive", "detective", "advisory", "none"];
export const PLANES = ["agent-runtime", "local-git", "ci", "repository", "organization"];
export const ACTORS = ["workspace-write", "repo-write", "repo-admin", "org-admin", "none"];
export const LIFECYCLES = ["experimental", "stable", "deprecated"];
export const FAIL_MODES = ["open", "closed", "n/a"];
export const CAPABILITIES = ["read-repo", "modify-code", "execute-oracles", "mutate-governance", "write-knowledge", "spawn-agents", "network"];
export const MODEL_TIERS = ["inherit", "fast", "strong"];
export const ROOT_SECTIONS = ["answer", "tiers", "oracle-integrity", "change-control", "session", "dispatch", "knowledge", "ledger", "evidence", "enforcement"];
export const STRICT_PREDICATES = ["remote-wall", "evidence-fresh", "self-verification-green", "topology-resolved", "no-conflicts"];
export const PROBES = [
  "none",
  "local.owned-checksums",
  "local.hooks-path",
  "local.detected-staleness",
  "local.index-budget",
  "local.waivers",
  "local.knowledge-health",
  "local.self-verification",
  "local.agent-hooks-wired",
  "local.ci-workflow-shape",
  "local.action-pins",
  "local.codeowners-static",
  "local.ratchet-file",
  "remote.branch-protection",
  "remote.required-checks-binding",
  "remote.codeowners-errors",
  "remote.agent-identity",
  "remote.ledger-pointers",
  "remote.workflow-protections",
  "manual.cold-load",
];
export const CATALOG_SCHEMA_VERSION = 1;

const ID_RE = /^[a-z][a-z0-9-]*(\.[a-z0-9-]+)+$/;
const NAME_RE = /^[a-z][a-z0-9-]*$/;

export class CanonicalError extends Error {
  /** @param {string} file @param {string} message */
  constructor(file, message) {
    super(`${file}: ${message}`);
    this.name = "CanonicalError";
    this.file = file;
  }
}

/**
 * @typedef {{ kind: "mechanism", id: string, title: string, lifecycle: string, effect: string, plane: string,
 *   bypassableBy: string, failMode: string, evidenceProbe: string, covers: string[], requires: Record<string, any>,
 *   strict: string[], renders: string[], extractedFrom: string[], body: string, source: string, hash: string }} Mechanism
 * @typedef {{ kind: "rule", id: string, title: string, section: string, order: number, targets: string[],
 *   enforcedBy: string[], body: string, source: string, hash: string }} Rule
 * @typedef {{ kind: "role", name: string, title: string, description: string, capabilities: string[], model: string,
 *   dispatch: string, scaffold: boolean, body: string, source: string, hash: string }} Role
 * @typedef {{ mechanisms: Mechanism[], rules: Rule[], roles: Role[], files: Record<string, string> }} Canonical
 */

/** @param {string} file @param {Record<string, unknown>} fm @param {string} key @param {(v: unknown) => boolean} pred @param {string} what */
function req(file, fm, key, pred, what) {
  if (!(key in fm)) throw new CanonicalError(file, `missing required key "${key}"`);
  if (!pred(fm[key])) throw new CanonicalError(file, `"${key}" must be ${what}, got ${JSON.stringify(fm[key])}`);
  return fm[key];
}

/** @param {string} file @param {Record<string, unknown>} fm @param {string} key @param {(v: unknown) => boolean} pred @param {string} what @param {unknown} dflt */
function opt(file, fm, key, pred, what, dflt) {
  if (!(key in fm) || fm[key] === null) return dflt;
  if (!pred(fm[key])) throw new CanonicalError(file, `"${key}" must be ${what}, got ${JSON.stringify(fm[key])}`);
  return fm[key];
}

const isStr = (v) => typeof v === "string" && v.length > 0;
const isStrArr = (v) => Array.isArray(v) && v.every((x) => typeof x === "string");
const oneOf = (set) => (v) => typeof v === "string" && set.includes(v);
const subsetOf = (set) => (v) => isStrArr(v) && v.every((x) => set.includes(x));

/** Validate a mechanism file. @param {string} file @param {string} text @returns {Mechanism} */
export function parseMechanism(file, text) {
  const { data, body } = splitFrontmatter(text);
  if (!data) throw new CanonicalError(file, "missing frontmatter");
  req(file, data, "kind", (v) => v === "mechanism", '"mechanism"');
  const id = /** @type {string} */ (req(file, data, "id", (v) => typeof v === "string" && ID_RE.test(v), "a dotted lowercase id"));
  const expectedFile = `${id}.md`;
  if (!file.endsWith("/" + expectedFile) && file !== expectedFile) throw new CanonicalError(file, `file name must be ${expectedFile}`);
  const requires = /** @type {Record<string, any>} */ (opt(file, data, "requires", (v) => v !== null && typeof v === "object" && !Array.isArray(v), "a mapping", {}));
  for (const k of Object.keys(requires)) {
    if (!["targets", "host", "ci", "topology", "packs"].includes(k)) throw new CanonicalError(file, `unknown requires key "${k}"`);
  }
  if (body.trim().length < 20) throw new CanonicalError(file, "body must explain the mechanism (>= 20 chars)");
  return {
    kind: "mechanism",
    id,
    title: /** @type {string} */ (req(file, data, "title", isStr, "a string")),
    lifecycle: /** @type {string} */ (req(file, data, "lifecycle", oneOf(LIFECYCLES), LIFECYCLES.join("|"))),
    effect: /** @type {string} */ (req(file, data, "effect", oneOf(EFFECTS), EFFECTS.join("|"))),
    plane: /** @type {string} */ (req(file, data, "plane", oneOf(PLANES), PLANES.join("|"))),
    bypassableBy: /** @type {string} */ (req(file, data, "bypassable-by", oneOf(ACTORS), ACTORS.join("|"))),
    failMode: /** @type {string} */ (req(file, data, "fail-mode", oneOf(FAIL_MODES), FAIL_MODES.join("|"))),
    evidenceProbe: /** @type {string} */ (req(file, data, "evidence-probe", oneOf(PROBES), "a known probe id")),
    covers: /** @type {string[]} */ (opt(file, data, "covers", isStrArr, "a string list", [])),
    requires,
    strict: /** @type {string[]} */ (opt(file, data, "strict", subsetOf(STRICT_PREDICATES), "known predicate names", [])),
    renders: /** @type {string[]} */ (opt(file, data, "renders", subsetOf(ROOT_SECTIONS), "root section names", [])),
    extractedFrom: /** @type {string[]} */ (opt(file, data, "extracted-from", isStrArr, "a string list", [])),
    body: body.trim() + "\n",
    source: file,
    hash: textHash(text),
  };
}

/** @param {string} file @param {string} text @returns {Rule} */
export function parseRule(file, text) {
  const { data, body } = splitFrontmatter(text);
  if (!data) throw new CanonicalError(file, "missing frontmatter");
  req(file, data, "kind", (v) => v === "rule", '"rule"');
  const id = /** @type {string} */ (req(file, data, "id", (v) => typeof v === "string" && ID_RE.test(v), "a dotted lowercase id"));
  if (!file.endsWith(`/${id}.md`)) throw new CanonicalError(file, `file name must be ${id}.md`);
  if (body.trim().length < 20) throw new CanonicalError(file, "body must carry the rule text");
  return {
    kind: "rule",
    id,
    title: /** @type {string} */ (req(file, data, "title", isStr, "a string")),
    section: /** @type {string} */ (req(file, data, "section", oneOf(ROOT_SECTIONS), ROOT_SECTIONS.join("|"))),
    order: /** @type {number} */ (req(file, data, "order", (v) => Number.isInteger(v), "an integer")),
    targets: /** @type {string[]} */ (opt(file, data, "targets", subsetOf(["claude-code", "agents-md"]), "target names", ["claude-code", "agents-md"])),
    enforcedBy: /** @type {string[]} */ (opt(file, data, "enforced-by", isStrArr, "mechanism ids", [])),
    body: body.trim() + "\n",
    source: file,
    hash: textHash(text),
  };
}

/** @param {string} file @param {string} text @returns {Role} */
export function parseRole(file, text) {
  const { data, body } = splitFrontmatter(text);
  if (!data) throw new CanonicalError(file, "missing frontmatter");
  req(file, data, "kind", (v) => v === "role", '"role"');
  const name = /** @type {string} */ (req(file, data, "name", (v) => typeof v === "string" && NAME_RE.test(v), "a lowercase-hyphen name"));
  if (!file.endsWith(`/${name}.md`)) throw new CanonicalError(file, `file name must be ${name}.md`);
  const description = /** @type {string} */ (req(file, data, "description", (v) => typeof v === "string" && v.length >= 20, "a string of >= 20 chars"));
  if (/\n/.test(description)) throw new CanonicalError(file, "description must be a single line");
  const scaffold = /** @type {boolean} */ (opt(file, data, "scaffold", (v) => typeof v === "boolean", "a boolean", false));
  if (!scaffold && body.trim().length < 40) throw new CanonicalError(file, "role body must carry instructions");
  return {
    kind: "role",
    name,
    title: /** @type {string} */ (req(file, data, "title", isStr, "a string")),
    description,
    capabilities: /** @type {string[]} */ (req(file, data, "capabilities", subsetOf(CAPABILITIES), "known capabilities")),
    model: /** @type {string} */ (req(file, data, "model", oneOf(MODEL_TIERS), MODEL_TIERS.join("|"))),
    dispatch: /** @type {string} */ (req(file, data, "dispatch", isStr, "a one-line dispatch phrase")),
    scaffold,
    body: body.trim() + "\n",
    source: file,
    hash: textHash(text),
  };
}

/**
 * Load and validate the canonical tree. `files` maps posix path → raw text so
 * the resolver can apply overrides on the same keys.
 * @param {string} root directory containing canonical/
 * @returns {Canonical}
 */
export function loadCanonical(root) {
  const dir = join(root, "canonical");
  /** @type {Record<string, string>} */
  const files = {};
  for (const rel of listFiles(dir)) {
    if (!rel.endsWith(".md") || rel.startsWith("schema/")) continue;
    files[`canonical/${rel}`] = readText(join(dir, ...rel.split("/")));
  }
  return parseCanonicalFiles(files);
}

/**
 * Validate an in-memory set of canonical files (after overrides are applied).
 * @param {Record<string, string>} files posix path (canonical/...) → text
 * @returns {Canonical}
 */
export function parseCanonicalFiles(files) {
  /** @type {Mechanism[]} */ const mechanisms = [];
  /** @type {Rule[]} */ const rules = [];
  /** @type {Role[]} */ const roles = [];
  for (const [file, text] of Object.entries(files).sort(([a], [b]) => (a < b ? -1 : 1))) {
    const p = toPosix(file);
    if (text.charCodeAt(0) === 0xfeff) throw new CanonicalError(p, "UTF-8 BOM is not allowed");
    if (p.startsWith("canonical/mechanisms/")) mechanisms.push(parseMechanism(p, text));
    else if (p.startsWith("canonical/rules/")) rules.push(parseRule(p, text));
    else if (p.startsWith("canonical/roles/")) roles.push(parseRole(p, text));
    else throw new CanonicalError(p, "unknown canonical directory");
  }
  const ids = new Set();
  for (const m of mechanisms) {
    if (ids.has(m.id)) throw new CanonicalError(m.source, `duplicate id ${m.id}`);
    ids.add(m.id);
  }
  for (const r of rules) {
    if (ids.has(r.id)) throw new CanonicalError(r.source, `duplicate id ${r.id}`);
    ids.add(r.id);
    for (const e of r.enforcedBy) {
      if (!mechanisms.some((m) => m.id === e)) throw new CanonicalError(r.source, `enforced-by references unknown mechanism ${e}`);
    }
  }
  const names = new Set();
  for (const r of roles) {
    if (names.has(r.name)) throw new CanonicalError(r.source, `duplicate role ${r.name}`);
    names.add(r.name);
  }
  // Hard rule from the spec: repo-managed hooks are never walls.
  for (const m of mechanisms) {
    if ((m.plane === "local-git" || m.plane === "agent-runtime") && (m.effect === "blocking" || m.bypassableBy !== "workspace-write")) {
      throw new CanonicalError(m.source, `plane ${m.plane} must be preventive/detective/advisory and bypassable-by workspace-write`);
    }
    if (m.strict.includes("remote-wall") && !(m.effect === "blocking" && ["ci", "repository", "organization"].includes(m.plane))) {
      throw new CanonicalError(m.source, "remote-wall predicate requires effect=blocking on a remote plane");
    }
  }
  return { mechanisms, rules, roles, files };
}
