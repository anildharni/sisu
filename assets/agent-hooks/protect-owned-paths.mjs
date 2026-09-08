#!/usr/bin/env node
// PreToolUse hook (matcher: Edit|Write|MultiEdit|NotebookEdit) — refuses edits to
// build output: anything under harness/ and the manifest. Hand-editing generated
// mechanism is Tier 0; customization goes through overrides/. FAIL-OPEN; it stops
// the convenient path only (the agent can still use Bash), so it is preventive and
// bypassable at workspace-write — the checksum probe is what catches the rest.
import { readPayload } from "./shell-text.mjs";
import { resolve, relative, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";

const OWNED_PREFIXES = ["harness/"];
const OWNED_FILES = ["sisu.lock.json"];

/** @param {string} filePath @param {string} cwd @returns {string | null} */
export function decide(filePath, cwd) {
  const abs = isAbsolute(filePath) ? filePath : resolve(cwd, filePath);
  const rel = relative(cwd, abs).replace(/\\/g, "/");
  if (rel.startsWith("..")) return null; // outside the workspace: not ours to judge
  if (OWNED_FILES.includes(rel)) return `Blocked: ${rel} is generated (the manifest). It is written only by emit/upgrade.`;
  if (OWNED_PREFIXES.some((p) => rel.startsWith(p))) return `Blocked: ${rel} is build output owned by the harness generator. Editing it is Tier 0 — put a whole-file override of the canonical source under overrides/ and re-emit.`;
  return null;
}

async function main() {
  try {
    const payload = await readPayload();
    const fp = payload?.tool_input?.file_path ?? payload?.tool_input?.notebook_path;
    if (typeof fp !== "string") process.exit(0);
    const cwd = typeof payload.cwd === "string" ? payload.cwd : process.cwd();
    const reason = decide(fp, cwd);
    if (reason) {
      process.stderr.write(reason + "\n");
      process.exit(2);
    }
    process.exit(0);
  } catch {
    process.exit(0);
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
