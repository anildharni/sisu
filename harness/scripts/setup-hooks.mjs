#!/usr/bin/env node
// Point core.hooksPath at the TRACKED hooks directory — no copy, no drift, no
// version stamp. The residue is one per-clone git config, which `--check`
// reports honestly as installed on THIS machine: yes / no / unknown.
// Usage: node harness/scripts/setup-hooks.mjs [--check] [--uninstall]
import { join } from "node:path";
import { chmodSync, existsSync, readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { findRepoRoot, git, parseArgs } from "./common.mjs";

export const HOOKS_DIR = "harness/git-hooks";

/** @param {string} root @returns {"yes" | "no" | "unknown"} */
export function installedState(root) {
  const v = git(root, ["config", "--get", "core.hooksPath"]);
  if (git(root, ["rev-parse", "--git-dir"]) === null) return "unknown";
  if (!v) return "no";
  return /harness\/git-hooks\/?$/.test(v.replace(/\\/g, "/")) ? "yes" : "no";
}

export function main(argv = process.argv.slice(2)) {
  const { opts } = parseArgs(argv);
  const root = findRepoRoot();
  if (opts.check) {
    const s = installedState(root);
    console.log(`[hooks] installed on this machine: ${s}${s === "no" ? " — run: node harness/scripts/setup-hooks.mjs" : ""}`);
    process.exit(s === "yes" ? 0 : 1);
  }
  if (opts.uninstall) {
    git(root, ["config", "--unset", "core.hooksPath"]);
    console.log("[hooks] core.hooksPath unset");
    return;
  }
  if (!existsSync(join(root, "harness", "git-hooks"))) throw new Error(`${HOOKS_DIR} not found — emit the harness first`);
  if (process.platform !== "win32") {
    for (const f of readdirSync(join(root, "harness", "git-hooks"))) chmodSync(join(root, "harness", "git-hooks", f), 0o755);
  }
  if (git(root, ["config", "core.hooksPath", HOOKS_DIR]) === null) throw new Error("git config failed — is this a git repository?");
  console.log(`[hooks] core.hooksPath = ${HOOKS_DIR} (this clone only; every clone runs this once). Hooks are speed bumps: --no-verify defeats them; CI is the wall.`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    main();
  } catch (e) {
    console.error(`[hooks] ${e.message}`);
    process.exit(1);
  }
}
