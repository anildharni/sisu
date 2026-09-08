#!/usr/bin/env node
// Capture helper — the thirty-second affordance. Scaffolds a CANDIDATE fact with
// frontmatter prefilled and the verification-handle slot ready. Never writes to
// active/: promotion is a separate, gated step.
//
// Usage: node harness/scripts/capture.mjs "<short claim>" [--applies-to <path>]... [--why "<text>"]
//        [--handle oracle-id:<id> | test-name:<oracle-id>::<name> | file-anchor:<path>::<contains> | none]
//        [--caused-by <incident>] [--depends-on <fact-id>] [--subject-kind oracle]
import { join } from "node:path";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { findRepoRoot, parseArgs, writeText, slugify, todayIso } from "./common.mjs";
import { joinFrontmatter } from "../lib/frontmatter.mjs";
import { KNOWLEDGE_DIR } from "../lib/knowledge.mjs";

function parseHandle(spec) {
  if (!spec || spec === "none") return { kind: "none" };
  const [kind, rest] = [spec.slice(0, spec.indexOf(":")), spec.slice(spec.indexOf(":") + 1)];
  if (kind === "oracle-id") return { kind, "oracle-id": rest, expected: "pass" };
  if (kind === "test-name") {
    const [oracle, name] = rest.split("::");
    return { kind, "oracle-id": oracle, "test-name": name, expected: "pass" };
  }
  if (kind === "file-anchor") {
    const [path, contains] = rest.split("::");
    return { kind, "file-anchor": { path, contains }, expected: "pass" };
  }
  if (kind === "command") throw new Error("command handles are declared by editing the file (argv array) and are NEVER auto-run; prefer oracle-id");
  throw new Error(`unknown handle kind ${kind}`);
}

export function main(argv = process.argv.slice(2)) {
  const { opts, positional } = parseArgs(argv);
  const title = positional.join(" ").trim();
  if (title.length < 8) throw new Error('usage: capture.mjs "<short claim>" [--applies-to <path>]... [--why "..."] [--handle <spec>]');
  const root = findRepoRoot();
  const id = slugify(title);
  const file = join(root, ...KNOWLEDGE_DIR.split("/"), "candidate", `${id}.md`);
  if (existsSync(file)) throw new Error(`candidate ${id} already exists`);
  const appliesTo = [].concat(opts["applies-to"] ?? []);
  const edges = [];
  for (const t of [].concat(opts["caused-by"] ?? [])) edges.push({ type: "caused-by", target: t });
  for (const t of [].concat(opts["depends-on"] ?? [])) edges.push({ type: "depends-on", target: t });
  const fm = {
    kind: "fact",
    id,
    title,
    status: "candidate",
    "applies-to": appliesTo,
    why: typeof opts.why === "string" ? opts.why : "TODO: why is this true, and how would we notice it stopped being true?",
    verification: parseHandle(typeof opts.handle === "string" ? opts.handle : null),
    edges,
    created: todayIso(),
    "verified-at": null,
    "subject-hash": null,
    ...(typeof opts["subject-kind"] === "string" ? { "subject-kind": opts["subject-kind"] } : {}),
  };
  const body = `\n${title}\n\n<!-- Candidate: not loaded into context, carries no authority. Promote with\n     node harness/scripts/promote.mjs ${id}   (handle must pass, or --approved-by <who>) -->\n`;
  writeText(file, joinFrontmatter(fm, body));
  console.log(`[capture] ${KNOWLEDGE_DIR}/candidate/${id}.md`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    main();
  } catch (e) {
    console.error(`[capture] ${e.message}`);
    process.exit(1);
  }
}
