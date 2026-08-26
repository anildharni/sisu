// `sisu emit [--target <t>] [--out <dir>]` — resolve from committed inputs and
// write the owned set. `--target` adds a target to the intent (persisted) before
// emitting. `--out` renders into another directory with no manifest logic (for
// byte-reproducibility checks and --compare).
import { resolve } from "../resolve.mjs";
import { loadInputs, readManifest, writeGraph, writeGraphTo } from "../manifest.mjs";
import { writeIntent } from "../intent.mjs";
import { TARGET_NAMES } from "../targets.mjs";

/**
 * @param {string} repoRoot @param {{ target?: string, out?: string, scaffold?: boolean }} o @param {{ log?: (s: string) => void }} [io]
 */
export function emit(repoRoot, o, io = {}) {
  const log = io.log ?? ((s) => console.log(s));
  const inputs = loadInputs(repoRoot);
  if (o.target) {
    if (!TARGET_NAMES.includes(o.target)) throw new Error(`unknown target ${o.target}; known: ${TARGET_NAMES.join(", ")}`);
    if (!inputs.intent.targets.includes(o.target)) {
      inputs.intent.targets.push(o.target);
      writeIntent(repoRoot, inputs.intent);
      log(`added target ${o.target} to sisu.yaml`);
    }
  }
  const graph = resolve(inputs);
  if (o.out) {
    writeGraphTo(o.out, graph);
    log(`rendered ${graph.artifacts.length} artifacts into ${o.out}`);
    return { graph, result: null };
  }
  const previous = readManifest(repoRoot);
  const result = writeGraph(repoRoot, graph, { previous, writeScaffold: Boolean(o.scaffold) });
  log(`emitted ${result.written.length} owned files (${result.removed.length} removed, ${result.conflicts.length} conflicts)`);
  for (const c of result.conflicts) log(`  CONFLICT ${c.path}: ${c.reason}`);
  for (const [p, st] of Object.entries(graph.manifest.overrides)) if (st.state !== "current") log(`  OVERRIDE ${st.state}: ${p}`);
  return { graph, result };
}
