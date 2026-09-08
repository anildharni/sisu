#!/usr/bin/env node
// Agent-process ledger: one committed file per run under project/ledger/runs/.
// Zero telemetry. Entries are designed to be GREPPED: the first body line is a
// one-line summary with stable field order. Honesty labels: every identity,
// approval and CI pointer carries an evidence-level (ci | human | self-attested |
// unknown). A record committed by the agent it describes is not a
// tamper-independent audit artifact — the file header says so.
//
// Usage:
//   node harness/scripts/ledger.mjs start --task "<one line>" [--agent <id>]
//   node harness/scripts/ledger.mjs gate --oracle <id> --verdict pass|fail [--subject <path>] [--ci-run <url>]
//   node harness/scripts/ledger.mjs end [--summary "<text>"] [--status COMPLETE|PARTIAL|BLOCKED] [--approved-by <who>]
import { join } from "node:path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import { findRepoRoot, parseArgs, writeText, readText, gitHead, git, subjectHash, nowIso, listFiles, LEDGER_DIR, KNOWLEDGE_DIR } from "./common.mjs";
import { splitFrontmatter, joinFrontmatter } from "../lib/frontmatter.mjs";

const HEADER = `<!-- Ledger entry written by the agent whose run it records: a transcription, not a tamper-independent audit artifact. CI run URLs are the pointers to records the agent cannot write; they stay self-attested until resolved by doctor --remote. -->`;

function currentRunFile(root) {
  const gitDir = git(root, ["rev-parse", "--git-dir"]);
  const dir = gitDir ? (gitDir.startsWith("/") || /^[A-Za-z]:/.test(gitDir) ? gitDir : join(root, gitDir)) : join(root, ".sisu-tmp");
  mkdirSync(dir, { recursive: true });
  return join(dir, "sisu-current-run");
}

function knowledgeCounts(root) {
  const c = listFiles(join(root, KNOWLEDGE_DIR, "candidate")).filter((f) => f.endsWith(".md")).length;
  const a = listFiles(join(root, KNOWLEDGE_DIR, "active")).filter((f) => f.endsWith(".md")).length;
  return { candidate: c, active: a };
}

function summaryLine(fm) {
  const gates = fm.gates ?? [];
  const pass = gates.filter((g) => g.verdict === "pass").length;
  const fail = gates.filter((g) => g.verdict === "fail").length;
  return `# ${fm["run-id"]} | ${fm.status} | ${fm.task} | gates: ${pass} pass / ${fail} fail | knowledge: +${fm.knowledge?.captured ?? 0} captured / +${fm.knowledge?.promoted ?? 0} promoted`;
}

function write(root, fm) {
  const file = join(root, ...LEDGER_DIR.split("/"), `${fm["run-id"]}.md`);
  const body = `\n${summaryLine(fm)}\n\n${HEADER}\n`;
  writeText(file, joinFrontmatter(fm, body));
  return file;
}

/** @returns {any} */
function load(root, runId) {
  const file = join(root, ...LEDGER_DIR.split("/"), `${runId}.md`);
  if (!existsSync(file)) throw new Error(`no ledger entry ${runId}`);
  const fm = splitFrontmatter(readText(file)).data;
  if (!fm) throw new Error(`ledger entry ${runId} has no frontmatter`);
  return fm;
}

export function main(argv = process.argv.slice(2)) {
  const { opts, positional } = parseArgs(argv);
  const cmd = positional[0];
  const root = findRepoRoot();
  const cur = currentRunFile(root);
  if (cmd === "start") {
    const task = typeof opts.task === "string" ? opts.task : null;
    if (!task) throw new Error('usage: ledger.mjs start --task "<one line>"');
    const runId = `${nowIso().replace(/[:.]/g, "-").slice(0, 19)}-${randomBytes(3).toString("hex")}`;
    const k = knowledgeCounts(root);
    const fm = {
      kind: "ledger-run",
      "run-id": runId,
      task,
      status: "RUNNING",
      started: nowIso(),
      ended: null,
      agent: { value: typeof opts.agent === "string" ? opts.agent : process.env.SISU_AGENT_ID ?? "unknown", "evidence-level": "self-attested" },
      approval: { value: null, "evidence-level": "unknown" },
      commits: { before: gitHead(root), after: null },
      gates: [],
      knowledge: { "candidate-at-start": k.candidate, "active-at-start": k.active, captured: 0, promoted: 0 },
      "ci-pointers": "self-attested until resolved by doctor --remote",
    };
    const file = write(root, fm);
    writeFileSync(cur, runId, "utf8");
    console.log(`[ledger] started ${runId} → ${file}`);
    return;
  }
  if (!existsSync(cur)) throw new Error("no current run — run `ledger.mjs start` first");
  const runId = readFileSync(cur, "utf8").trim();
  const fm = load(root, runId);
  if (cmd === "gate") {
    const oracle = typeof opts.oracle === "string" ? opts.oracle : null;
    const verdict = opts.verdict;
    if (!oracle || !["pass", "fail"].includes(verdict)) throw new Error("usage: ledger.mjs gate --oracle <id> --verdict pass|fail [--subject <path>] [--ci-run <url>]");
    const subject = typeof opts.subject === "string" ? [opts.subject] : [];
    const entry = {
      oracle,
      verdict,
      "subject-hash": subject.length ? subjectHash(root, subject) : `tree:${git(root, ["rev-parse", "HEAD^{tree}"]) ?? "unknown"}`,
      at: nowIso(),
      "ci-run": typeof opts["ci-run"] === "string" ? { url: opts["ci-run"], "evidence-level": "self-attested" } : { url: null, "evidence-level": "unknown" },
      "evidence-class": typeof opts["ci-run"] === "string" ? "artifact-verification (pointer unresolved)" : "review-observation",
    };
    fm.gates = [...(fm.gates ?? []), entry];
    write(root, fm);
    console.log(`[ledger] ${runId}: ${oracle} ${verdict} (${entry["evidence-class"]})`);
    return;
  }
  if (cmd === "end") {
    const k = knowledgeCounts(root);
    fm.status = typeof opts.status === "string" ? opts.status : "COMPLETE";
    fm.ended = nowIso();
    fm.commits.after = gitHead(root);
    fm.knowledge.captured = Math.max(0, k.candidate - fm.knowledge["candidate-at-start"]);
    fm.knowledge.promoted = Math.max(0, k.active - fm.knowledge["active-at-start"]);
    if (typeof opts["approved-by"] === "string") fm.approval = { value: opts["approved-by"], "evidence-level": "self-attested" };
    if (typeof opts.summary === "string") fm.summary = opts.summary;
    const file = write(root, fm);
    console.log(`[ledger] ended ${runId} (${fm.status}) → ${file}`);
    console.log(summaryLine(fm));
    return;
  }
  throw new Error("usage: ledger.mjs start|gate|end");
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    main();
  } catch (e) {
    console.error(`[ledger] ${e.message}`);
    process.exit(1);
  }
}
