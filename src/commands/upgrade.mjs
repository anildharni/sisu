// `sisu upgrade` — regenerate the owned set from the current generator.
// Refuses while any owned path is dirty vs the manifest (names each file, points
// at overrides/). Stops when the project schema is older than the generator.
// Flags stale overrides (base changed, orphaned). Manifest written last.
import { readManifest, verifyOwned, loadInputs, writeGraph, GENERATOR_VERSION } from "../manifest.mjs";
import { resolve } from "../resolve.mjs";
import { PROJECT_SCHEMA } from "../intent.mjs";

/**
 * @param {string} repoRoot @param {{ force?: boolean }} o @param {{ log?: (s: string) => void }} [io]
 */
export function upgrade(repoRoot, o, io = {}) {
  const log = io.log ?? ((s) => console.log(s));
  const previous = readManifest(repoRoot);
  if (!previous) throw new Error("no sisu.lock.json — run `sisu init` (or `sisu emit`) first");
  const inputs = loadInputs(repoRoot); // readIntent throws with a migration path when the schema is older
  if (inputs.intent.schema < PROJECT_SCHEMA) throw new Error(`project schema ${inputs.intent.schema} < ${PROJECT_SCHEMA}: migration required (see harness/README.md MIGRATION)`);
  const dirty = verifyOwned(repoRoot, previous).filter((r) => r.state !== "ok");
  if (dirty.length && !o.force) {
    const lines = dirty.map((r) => `  ${r.state.padEnd(9)} ${r.path} — ${r.detail}`);
    throw new Error(`refusing to upgrade: ${dirty.length} owned path(s) differ from the manifest. Move intentional changes into overrides/ (whole-file replacements of canonical sources), then re-run.\n${lines.join("\n")}`);
  }
  const graph = resolve(inputs);
  const stale = Object.entries(graph.manifest.overrides).filter(([, st]) => st.state !== "current");
  for (const [p, st] of stale) {
    log(`STALE OVERRIDE (${st.state}): ${p}${st.state === "stale-base" ? ` — canonical base changed (now ${st.canonicalHash}); re-review your override against the new canonical, then update based-on-canonical-hash` : st.state === "stale-orphan" ? " — canonical source no longer exists; the override is not applied" : " — add based-on-canonical-hash to its frontmatter"}`);
  }
  const result = writeGraph(repoRoot, graph, { previous, writeScaffold: true });
  log(`upgraded ${previous.generator} → ${GENERATOR_VERSION}: ${result.written.length} owned files written, ${result.removed.length} removed, ${result.scaffolded.length} scaffolded, ${result.conflicts.length} conflicts, ${stale.length} stale override(s)`);
  for (const c of result.conflicts) log(`  CONFLICT ${c.path}: ${c.reason}`);
  return { graph, result, stale };
}
