#!/usr/bin/env node
// Branch-protection wiring — PRINTS the host mutations it intends; applies them
// ONLY when you run it with --apply --yes. sisu itself never mutates remote
// policy, and nothing emitted calls this script. GitHub only (product contract).
//
// What it wires, per protected branch: pull request required, required status
// check `sisu / verdict` (strict), code-owner review, no force-push, no deletion.
// It prints the org-ruleset option (resists repo-admin; required-workflows rule
// ignores event filters) and the check-source binding note (GitHub Actions app).
// Usage: node harness/scripts/wire-remote.mjs [--apply --yes]
import { pathToFileURL } from "node:url";
import { findRepoRoot, readIntent, readManifest, parseArgs, run } from "./common.mjs";

export const GITHUB_ACTIONS_APP_ID = 15368; // GitHub Actions app — required-check source binding

export function plan(root) {
  const intent = readIntent(root);
  const manifest = readManifest(root);
  const slug = intent?.detected?.["repo-slug"]?.value;
  const branches = [intent?.release?.["default-branch"], intent?.release?.["integration-branch"]].filter((b) => typeof b === "string");
  const check = manifest?.requiredCheck ?? "sisu / verdict";
  if (!slug || slug === "unknown") throw new Error("repo slug unknown (sisu.yaml detected.repo-slug) — is origin a GitHub remote?");
  return branches.map((branch) => ({
    branch,
    endpoint: `repos/${slug}/rulesets`,
    body: {
      name: `sisu-protect-${branch}`,
      target: "branch",
      enforcement: "active",
      conditions: { ref_name: { include: [`refs/heads/${branch}`], exclude: [] } },
      rules: [
        { type: "deletion" },
        { type: "non_fast_forward" },
        { type: "pull_request", parameters: { required_approving_review_count: 0, dismiss_stale_reviews_on_push: true, require_code_owner_review: true, require_last_push_approval: false, required_review_thread_resolution: false } },
        { type: "required_status_checks", parameters: { strict_required_status_checks_policy: true, required_status_checks: [{ context: check, integration_id: GITHUB_ACTIONS_APP_ID }] } },
      ],
      bypass_actors: [],
    },
  }));
}

export function main(argv = process.argv.slice(2)) {
  const { opts } = parseArgs(argv);
  const root = findRepoRoot();
  const steps = plan(root);
  console.log("[wire-remote] intended mutations (repository-level rulesets; bypassable-by: repo-admin):");
  for (const s of steps) {
    console.log(`\n  gh api -X POST ${s.endpoint} --input - <<'JSON'\n${JSON.stringify(s.body, null, 2)}\nJSON`);
  }
  console.log("\n[wire-remote] notes:");
  console.log("  - the required check is bound to the GitHub Actions app (integration_id), so a same-name commit status from a write credential does not satisfy it");
  console.log("  - require_code_owner_review enforces only if CODEOWNERS is loadable, the owner has write access, and the agent identity cannot self-approve (doctor --remote probes these)");
  console.log("  - ORG-LEVEL option (resists repo-admin): create the same ruleset at orgs/<org>/rulesets; the 'required workflows' rule there IGNORES event filters and always runs, which defeats docs-only cost skips. Probe availability first: a disabled org ruleset POST returning 201 proves it.");
  if (!opts.apply) {
    console.log("\n[wire-remote] dry run. Re-run with --apply --yes to execute (you, not sisu, are the actor).");
    return;
  }
  if (!opts.yes) throw new Error("--apply requires --yes");
  for (const s of steps) {
    const res = run(["gh", "api", "-X", "POST", s.endpoint, "--input", "-"], { input: JSON.stringify(s.body) });
    console.log(`[wire-remote] POST ${s.endpoint}: ${res.exitCode === 0 ? "ok" : `exit ${res.exitCode}`}`);
    if (res.exitCode !== 0) console.log(res.stderr || res.stdout);
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    main();
  } catch (e) {
    console.error(`[wire-remote] ${e.message}`);
    process.exit(1);
  }
}
