#!/usr/bin/env node
// Rebuild project/knowledge/INDEX.md (one line per active fact; declared edges
// materialized). `--check` is the CI form: every active fact meets the promotion
// bar (schema, handle-or-human, authority lint), no declared contradiction
// between active facts, the index on disk is current, and the EAGER CONTEXT
// BUDGET holds: bytes(root convention file) + bytes(INDEX.md) <= policy budget
// for every target. Over budget FAILS LOUDLY — that is the dated trigger for
// anything smarter, and nothing smarter ships until it fires.
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { findRepoRoot, readIntent, readManifest, writeText, readText, parseArgs } from "./common.mjs";
import { loadTier, renderIndex, KNOWLEDGE_DIR } from "../lib/knowledge.mjs";

const ROOT_FILES = { "claude-code": "CLAUDE.md", "agents-md": "AGENTS.md" };

/** @param {string} root @returns {{ ok: boolean, problems: string[], index: string, budget: Array<{ target: string, bytes: number, budget: number }> }} */
export function check(root) {
  const problems = [];
  const active = loadTier(root, "active");
  const candidates = loadTier(root, "candidate");
  for (const e of active.errors) problems.push(`${e.file}: ${e.errors.join("; ")}`);
  for (const e of candidates.errors) problems.push(`${e.file}: ${e.errors.join("; ")}`);
  const ids = new Set(active.facts.map((f) => f.id));
  for (const f of active.facts) {
    for (const e of f.edges) {
      if (e.type === "contradicts" && ids.has(e.target)) problems.push(`${f.file}: active facts ${f.id} and ${e.target} declare a contradiction — one must supersede the other`);
      if (e.type === "depends-on" && !ids.has(e.target)) problems.push(`${f.file}: depends-on ${e.target} which is not active`);
    }
  }
  const index = renderIndex(active.facts);
  const indexPath = join(root, ...KNOWLEDGE_DIR.split("/"), "INDEX.md");
  const onDisk = existsSync(indexPath) ? readText(indexPath) : null;
  if (onDisk !== index) problems.push(`${KNOWLEDGE_DIR}/INDEX.md is stale — run: node harness/scripts/index.mjs`);
  const intent = /** @type {any} */ (readIntent(root));
  const manifest = readManifest(root);
  const budgetBytes = Number(intent?.policy?.knowledge?.["eager-budget-bytes"] ?? 24576);
  const budget = [];
  for (const target of Array.isArray(intent?.targets) ? intent.targets : []) {
    const rootFile = join(root, ROOT_FILES[target] ?? "CLAUDE.md");
    const rootBytes = existsSync(rootFile) ? Buffer.byteLength(readFileSync(rootFile, "utf8"), "utf8") : 0;
    const total = rootBytes + Buffer.byteLength(index, "utf8");
    // manifest = committed hard cap for the target; sisu.yaml policy may only tighten it (and applies before a re-emit)
    const limit = Math.min(Number(manifest?.targets?.[target]?.eagerBudgetBytes ?? budgetBytes), budgetBytes);
    budget.push({ target, bytes: total, budget: limit });
    if (total > limit) problems.push(`eager context budget exceeded for ${target}: ${total} > ${limit} bytes (root file ${rootBytes} + index). This is the dated trigger — report it; do not shard.`);
  }
  return { ok: problems.length === 0, problems, index, budget };
}

export function main(argv = process.argv.slice(2)) {
  const { opts } = parseArgs(argv);
  const root = findRepoRoot();
  if (opts.check) {
    const r = check(root);
    for (const b of r.budget) console.log(`[index] ${b.target}: eager set ${b.bytes} / ${b.budget} bytes`);
    for (const p of r.problems) console.error(`[index] FAIL ${p}`);
    if (r.ok) console.log(`[index] OK — ${loadTier(root, "active").facts.length} active facts meet the promotion bar; index current; budget holds`);
    process.exit(r.ok ? 0 : 1);
  }
  const active = loadTier(root, "active");
  for (const e of active.errors) console.error(`[index] WARN ${e.file}: ${e.errors.join("; ")}`);
  const index = renderIndex(active.facts);
  writeText(join(root, ...KNOWLEDGE_DIR.split("/"), "INDEX.md"), index);
  console.log(`[index] wrote ${KNOWLEDGE_DIR}/INDEX.md (${active.facts.length} active facts, ${Buffer.byteLength(index, "utf8")} bytes)`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
