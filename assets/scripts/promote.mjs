#!/usr/bin/env node
// Promote a candidate fact to active/. The bar is paid HERE, not at capture:
//  - schema + authority lint (declarative content only; knowledge never outranks the spine)
//  - declared edges: contradicts BLOCKS; depends-on targets must be active; supersedes
//    marks the target superseded
//  - a verification handle must pass, OR a human approves (--approved-by <who>)
//  - a fact about an oracle (subject-kind: oracle) needs caused-by + red-observed
//  - execution safety: oracle-id and test-name handles may run; a raw `command` handle
//    is untrusted executable input and runs ONLY with --allow-command AND --approved-by
// A passing handle proves the handle ran green — not that the prose is true. Handle
// relevance is a review item; the promotion record says which evidence level applies.
//
// Usage: node harness/scripts/promote.mjs <id> [--approved-by <who>] [--allow-command] [--red-observed <sha|date>]
import { join } from "node:path";
import { existsSync, unlinkSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { findRepoRoot, parseArgs, writeText, readManifest, run, todayIso, gitHead, readIntent } from "./common.mjs";
import { joinFrontmatter } from "../lib/frontmatter.mjs";
import { loadTier, validateFact, checkEdges, factSubjectHash, renderIndex, KNOWLEDGE_DIR } from "../lib/knowledge.mjs";
import { parseCount, verdictOf } from "../lib/measure.mjs";

/**
 * Run a verification handle. Returns { ran, verdict, detail }.
 * @param {string} root @param {any} fact @param {{ allowCommand: boolean }} opts
 */
export function runHandle(root, fact, opts) {
  const v = fact.verification ?? { kind: "none" };
  const expected = v.expected ?? "pass";
  const manifest = readManifest(root);
  const oracles = Array.isArray(manifest?.oracles) ? manifest.oracles : [];
  if (v.kind === "none") return { ran: false, verdict: null, detail: "no handle" };
  if (v.kind === "file-anchor") {
    const p = join(root, ...String(v["file-anchor"].path).split("/"));
    const ok = existsSync(p) && readFileSync(p, "utf8").includes(v["file-anchor"].contains);
    return { ran: true, verdict: ok ? "pass" : "fail", detail: `file-anchor ${v["file-anchor"].path} ${ok ? "contains" : "does NOT contain"} ${JSON.stringify(v["file-anchor"].contains)} (location, not truth)` };
  }
  if (v.kind === "oracle-id" || v.kind === "test-name") {
    const o = oracles.find((x) => x.id === v["oracle-id"]);
    if (!o) return { ran: false, verdict: "fail", detail: `oracle ${v["oracle-id"]} is not in sisu.lock.json` };
    let argv = [...o.argv];
    if (v.kind === "test-name") {
      const name = String(v["test-name"]);
      if (/pytest/.test(argv.join(" "))) argv.push("-k", name);
      else if (/node\s+--test|node:test/.test(argv.join(" ")) || argv[0] === "node") argv.push("--test-name-pattern", name);
      else argv.push("--", "-t", name); // jest / vitest via npm test
    }
    const res = run(argv, { cwd: join(root, ...(o.cwd ?? ".").split("/")), timeoutMs: Number(v["timeout-ms"] ?? 600000) });
    let verdict;
    if (o.kind === "ratchet" && o.parser) {
      try {
        parseCount({ parser: o.parser, parserArgs: o.parserArgs ?? undefined }, res);
        verdict = "pass";
      } catch (e) {
        verdict = "fail";
      }
    } else verdict = verdictOf(res);
    return { ran: true, verdict: verdict === expected ? "pass" : "fail", detail: `${argv.join(" ")} → ${verdict} (expected ${expected})` };
  }
  if (v.kind === "command") {
    if (!opts.allowCommand) return { ran: false, verdict: "fail", detail: `command handle NOT run: raw commands are untrusted executable input. Review ${JSON.stringify(v.command)} and re-run with --allow-command --approved-by <who>` };
    const res = run(v.command, { cwd: join(root, ...(v.cwd ?? ".").split("/")), timeoutMs: Number(v["timeout-ms"] ?? 600000) });
    const verdict = verdictOf(res);
    return { ran: true, verdict: verdict === expected ? "pass" : "fail", detail: `${v.command.join(" ")} → ${verdict} (expected ${expected}; human-authorized run)` };
  }
  return { ran: false, verdict: "fail", detail: `unknown handle kind ${v.kind}` };
}

export function main(argv = process.argv.slice(2)) {
  const { opts, positional } = parseArgs(argv);
  const id = positional[0];
  if (!id) throw new Error("usage: promote.mjs <id> [--approved-by <who>] [--allow-command] [--red-observed <ref>]");
  const root = findRepoRoot();
  const candidates = loadTier(root, "candidate");
  const fact = candidates.facts.find((f) => f.id === id);
  if (!fact) throw new Error(`no candidate ${id}`);
  const approvedBy = typeof opts["approved-by"] === "string" ? opts["approved-by"] : null;
  if (opts["allow-command"] && !approvedBy) throw new Error("--allow-command requires --approved-by <who>");
  const active = loadTier(root, "active");
  const problems = [];
  // Build the would-be active frontmatter and validate it AS active.
  const fm = { ...fact.raw, status: "active" };
  if (typeof opts["red-observed"] === "string") fm["red-observed"] = opts["red-observed"];
  const handle = runHandle(root, fact, { allowCommand: Boolean(opts["allow-command"]) });
  const today = todayIso();
  if (handle.verdict === "pass") {
    fm["verified-at"] = today;
    fm["promoted-by"] = { value: `handle:${fact.verification.kind}`, "evidence-level": "local-run", at: today, detail: handle.detail };
    if (approvedBy) fm["promoted-by"] = { value: approvedBy, "evidence-level": "human", at: today, detail: `also verified: ${handle.detail}` };
  } else if (approvedBy) {
    fm["verified-at"] = fm["verified-at"] ?? null;
    fm["promoted-by"] = { value: approvedBy, "evidence-level": "human", at: today, detail: handle.ran ? `handle FAILED (${handle.detail}); promoted on human approval — record why` : `no passing handle (${handle.detail}); promoted on human approval` };
  } else {
    problems.push(`verification: ${handle.detail}. Promotion needs a passing handle OR --approved-by <who>.`);
  }
  problems.push(...validateFact(fm, fact.body, "active"));
  problems.push(...checkEdges(fact, active.facts));
  if (problems.length) {
    for (const p of problems) console.error(`[promote] BLOCKED ${p}`);
    process.exit(1);
  }
  fm["subject-hash"] = factSubjectHash(root, fact);
  fm["promoted-at-commit"] = gitHead(root);
  // supersedes: mark targets superseded (file stays; index drops it)
  for (const e of fact.edges.filter((x) => x.type === "supersedes")) {
    const t = active.facts.find((a) => a.id === e.target);
    if (t) writeText(join(root, ...t.file.split("/")), joinFrontmatter({ ...t.raw, status: "superseded", "superseded-by": fact.id }, t.body));
  }
  writeText(join(root, ...KNOWLEDGE_DIR.split("/"), "active", `${id}.md`), joinFrontmatter(fm, fact.body));
  unlinkSync(join(root, ...fact.file.split("/")));
  const after = loadTier(root, "active");
  writeText(join(root, ...KNOWLEDGE_DIR.split("/"), "INDEX.md"), renderIndex(after.facts));
  console.log(`[promote] ${id} → active (${fm["promoted-by"]["evidence-level"]}: ${fm["promoted-by"].detail})`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    main();
  } catch (e) {
    console.error(`[promote] ${e.message}`);
    process.exit(1);
  }
}
