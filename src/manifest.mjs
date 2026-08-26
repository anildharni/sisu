// Manifest (sisu.lock.json) + the owned write set: load inputs for the resolver,
// write the artifact graph to disk with the shared-file rule, verify checksums,
// and ALWAYS write the manifest last so an interrupted run is detectable.
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, existsSync, unlinkSync, statSync } from "node:fs";
import { listFiles, readText, writeText, toPosix, safeJoin, isSymlink, stableJson, exists } from "./lib/fsx.mjs";
import { textHash, contentChecksum } from "../assets/lib/hash.mjs";
import { readIntent } from "./intent.mjs";
import { MANIFEST_FILE } from "./resolve.mjs";

export const GENERATOR_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const GENERATOR_VERSION = JSON.parse(readFileSync(join(GENERATOR_ROOT, "package.json"), "utf8")).version;

const ASSET_DIRS = [
  { dir: "lib", mode: "0644" },
  { dir: "scripts", mode: "0755" },
  { dir: "agent-hooks", mode: "0755" },
  { dir: "tests", mode: "0644" },
];

/** Load the verbatim emitted assets (vendored runtime, scripts, hooks, tests). */
export function loadAssets(generatorRoot = GENERATOR_ROOT) {
  /** @type {Record<string, { text: string, mode: "0644" | "0755" }>} */
  const out = {};
  for (const { dir, mode } of ASSET_DIRS) {
    const base = join(generatorRoot, "assets", dir);
    for (const rel of listFiles(base)) {
      if (!rel.endsWith(".mjs")) continue;
      out[`${dir}/${rel}`] = { text: readText(join(base, ...rel.split("/"))), mode: /** @type {"0644" | "0755"} */ (mode) };
    }
  }
  return out;
}

/** Canonical files as posix path → text. */
export function loadCanonicalFiles(generatorRoot = GENERATOR_ROOT) {
  /** @type {Record<string, string>} */
  const files = {};
  const dir = join(generatorRoot, "canonical");
  for (const rel of listFiles(dir)) {
    if (!rel.endsWith(".md") || rel.startsWith("schema/")) continue;
    files[`canonical/${rel}`] = readText(join(dir, ...rel.split("/")));
  }
  return files;
}

/** overrides/<kind>/<id>.md → text, keyed by `<kind>/<id>.md`. Refuses symlinks and traversal. */
export function loadOverrides(repoRoot) {
  /** @type {Record<string, string>} */
  const out = {};
  const dir = join(repoRoot, "overrides");
  for (const rel of listFiles(dir)) {
    if (!rel.endsWith(".md") || rel === "README.md") continue;
    // Same id grammar as the canonical tree: no leading dots, no traversal, no odd characters.
    if (!/^(mechanisms|rules)\/[a-z][a-z0-9-]*(\.[a-z0-9-]+)+\.md$/.test(rel) && !/^roles\/[a-z][a-z0-9-]*\.md$/.test(rel)) throw new Error(`overrides/${rel}: must be <mechanisms|rules|roles>/<id>.md with a canonical id`);
    const full = safeJoin(dir, rel);
    if (isSymlink(full)) throw new Error(`overrides/${rel}: symlinks are refused`);
    out[rel] = readText(full);
  }
  return out;
}

/** project/roles/<name>.md → text (user-owned role sources). */
export function loadProjectRoles(repoRoot) {
  /** @type {Record<string, string>} */
  const out = {};
  const dir = join(repoRoot, "project", "roles");
  for (const rel of listFiles(dir)) {
    if (!rel.endsWith(".md") || rel.includes("/")) continue;
    out[rel.replace(/\.md$/, "")] = readText(join(dir, rel));
  }
  return out;
}

/** Everything the pure resolver needs, read from disk once. `intent` may be supplied (init, before the file exists). */
export function loadInputs(repoRoot, generatorRoot = GENERATOR_ROOT, opts = {}) {
  return {
    canonicalFiles: loadCanonicalFiles(generatorRoot),
    overrides: loadOverrides(repoRoot),
    intent: opts.intent ?? readIntent(repoRoot),
    projectRoles: loadProjectRoles(repoRoot),
    assets: loadAssets(generatorRoot),
    generatorVersion: GENERATOR_VERSION,
  };
}

export function readManifest(repoRoot) {
  const p = join(repoRoot, MANIFEST_FILE);
  if (!existsSync(p)) return null;
  const m = JSON.parse(readText(p));
  if (m.schema !== "sisu.lock/1") throw new Error(`${MANIFEST_FILE}: unknown schema ${m.schema}`);
  return m;
}

/**
 * Verify owned paths against the manifest.
 * @returns {Array<{ path: string, state: "ok" | "modified" | "missing" | "symlink" | "mode", detail: string }>}
 */
export function verifyOwned(repoRoot, manifest) {
  /** @type {Array<{ path: string, state: "ok" | "modified" | "missing" | "symlink" | "mode", detail: string }>} */
  const rows = [];
  for (const [p, checksum] of Object.entries(manifest.owned ?? {})) {
    const full = join(repoRoot, ...p.split("/"));
    if (!existsSync(full)) {
      rows.push({ path: p, state: "missing", detail: "owned file missing — re-emit" });
      continue;
    }
    if (isSymlink(full)) {
      rows.push({ path: p, state: "symlink", detail: "symlink in the owned set is refused" });
      continue;
    }
    const [shaPart, modePart] = String(checksum).split(";");
    const actual = "sha256:" + textHash(readFileSync(full, "utf8"));
    if (actual !== shaPart) {
      rows.push({ path: p, state: "modified", detail: "content differs from the manifest — build output was edited; move the change into overrides/" });
      continue;
    }
    if (process.platform !== "win32" && modePart === "mode:0755" && !(statSync(full).mode & 0o100)) {
      rows.push({ path: p, state: "mode", detail: "lost its executable bit (functionally changed)" });
      continue;
    }
    rows.push({ path: p, state: "ok", detail: "" });
  }
  return rows;
}

/**
 * Write the artifact graph. Shared-file rule: an owned path that already exists
 * on disk and is NOT in the previous manifest is a CONFLICT — never overwritten,
 * never merged. Scaffold files are written only where absent. The manifest is
 * written LAST. Owned paths from the previous manifest that the new graph no
 * longer emits are removed (they were build output).
 * @param {string} repoRoot
 * @param {ReturnType<import("./resolve.mjs").resolve>} graph
 * @param {{ previous?: any, writeScaffold?: boolean, dryRun?: boolean }} [opts]
 */
export function writeGraph(repoRoot, graph, opts = {}) {
  const previous = opts.previous ?? null;
  const prevOwned = new Set(Object.keys(previous?.owned ?? {}));
  const written = [];
  const conflicts = [];
  const removed = [];
  const scaffolded = [];
  for (const a of graph.artifacts) {
    const full = safeJoin(repoRoot, a.path);
    if (isSymlink(full)) {
      conflicts.push({ path: a.path, reason: "existing symlink at an owned path (refused)" });
      continue;
    }
    if (existsSync(full) && !prevOwned.has(a.path)) {
      const current = readText(full);
      if (current !== a.content) {
        conflicts.push({ path: a.path, reason: "pre-existing file not owned by sisu — never merged; move its content into overrides/ or project/ and re-emit" });
        continue;
      }
    }
    if (!opts.dryRun) writeText(full, a.content, { mode: a.mode });
    written.push(a.path);
  }
  if (opts.writeScaffold) {
    for (const s of graph.scaffold) {
      const full = safeJoin(repoRoot, s.path);
      if (existsSync(full)) continue;
      if (!opts.dryRun) writeText(full, s.content, { mode: s.mode });
      scaffolded.push(s.path);
    }
  }
  const nowOwned = new Set(written);
  for (const p of prevOwned) {
    if (!nowOwned.has(p) && !conflicts.some((c) => c.path === p)) {
      const full = join(repoRoot, ...p.split("/"));
      if (existsSync(full)) {
        if (!opts.dryRun) unlinkSync(full);
        removed.push(p);
      }
    }
  }
  const manifest = { ...graph.manifest, owned: Object.fromEntries(Object.entries(graph.manifest.owned).filter(([p]) => nowOwned.has(p))), conflicts: Object.fromEntries(conflicts.map((c) => [c.path, c.reason])) };
  if (!opts.dryRun) writeText(join(repoRoot, MANIFEST_FILE), stableJson(manifest)); // LAST
  return { written, conflicts, removed, scaffolded, manifest };
}

/** Write artifacts to an arbitrary directory (byte-reproducibility, --compare). No manifest logic. */
export function writeGraphTo(outDir, graph) {
  for (const a of graph.artifacts) writeText(safeJoin(outDir, a.path), a.content, { mode: a.mode });
  writeText(join(outDir, MANIFEST_FILE), stableJson({ ...graph.manifest, conflicts: {} }));
}
