// `sisu compare <repo>` — doctor --compare: emit the CURRENT repo's graph into a
// temp dir, take a STRUCTURAL diff against another repository's harness, and join
// it against the extraction map BY MECHANISM ID. A reference artifact mapped
// `mechanism` with no canonical counterpart is a gap finding; `project` and
// `excluded` are not; anything unmapped is `unclassified` and never silently
// dropped. Read-only on the target repository.
import { join } from "node:path";
import { existsSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { parseMapping } from "../../assets/lib/yaml.mjs";
import { listFiles, readText } from "../lib/fsx.mjs";
import { loadInputs, GENERATOR_ROOT } from "../manifest.mjs";
import { resolve } from "../resolve.mjs";

/** Load extraction-map.yaml → entries. */
export function loadExtractionMap(generatorRoot = GENERATOR_ROOT) {
  const p = join(generatorRoot, "extraction-map.yaml");
  if (!existsSync(p)) throw new Error("extraction-map.yaml missing");
  const doc = /** @type {any} */ (parseMapping(readText(p)));
  const entries = /** @type {any[]} */ (Array.isArray(doc.entries) ? doc.entries : []);
  return { reference: /** @type {any} */ (doc.reference ?? {}), entries };
}

/**
 * @param {string} repoRoot current (sisu-managed) repo
 * @param {string} targetRoot repository to compare against (read-only)
 */
export function compare(repoRoot, targetRoot) {
  const inputs = loadInputs(repoRoot);
  const graph = resolve(inputs);
  const map = loadExtractionMap();
  const canonicalIds = new Set(graph.catalog.map((m) => m.id));
  const tmp = mkdtempSync(join(tmpdir(), "sisu-compare-"));
  try {
    // structural view of the target: which governance surfaces exist
    const targetFiles = new Set(listFiles(targetRoot, { ignore: (r) => /(^|\/)(node_modules|\.git|dist|build|coverage|\.venv)\//.test(r + "/") }));
    const surfaces = {
      rootConvention: [...targetFiles].filter((f) => /^(CLAUDE|AGENTS)\.md$/.test(f)),
      agentRoles: [...targetFiles].filter((f) => /^\.claude\/agents\/.+\.md$/.test(f)),
      agentHooks: [...targetFiles].filter((f) => /^\.claude\/hooks\/.+\.m?js$/.test(f)),
      gitHooks: [...targetFiles].filter((f) => /^\.githooks\//.test(f)),
      codeowners: [...targetFiles].filter((f) => /CODEOWNERS$/.test(f)),
      workflows: [...targetFiles].filter((f) => /^\.github\/workflows\/.+\.ya?ml$/.test(f)),
      baselines: [...targetFiles].filter((f) => /quality-baselines\.json$/.test(f)),
      ratchetScripts: [...targetFiles].filter((f) => /ratchet|floor/.test(f) && /\.m?js$/.test(f)),
      harnessTests: [...targetFiles].filter((f) => /tests?\/.*(claude|ci|workflow|hooks).*\.test\.m?js$/i.test(f)),
    };
    // join: every mapped entry by classification; mechanism ids must exist in canonical
    const gaps = [];
    const covered = [];
    const unclassified = [];
    const mapped = new Set(map.entries.map((e) => e["source-path"]));
    for (const e of map.entries) {
      if (e.classification === "mechanism" || e.classification === "hybrid") {
        const ids = Array.isArray(e["mechanism-ids"]) ? e["mechanism-ids"] : [];
        const missing = ids.filter((id) => !canonicalIds.has(id));
        if (!ids.length) gaps.push({ path: e["source-path"], reason: `${e.classification} with no mechanism-ids` });
        else if (missing.length) gaps.push({ path: e["source-path"], reason: `mechanism ids without canonical counterpart: ${missing.join(", ")}` });
        else covered.push({ path: e["source-path"], ids });
      }
    }
    for (const group of Object.values(surfaces)) for (const f of group) if (!mapped.has(f)) unclassified.push(f);
    const text = [
      `compare: ${repoRoot} (sisu graph, ${graph.catalog.length} mechanisms) vs ${targetRoot}`,
      `extraction map: ${map.entries.length} entries against reference ${map.reference?.sha ?? "?"}`,
      ``,
      `target governance surfaces:`,
      ...Object.entries(surfaces).map(([k, v]) => `  ${k.padEnd(16)} ${v.length}`),
      ``,
      `covered (reference mechanism → canonical id): ${covered.length}`,
      ...covered.map((c) => `  ${c.path} → ${c.ids.join(", ")}`),
      ``,
      `GAPS (mapped mechanism with no canonical counterpart): ${gaps.length}`,
      ...gaps.map((g) => `  ${g.path}: ${g.reason}`),
      ``,
      `UNCLASSIFIED (governance-shaped files in the target not in the extraction map — human review bounded to this bucket): ${unclassified.length}`,
      ...unclassified.map((u) => `  ${u}`),
    ].join("\n");
    return { text, surfaces, covered, gaps, unclassified };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
