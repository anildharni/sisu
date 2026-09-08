#!/usr/bin/env node
// Cold-session loader check (harness.cold-load-isolation) — the one empirical
// test the harness rests on. Runs the consuming tool under an ISOLATED config
// directory AND refuses to run while the workspace carries a local settings
// overlay, because a developer's global config silently supplying a missing
// file would falsify the result. Manual, point-in-time; evidence is `declared`
// until this has run. Exit 0 all roles seen; 1 some missing; 2 could not run.
// Usage: node harness/scripts/cold-load-check.mjs [--target claude-code]
import { join } from "node:path";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { findRepoRoot, readManifest, run, parseArgs } from "./common.mjs";

export function main(argv = process.argv.slice(2)) {
  const { opts } = parseArgs(argv);
  const target = typeof opts.target === "string" ? opts.target : "claude-code";
  const root = findRepoRoot();
  const manifest = readManifest(root);
  const roles = manifest?.targets?.[target]?.roles ?? [];
  if (target !== "claude-code") {
    console.log(`[cold-load] no automated loader probe for ${target}; status stays declared`);
    process.exit(2);
  }
  if (existsSync(join(root, ".claude", "settings.local.json"))) {
    console.error("[cold-load] REFUSING: .claude/settings.local.json is present in the workspace — isolation is not real while a local overlay applies. Move it aside and re-run.");
    process.exit(2);
  }
  const cfg = mkdtempSync(join(tmpdir(), "sisu-cold-"));
  try {
    const prompt = "List the names of the subagents (custom agents) available to you in this project, one per line, nothing else. If none, print NONE.";
    const res = run(["claude", "-p", prompt, "--output-format", "text"], { cwd: root, env: { CLAUDE_CONFIG_DIR: cfg }, timeoutMs: 180000 });
    if (res.error || (res.exitCode !== 0 && !res.stdout)) {
      console.error(`[cold-load] could not run the consuming tool: ${res.error ?? res.stderr.slice(0, 300)}`);
      process.exit(2);
    }
    const seen = res.stdout.toLowerCase();
    let missing = 0;
    for (const r of roles) {
      const ok = seen.includes(r.toLowerCase());
      console.log(`[cold-load] ${r}: ${ok ? "loaded" : "MISSING"}`);
      if (!ok) missing += 1;
    }
    console.log(`[cold-load] isolated config dir: ${cfg}; workspace overlay: absent; ${roles.length - missing}/${roles.length} roles observed (point-in-time)`);
    process.exit(missing ? 1 : 0);
  } finally {
    rmSync(cfg, { recursive: true, force: true });
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
