// doctor --remote: READ-ONLY queries against the user's own git host via `gh api`
// (the one network exception besides the user-run wiring script). Every row is
// stamped observed-at by the caller; anything the host does not answer is
// `unknown` — never green. Host facts are probed here, never hardcoded.
import { run } from "../../assets/scripts/common.mjs";
import { splitFrontmatter } from "../../assets/lib/frontmatter.mjs";
import { listFiles, readText } from "../lib/fsx.mjs";
import { join } from "node:path";

/** Default gh runner: returns parsed JSON or { error }. */
export function ghApi(args) {
  const r = run(["gh", "api", ...args], { timeoutMs: 60000 });
  if (r.exitCode !== 0) return { error: (r.stderr || r.stdout).trim().slice(0, 300) || `exit ${r.exitCode}` };
  try {
    return JSON.parse(r.stdout);
  } catch {
    return { error: "non-JSON response" };
  }
}

/**
 * @param {string} repoRoot @param {import("../intent.mjs").Intent} intent @param {any} graph @param {{ gh?: (args: string[]) => any }} o
 * @returns {Record<string, { kind: "observed" | "unknown", notes: string[], effect?: string, bypassableBy?: string }>}
 */
export function remoteProbes(repoRoot, intent, graph, o = {}) {
  const gh = o.gh ?? ghApi;
  const slug = /** @type {string} */ (intent.detected["repo-slug"]?.value ?? "unknown");
  /** @type {Record<string, any>} */
  const out = {};
  const unknown = (probe, why) => (out[probe] = { kind: "unknown", notes: [why] });
  if (slug === "unknown" || intent.detected["git-host"]?.value !== "github") {
    for (const p of ["remote.branch-protection", "remote.required-checks-binding", "remote.codeowners-errors", "remote.agent-identity", "remote.ledger-pointers", "remote.workflow-protections"]) unknown(p, "no GitHub remote detected");
    return out;
  }
  const requiredCheck = graph.manifest.requiredCheck;
  const branches = [intent.release["default-branch"], intent.release["integration-branch"]].filter(Boolean);

  // ---- branch protection + check binding (rulesets API; source level decides bypassable-by)
  const rulesets = gh([`repos/${slug}/rulesets`]);
  if (rulesets?.error) {
    unknown("remote.branch-protection", `rulesets query failed: ${rulesets.error}`);
    unknown("remote.required-checks-binding", `rulesets query failed: ${rulesets.error}`);
  } else {
    const notes = [];
    const bindNotes = [];
    let weakest = "none";
    let allBranchesProtected = true;
    let anyBound = false;
    let anyUnbound = false;
    for (const branch of branches) {
      const rules = gh([`repos/${slug}/rules/branches/${branch}`]);
      if (rules?.error) {
        notes.push(`${branch}: rules query failed (${rules.error})`);
        allBranchesProtected = false;
        continue;
      }
      const list = Array.isArray(rules) ? rules : [];
      const pr = list.find((r) => r.type === "pull_request");
      const rsc = list.find((r) => r.type === "required_status_checks");
      const checks = rsc?.parameters?.required_status_checks ?? [];
      const ours = checks.find((c) => c.context === requiredCheck);
      const sources = new Set(list.map((r) => r.ruleset_source_type).filter(Boolean));
      const srcLevel = sources.has("Organization") ? "org-admin" : sources.size ? "repo-admin" : "none";
      if (srcLevel === "none") allBranchesProtected = false;
      if (srcLevel === "repo-admin" && weakest !== "none") weakest = "repo-admin";
      if (weakest === "none" && srcLevel !== "none") weakest = srcLevel;
      notes.push(`${branch}: ${list.length} rule(s) from ${[...sources].join("+") || "no ruleset"}; PR required: ${pr ? "yes" : "NO"}; code-owner review: ${pr?.parameters?.require_code_owner_review ? "yes" : "NO"}; required check "${requiredCheck}": ${ours ? "yes" : "NO"}${rsc?.parameters?.strict_required_status_checks_policy ? " (strict)" : ""}; non-fast-forward: ${list.some((r) => r.type === "non_fast_forward") ? "yes" : "NO"}`);
      if (!pr || !ours) allBranchesProtected = false;
      if (ours) {
        if (ours.integration_id) anyBound = true;
        else anyUnbound = true;
        bindNotes.push(`${branch}: "${requiredCheck}" ${ours.integration_id ? `bound to app ${ours.integration_id}` : "NOT bound to a source app — spoofable by any write credential via a same-name commit status"}`);
      } else bindNotes.push(`${branch}: required check not configured`);
    }
    out["remote.branch-protection"] = { kind: "observed", notes, effect: allBranchesProtected ? "blocking" : "none", bypassableBy: allBranchesProtected ? (weakest === "org-admin" ? "org-admin" : "repo-admin") : "repo-write" };
    out["remote.required-checks-binding"] = { kind: "observed", notes: bindNotes, effect: anyBound && !anyUnbound ? "blocking" : "none", bypassableBy: anyUnbound || !anyBound ? "repo-write" : "repo-admin" };
    const wep = (Array.isArray(rulesets) ? rulesets : []).filter((r) => /workflow/i.test(JSON.stringify(r.rules ?? r.target ?? "")));
    out["remote.workflow-protections"] = { kind: "observed", notes: [wep.length ? `${wep.length} ruleset(s) mention workflows` : "no workflow-execution-protection ruleset observed (public preview feature; probe is shape-only)"] };
  }

  // ---- CODEOWNERS errors API (per-line skip semantics)
  const co = gh([`repos/${slug}/codeowners/errors`]);
  if (co?.error) unknown("remote.codeowners-errors", `codeowners/errors query failed: ${co.error}`);
  else {
    const errs = Array.isArray(co?.errors) ? co.errors : [];
    out["remote.codeowners-errors"] = { kind: "observed", notes: errs.length ? errs.map((e) => `line ${e.line}: ${e.kind} — ${e.message?.split("\n")[0] ?? ""} (ONLY that line is skipped)`) : ["no CODEOWNERS errors reported by the host"], ...(errs.length ? { effect: "advisory" } : {}) };
  }

  // ---- agent identity vs approver, repo role
  const me = gh(["user"]);
  if (me?.error) unknown("remote.agent-identity", `user query failed: ${me.error}`);
  else {
    const login = String(me.login ?? "unknown");
    const perm = gh([`repos/${slug}/collaborators/${login}/permission`]);
    const role = perm?.permission ?? perm?.role_name ?? "unknown";
    const approver = (intent.policy.approver ?? "").replace(/^@/, "").toLowerCase();
    const same = approver && approver === login.toLowerCase();
    const notes = [`this credential: ${login} (repo permission: ${role})`, approver ? (same ? `SAME principal as the approver ${intent.policy.approver} — code-owner review cannot be structurally enforced from this credential` : `approver ${intent.policy.approver} is a different principal`) : "no approver declared"];
    if (role === "admin") notes.push("credential is repo ADMIN: it can edit rulesets — a wall only against others");
    out["remote.agent-identity"] = { kind: "observed", notes, effect: same || role === "admin" ? "none" : "blocking", bypassableBy: role === "admin" ? "repo-admin" : "org-admin" };
  }

  // ---- ledger CI pointers (last 10 entries with URLs)
  const ledgerDir = join(repoRoot, "project", "ledger", "runs");
  const entries = listFiles(ledgerDir).filter((f) => f.endsWith(".md")).slice(-10);
  const notes = [];
  let resolved = 0;
  let total = 0;
  for (const f of entries) {
    const fm = splitFrontmatter(readText(join(ledgerDir, f))).data;
    for (const g of /** @type {any[]} */ (Array.isArray(fm?.gates) ? fm.gates : [])) {
      const url = g?.["ci-run"]?.url;
      if (!url) continue;
      total += 1;
      const m = String(url).match(/actions\/runs\/(\d+)/);
      if (!m) continue;
      const r = gh([`repos/${slug}/actions/runs/${m[1]}`]);
      if (!r?.error) {
        resolved += 1;
        notes.push(`${f}: ${g.oracle} → host says ${r.conclusion ?? r.status} (ledger said ${g.verdict})${(r.conclusion === "success") !== (g.verdict === "pass") ? " MISMATCH" : ""}`);
      }
    }
  }
  out["remote.ledger-pointers"] = total ? { kind: "observed", notes: [`${resolved}/${total} CI pointers resolved`, ...notes] } : { kind: "unknown", notes: ["no CI pointers in the last ledger entries"] };
  return out;
}
