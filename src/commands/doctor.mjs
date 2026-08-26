// `sisu doctor [--remote] [--strict] [--run-tests] [--format=json]`
// A three-column truth table — mechanism | intended enforcement | actual enforcement
// in THIS setup — where "actual" is the enforcement tuple plus evidence
// {declared|observed|unknown, observedAt, probe}. Every catalog mechanism appears
// (installed, omitted, deprecated, conflict). Offline, every remote row is
// unknown — never green. Output is a CONTRACT (src/schemas/doctor.schema.json);
// volatile fields live under `volatile`.
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { hostname } from "node:os";
import { readIntent } from "../intent.mjs";
import { readManifest, verifyOwned, loadInputs, GENERATOR_VERSION } from "../manifest.mjs";
import { resolve, PREDICATE_DEFINITIONS } from "../resolve.mjs";
import { detect, diffFindings } from "../detect.mjs";
import { STRICT_PREDICATES, ACTORS } from "../canonical.mjs";
import { readText } from "../lib/fsx.mjs";
import { installedState } from "../../assets/scripts/setup-hooks.mjs";
import { check as indexCheck } from "../../assets/scripts/index.mjs";
import { driftReport } from "../../assets/scripts/drift.mjs";
import { loadWaivers } from "../../assets/scripts/ratchet.mjs";
import { identityHash } from "../../assets/lib/identity.mjs";
import { run } from "../../assets/scripts/common.mjs";
import { remoteProbes } from "./remote.mjs";

const actorRank = (a) => ACTORS.indexOf(a);

/**
 * @param {string} repoRoot
 * @param {{ remote?: boolean, strict?: boolean, runTests?: boolean, today?: string, gh?: (args: string[]) => any }} o
 */
export function doctor(repoRoot, o = {}) {
  const started = Date.now();
  const today = o.today ?? new Date().toISOString().slice(0, 10);
  const observedAt = new Date().toISOString();
  const intent = readIntent(repoRoot);
  const manifest = readManifest(repoRoot);
  const inputs = loadInputs(repoRoot);
  const graph = resolve(inputs);
  const conflicts = manifest?.conflicts ?? {};

  // ---- local probes (ephemeral report, never written back)
  const owned = manifest ? verifyOwned(repoRoot, manifest) : [];
  const ownedBad = owned.filter((r) => r.state !== "ok");
  const hooks = installedState(repoRoot);
  const fresh = detect(repoRoot, { packs: intent.packs, intent, exclude: new Set(Object.keys(manifest?.owned ?? {})) });
  const detectedRows = diffFindings(intent.detected, fresh.findings);
  const staleDetected = detectedRows.filter((r) => r.state === "stale" || r.state === "missing");
  /** @type {any} */
  let knowledge = null;
  try {
    knowledge = { index: indexCheck(repoRoot), drift: driftReport(repoRoot, { today }) };
  } catch (e) {
    knowledge = { error: String(/** @type {Error} */ (e).message) };
  }
  const waivers = loadWaivers(repoRoot).map((w) => ({ file: w.file, metric: w.metric, raiseTo: w["raise-to"], expires: w.expires, daysRemaining: typeof w.expires === "string" ? Math.ceil((Date.parse(w.expires) - Date.parse(today)) / 86400000) : null, approver: w.approver }));
  const baselines = existsSync(join(repoRoot, "project", "quality-baselines.json")) ? JSON.parse(readText(join(repoRoot, "project", "quality-baselines.json"))) : null;
  /** @type {string[]} */
  const ratchetNotes = [];
  if (!baselines) ratchetNotes.push("project/quality-baselines.json missing");
  else
    for (const [id, m] of Object.entries(baselines.metrics ?? {})) {
      if (m.baseline === "unmeasured") ratchetNotes.push(`${id}: baseline unmeasured (gate fails until --rebaseline)`);
      if (m.direction === "floor" && !(m.baseline > 0)) ratchetNotes.push(`${id}: vacuous floor`);
      try {
        if (identityHash(repoRoot, m.identity).hash !== m["identity-hash"]) ratchetNotes.push(`${id}: measurement identity CHANGED vs stored hash`);
      } catch (e) {
        ratchetNotes.push(`${id}: identity unreadable (${/** @type {Error} */ (e).message})`);
      }
    }
  const wfPath = join(repoRoot, ".github", "workflows", "sisu-gates.yml");
  const wf = existsSync(wfPath) ? readText(wfPath) : null;
  /** @type {string[]} */
  const wfNotes = [];
  if (wf) {
    for (const m of wf.matchAll(/uses:\s*([^\s#]+)/g)) if (!/@[0-9a-f]{40}$/.test(m[1])) wfNotes.push(`unpinned action ${m[1]}`);
    if (!wf.includes(`name: ${JSON.stringify(graph.manifest.requiredCheck)}`)) wfNotes.push("required-check job name missing");
    if (!/verdict:\n[\s\S]*?if: \$\{\{ always\(\) \}\}/.test(wf)) wfNotes.push("verdict job not under always()");
    if (!/^  merge_group:/m.test(wf)) wfNotes.push("merge_group not declared");
  }
  const coPath = join(repoRoot, ".github", "CODEOWNERS");
  /** @type {string[]} */
  const coNotes = [];
  let coLive = 0;
  if (existsSync(coPath)) {
    const text = readText(coPath);
    if (Buffer.byteLength(text) >= 3 * 1024 * 1024) coNotes.push("over 3 MB: GitHub will not load it");
    const live = text.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#"));
    coLive = live.length;
    for (const l of live) if (!/^\S+\s+@\S+/.test(l) || l.startsWith("!")) coNotes.push(`invalid line (skipped by GitHub): ${l.slice(0, 60)}`);
    if (!live.some((l) => l.startsWith("/.github/CODEOWNERS"))) coNotes.push("CODEOWNERS does not own itself");
    if (!intent.policy.approver) coNotes.push("no host-verified approver: file is valid-but-empty and enforces nothing (advisory)");
  }
  const settingsPath = join(repoRoot, ".claude", "settings.json");
  /** @type {string[]} */
  const hookNotes = [];
  if (intent.targets.includes("claude-code")) {
    if (!existsSync(settingsPath)) hookNotes.push(".claude/settings.json missing");
    else {
      const s = readText(settingsPath);
      for (const h of graph.manifest.targets["claude-code"]?.agentHooks ?? []) {
        if (h === "shell-text.mjs") continue;
        if (!s.includes(`harness/agent-hooks/${h}`)) hookNotes.push(`${h} not wired`);
        if (!existsSync(join(repoRoot, "harness", "agent-hooks", h))) hookNotes.push(`${h} missing on disk`);
      }
    }
  }
  /** @type {{ kind: string, detail: string, green?: boolean }} */
  let selfVerification = { kind: "declared", detail: 'run with --run-tests (or in CI: node --test "harness/tests/*.test.mjs")' };
  if (o.runTests) {
    const r = run([process.execPath, "--test", "harness/tests/*.test.mjs"], { cwd: repoRoot, timeoutMs: 10 * 60 * 1000 });
    selfVerification = { kind: "observed", detail: r.exitCode === 0 ? "green" : `RED (exit ${r.exitCode})`, green: r.exitCode === 0 };
  }

  // ---- remote probes (read-only, user-invoked)
  const remote = o.remote ? remoteProbes(repoRoot, intent, graph, { gh: o.gh }) : null;

  // ---- rows
  const rows = graph.catalog.map((m) => {
    /** @type {{ effect: string, plane: string, bypassableBy: string, failMode: string, evidence: { kind: string, probe: string, observedAt: string | null }, notes: string[] }} */
    const actual = { ...m.intended, evidence: { kind: "declared", probe: m.evidenceProbe, observedAt: null }, notes: [] };
    /** @type {string} */
    let state = m.state;
    const reason = m.reason;
    const conflictPath = Object.keys(conflicts).find((p) => conflictAffects(m.id, p));
    if (conflictPath) {
      state = "conflict";
      actual.effect = "none";
      actual.notes.push(`pre-existing file at ${conflictPath}: ${conflicts[conflictPath]}`);
    }
    /** @param {string[]} notes @param {{ degradeTo?: string, bypass?: string }} [opts] */
    const observe = (notes, opts = {}) => {
      actual.evidence = { kind: "observed", probe: m.evidenceProbe, observedAt };
      actual.notes.push(...notes);
      if (opts.degradeTo && notes.length) actual.effect = opts.degradeTo;
      if (opts.bypass && notes.length) actual.bypassableBy = opts.bypass;
    };
    if (state === "installed") {
      switch (m.evidenceProbe) {
        case "local.owned-checksums":
          observe(ownedBad.map((r) => `${r.state}: ${r.path}`), { degradeTo: "none" });
          if (!ownedBad.length) actual.notes.push(`${owned.length} owned paths match the manifest`);
          break;
        case "local.hooks-path":
          observe(hooks === "yes" ? [] : [`installed on THIS machine: ${hooks}`], { degradeTo: "none" });
          if (hooks === "yes") actual.notes.push("installed on THIS machine: yes");
          break;
        case "local.detected-staleness":
          observe(staleDetected.map((r) => `${r.id}: committed ${JSON.stringify(r.committed)} vs now ${JSON.stringify(r.fresh)} (${r.state})`));
          for (const r of detectedRows.filter((x) => x.state === "overridden")) actual.notes.push(`${r.id}: overridden — ${r.reason}`);
          break;
        case "local.index-budget":
          observe(knowledge?.index ? knowledge.index.problems.filter((p) => /budget/.test(p)) : ["index check unavailable"], { degradeTo: "none" });
          for (const b of knowledge?.index?.budget ?? []) actual.notes.push(`${b.target}: ${b.bytes}/${b.budget} bytes`);
          break;
        case "local.knowledge-health":
          observe(knowledge?.index ? knowledge.index.problems.filter((p) => !/budget/.test(p)) : ["index check unavailable"]);
          if (knowledge?.drift) actual.notes.push(`loop: ${knowledge.drift.loop}; ${knowledge.drift.drifted.length} drifted, ${knowledge.drift.overdue.length} overdue`);
          break;
        case "local.waivers":
          observe(waivers.filter((w) => w.daysRemaining !== null && w.daysRemaining < 0).map((w) => `EXPIRED ${w.file}`));
          for (const w of waivers) actual.notes.push(`${w.metric}: to ${w.raiseTo}, ${w.daysRemaining} day(s) remaining, approver ${w.approver?.["evidence-level"] ?? "unknown"}`);
          break;
        case "local.ratchet-file":
          observe(ratchetNotes, { degradeTo: "none" });
          break;
        case "local.ci-workflow-shape":
          observe(wf ? wfNotes : ["workflow file missing"], { degradeTo: "none" });
          if (m.id === "ci.coverage-scope") actual.notes.push("skipped counts as satisfied ONLY for a proven docs-only diff (job-level if); the required check itself never skips");
          break;
        case "local.action-pins":
          observe(wf ? wfNotes.filter((n) => /unpinned/.test(n)) : ["workflow file missing"], { degradeTo: "none" });
          break;
        case "local.codeowners-static":
          observe(coNotes, { degradeTo: "advisory" });
          actual.notes.push(`${coLive} live owner line(s)`);
          break;
        case "local.agent-hooks-wired":
          observe(hookNotes, { degradeTo: "none" });
          break;
        case "local.self-verification":
          actual.evidence = { kind: selfVerification.kind, probe: m.evidenceProbe, observedAt: selfVerification.kind === "observed" ? observedAt : null };
          actual.notes.push(selfVerification.detail);
          if (selfVerification.kind === "observed" && !selfVerification.green) actual.effect = "none";
          break;
        case "remote.branch-protection":
        case "remote.required-checks-binding":
        case "remote.codeowners-errors":
        case "remote.agent-identity":
        case "remote.ledger-pointers":
        case "remote.workflow-protections": {
          const r = remote?.[m.evidenceProbe];
          if (!r) {
            actual.evidence = { kind: "unknown", probe: m.evidenceProbe, observedAt: null };
            actual.notes.push(o.remote ? "probe did not run" : "offline: run doctor --remote (read-only host queries) — unknown, never green");
          } else {
            actual.evidence = { kind: r.kind, probe: m.evidenceProbe, observedAt: r.kind === "observed" ? observedAt : null };
            actual.notes.push(...r.notes);
            if (r.effect) actual.effect = r.effect;
            if (r.bypassableBy) actual.bypassableBy = r.bypassableBy;
          }
          if (m.id === "governance.codeowners" && coNotes.some((n) => /approver/.test(n))) actual.effect = "advisory";
          break;
        }
        case "manual.cold-load":
          actual.notes.push("declared until harness/scripts/cold-load-check.mjs has run (point-in-time)");
          break;
        default:
          break;
      }
      if (m.evidenceProbe === "local.hooks-path" && (m.id === "local-git.pre-push-gates" || m.id === "local-git.hooks-path")) actual.notes.push("defeated by --no-verify / -c core.hooksPath= / editing the tracked hook — speed bump, never a wall");
    }
    return { id: m.id, title: m.title, lifecycle: m.lifecycle, state, reason, targets: m.targets, intended: m.intended, actual };
  });

  // ---- predicates, per target
  const required = new Set(intent.policy.floors["strict-predicates"]);
  /** @type {Record<string, { definition: string, required: boolean, perTarget: Record<string, { met: boolean | "unknown", failing: string[] }> }>} */
  const predicates = {};
  for (const p of STRICT_PREDICATES) {
    /** @type {Record<string, { met: boolean | "unknown", failing: string[] }>} */
    const perTarget = {};
    for (const target of intent.targets) {
      const relevant = rows.filter((r) => r.targets.includes(target) || r.targets.length === 0);
      let met = true;
      /** @type {string[]} */
      const failing = [];
      /** @type {string[]} */
      const unknown = [];
      if (p === "remote-wall") {
        for (const r of relevant.filter((x) => graph.strictPredicates["remote-wall"].mechanisms.includes(x.id) && x.state !== "omitted")) {
          const ok = r.actual.effect === "blocking" && ["ci", "repository", "organization"].includes(r.actual.plane) && actorRank(r.actual.bypassableBy) >= actorRank("repo-admin");
          if (!ok) failing.push(r.id);
          if (r.actual.evidence.kind === "unknown") unknown.push(r.id);
        }
      } else if (p === "evidence-fresh") {
        for (const r of relevant.filter((x) => x.actual.evidence.probe.startsWith("remote.") && x.state === "installed")) if (r.actual.evidence.kind !== "observed") failing.push(r.id);
      } else if (p === "self-verification-green") {
        if (!(selfVerification.kind === "observed" && selfVerification.green)) failing.push(selfVerification.kind === "observed" ? "harness.self-verification (red)" : "harness.self-verification (not observed)");
      } else if (p === "topology-resolved") {
        for (const [k, v] of Object.entries(intent.topology)) if (v === "unknown") failing.push(`topology.${k}`);
      } else if (p === "no-conflicts") {
        for (const r of relevant) if (r.state === "conflict") failing.push(r.id);
      }
      if (failing.length) met = false;
      perTarget[target] = { met: met ? (unknown.length ? "unknown" : true) : false, failing };
      if (met && unknown.length) perTarget[target].met = "unknown";
    }
    predicates[p] = { definition: PREDICATE_DEFINITIONS[p], required: required.has(p), perTarget };
  }

  const report = {
    schema: "sisu.doctor/1",
    generator: GENERATOR_VERSION,
    project: {
      name: intent.product.name,
      profile: intent.profile,
      targets: intent.targets,
      packs: intent.packs,
      manifestGenerator: manifest?.generator ?? null,
      intentHashMatches: manifest ? manifest.intentHash === graph.manifest.intentHash : null,
    },
    rows,
    predicates,
    knowledge: knowledge?.drift
      ? { loop: knowledge.drift.loop, active: knowledge.drift.active, candidates: knowledge.drift.candidates, staleCandidates: knowledge.drift.staleCandidates, promotionRate: knowledge.drift.promotionRate, drifted: knowledge.drift.drifted.map((d) => d.id), overdue: knowledge.drift.overdue.map((d) => d.id), killCriteria: knowledge.drift.kill, budget: knowledge.index?.budget ?? [] }
      : { error: knowledge?.error ?? "unavailable" },
    waivers,
    detected: detectedRows,
    owned,
    volatile: { observedAt, durationMs: Date.now() - started, machine: { platform: process.platform, node: process.versions.node, host: hostname() } },
  };
  const strictUnmet = Object.entries(predicates).filter(([, p]) => p.required && Object.values(p.perTarget).some((t) => t.met !== true));
  return { report, strictUnmet, exitCode: o.strict && strictUnmet.length ? 1 : 0 };
}

function conflictAffects(mechanismId, path) {
  if (path.startsWith(".github/workflows/")) return mechanismId.startsWith("ci.");
  if (path === ".github/CODEOWNERS") return mechanismId === "governance.codeowners" || mechanismId === "governance.gate-checker-ownership";
  if (path === ".claude/settings.json" || path.startsWith("harness/agent-hooks/")) return mechanismId.startsWith("agent-hooks.");
  if (path === "CLAUDE.md" || path === "AGENTS.md" || path.startsWith(".claude/agents/")) return mechanismId === "harness.role-dispatch-map" || mechanismId.startsWith("governance.autonomy") || mechanismId === "governance.oracle-integrity";
  if (path.startsWith("harness/")) return mechanismId.startsWith("harness.");
  return false;
}

/**
 * Human table rendering.
 * @param {any} report @param {{ strictUnmet?: any[] }} [opts]
 */
export function renderDoctor(report, opts = {}) {
  const strictUnmet = opts.strictUnmet ?? [];
  const L = [];
  L.push(`sisu doctor — ${report.project.name} (${report.project.profile}; targets ${report.project.targets.join(", ")}; packs ${report.project.packs.join(", ")}) generator ${report.generator}${report.project.manifestGenerator && report.project.manifestGenerator !== report.generator ? ` (manifest from ${report.project.manifestGenerator} — run upgrade)` : ""}`);
  if (report.project.intentHashMatches === false) L.push("! sisu.yaml changed since the last emit — run `sisu emit`");
  L.push("");
  L.push("mechanism                                  | intended                                   | actual in this setup                                            | evidence");
  L.push("-------------------------------------------|--------------------------------------------|-----------------------------------------------------------------|------------------");
  for (const r of report.rows) {
    const t = (x) => `${x.effect}/${x.plane}/by:${x.bypassableBy}${x.failMode !== "n/a" ? `/${x.failMode}` : ""}`;
    const st = r.state === "installed" ? "" : ` [${r.state}${r.reason ? `: ${r.reason}` : ""}]`;
    const ev = r.actual.evidence.kind + (r.actual.evidence.observedAt ? ` ${r.actual.evidence.observedAt.slice(0, 10)}` : "");
    L.push(`${(r.id + (r.lifecycle !== "stable" ? ` (${r.lifecycle})` : "")).padEnd(43)}| ${t(r.intended).padEnd(43)}| ${(t(r.actual) + st).slice(0, 64).padEnd(64)}| ${ev}`);
    for (const n of r.actual.notes) L.push(`${"".padEnd(43)}|   · ${n}`);
  }
  L.push("");
  L.push("strict predicates:");
  for (const [p, v] of Object.entries(report.predicates)) {
    const per = Object.entries(v.perTarget).map(([t, x]) => `${t}: ${x.met === true ? "met" : x.met === "unknown" ? "UNKNOWN" : "UNMET"}${x.failing.length ? ` (${x.failing.join(", ")})` : ""}`).join("; ");
    L.push(`  ${v.required ? "*" : " "} ${p.padEnd(26)} ${per}`);
  }
  L.push("");
  const k = report.knowledge;
  if (k && !k.error) L.push(`knowledge loop: ${k.loop} — ${k.active} active, ${k.candidates} candidate (${k.staleCandidates} stale), promotion rate ${k.promotionRate === null ? "n/a" : (k.promotionRate * 100).toFixed(0) + "%"}; drifted ${k.drifted.length}, overdue ${k.overdue.length}`);
  else L.push(`knowledge loop: ${k?.error ?? "unavailable"}`);
  for (const w of report.waivers) L.push(`waiver ${w.metric}: to ${w.raiseTo}, ${w.daysRemaining} day(s) remaining (${w.approver?.["evidence-level"] ?? "unknown"})`);
  const stale = report.detected.filter((d) => d.state === "stale" || d.state === "missing");
  L.push(`detected findings: ${report.detected.length} checked, ${stale.length} stale${stale.length ? ` (${stale.map((s) => s.id).join(", ")})` : ""}`);
  const bad = report.owned.filter((o) => o.state !== "ok");
  L.push(`owned paths: ${report.owned.length} checked, ${bad.length} differ${bad.length ? ` (${bad.map((b) => b.path).join(", ")})` : ""}`);
  if (strictUnmet.length) L.push(`\nSTRICT: ${strictUnmet.length} required predicate(s) unmet or unknown: ${strictUnmet.map(([p]) => p).join(", ")}`);
  L.push(`\n(observed ${report.volatile.observedAt}; local rows are this machine; remote rows are unknown unless --remote ran)`);
  return L.join("\n");
}
