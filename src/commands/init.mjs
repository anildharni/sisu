// `sisu init` — five questions (hard cap), everything else detected. Writes the
// intent file with provenance, verifies the detected oracles actually run (after
// exactly ONE uncounted safety confirmation, since a `test` script is
// repository-controlled code), measures ratchet baselines, resolves, emits, and
// writes SETUP.prompt.md for the user's own agent. No API key, no LLM call, ever.
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { existsSync } from "node:fs";
import { detect, headSha } from "../detect.mjs";
import { INTENT_FILE, PROFILES, RELEASE_MODELS, defaultPolicy, validateIntent, writeIntent } from "../intent.mjs";
import { TARGET_NAMES } from "../targets.mjs";
import { PACK_IDS } from "../packs.mjs";
import { resolve } from "../resolve.mjs";
import { loadInputs, writeGraph, GENERATOR_VERSION } from "../manifest.mjs";
import { run } from "../../assets/scripts/common.mjs";
import { identityHash } from "../../assets/lib/identity.mjs";
import { parseCount, MeasureError } from "../../assets/lib/measure.mjs";
import { writeText, stableJson } from "../lib/fsx.mjs";

/** @param {string[]} argv */
export function parseInitArgs(argv) {
  /** @type {Record<string, any>} */
  const o = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const k = a.slice(2);
    const v = argv[i + 1];
    if (v !== undefined && !v.startsWith("--")) {
      o[k] = v;
      i += 1;
    } else o[k] = true;
  }
  return o;
}

async function ask(rl, q, dflt) {
  const a = (await rl.question(`${q}${dflt !== undefined ? ` [${dflt}]` : ""}: `)).trim();
  return a === "" ? dflt : a;
}

/**
 * @param {string} repoRoot
 * @param {Record<string, any>} o
 * @param {{ log?: (s: string) => void }} [io]
 */
export async function init(repoRoot, o, io = {}) {
  const log = io.log ?? ((s) => console.log(s));
  if (existsSync(join(repoRoot, INTENT_FILE))) throw new Error(`${INTENT_FILE} already exists — this repo is initialized; use emit/upgrade/doctor`);
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  if (nodeMajor < 20) throw new Error(`maintenance runtime: Node >= 20 required, found ${process.versions.node}. A governance toolchain is never acquired silently — install Node and re-run.`);

  // ---- detection first (so the questions can propose defaults)
  const first = detect(repoRoot);
  const detectedStacks = Array.isArray(first.findings.stack.value) ? first.findings.stack.value : [];
  const interactive = !o["non-interactive"] && !o.yes && stdin.isTTY;
  const rl = interactive ? createInterface({ input: stdin, output: stdout }) : null;
  const q = async (key, question, dflt) => {
    if (o[key] !== undefined) return String(o[key]);
    if (!rl) {
      if (dflt === undefined) throw new Error(`--${key} is required in non-interactive mode`);
      return String(dflt);
    }
    return String(await ask(rl, question, dflt));
  };
  try {
    // The five questions — a hard cap.
    const name = await q("name", "1/5 Product name", undefined);
    const summary = await q("summary", "2/5 One paragraph: what it does and who uses it", undefined);
    const profile = await q("profile", `3/5 Team shape (${PROFILES.join("|")})`, "solo");
    const targetsRaw = await q("targets", `4/5 Harness target(s), comma-separated (${TARGET_NAMES.join("|")})`, "claude-code,agents-md");
    const releaseModel = await q("release-model", `5/5 Release model (${RELEASE_MODELS.join("|")})`, "trunk");
    const targets = targetsRaw.split(",").map((s) => s.trim()).filter(Boolean);
    const packs = o.packs ? String(o.packs).split(",").map((s) => s.trim()) : detectedStacks.length ? detectedStacks : ["custom"];
    for (const p of packs) if (!PACK_IDS.includes(p)) throw new Error(`unknown pack ${p}`);

    const defaultBranch = String(o["default-branch"] ?? (first.findings["default-branch"].value !== "unknown" ? first.findings["default-branch"].value : "main"));
    const integration = o["integration-branch"] ? String(o["integration-branch"]) : releaseModel === "integration-branch" ? "dev" : null;
    const approver = typeof o.approver === "string" ? o.approver : null;

    // ---- re-detect with the chosen packs (applicable oracles, gate paths)
    const { findings, at } = detect(repoRoot, { packs });
    const topology = {
      "agent-principal": typeof o["agent-principal"] === "string" ? o["agent-principal"] : "unknown",
      "approver-principal": approver ? approver.replace(/^@/, "") : "unknown",
      "agent-repo-role": "unknown",
      "same-principal": /** @type {any} */ ("unknown"),
    };
    if (topology["agent-principal"] !== "unknown" && topology["approver-principal"] !== "unknown") {
      topology["same-principal"] = topology["agent-principal"].toLowerCase() === topology["approver-principal"].toLowerCase();
    }
    const policy = defaultPolicy();
    if (typeof o["tier1-paths"] === "string") policy["tier1-paths"] = o["tier1-paths"].split(",").map((s) => s.trim()).filter(Boolean);
    policy.approver = approver;
    const intent = validateIntent({
      schema: 1,
      product: { name, summary },
      profile,
      targets,
      packs,
      release: { model: releaseModel, "default-branch": defaultBranch, "integration-branch": integration },
      policy,
      topology,
      detected: findings,
    });

    // ---- oracle verification: exactly ONE uncounted safety confirmation
    let inputs = loadInputs(repoRoot, undefined, { intent });
    let graph = resolve(inputs);
    const oracles = graph.oracles;
    /** @type {Record<string, any>} */
    const verification = {};
    /** @type {Record<string, any>} */
    const metrics = {};
    if (oracles.length && !o["no-oracles"]) {
      log("\nsisu will now RUN these detected oracle commands to verify they work and to measure ratchet baselines.");
      log("Each is repository-controlled code (a `test` script can be anything):");
      for (const or of oracles) log(`  ${or.id.padEnd(22)} ${or.argv.join(" ")}   (cwd: ${or.cwd})`);
      const ok = o.yes ? "y" : rl ? await ask(rl, "Run them? (y/N)", "N") : "N";
      if (!/^y/i.test(String(ok))) {
        log("Skipped. Oracles stay UNVERIFIED (recorded as such); ratchet baselines are 'unmeasured' and the CI gate fails loudly until you run: node harness/scripts/ratchet.mjs --rebaseline <id>");
      } else {
        for (const or of oracles) {
          log(`  running ${or.id} …`);
          const res = run(or.argv, { cwd: join(repoRoot, ...or.cwd.split("/")), timeoutMs: 15 * 60 * 1000 });
          if (or.kind === "ratchet") {
            try {
              const n = parseCount({ parser: /** @type {string} */ (or.parser), parserArgs: or.parserArgs }, res);
              verification[or.id] = { ran: true, verdict: "measured", value: n };
              log(`    measured ${n}`);
            } catch (e) {
              verification[or.id] = { ran: false, verdict: "unverified", reason: e instanceof MeasureError ? e.message : String(/** @type {Error} */ (e).message) };
              log(`    UNVERIFIED: ${verification[or.id].reason}`);
            }
          } else {
            const toolMissing = res.exitCode === 127 || /not found|not recognized|ENOENT|command not found/i.test(res.stderr) && res.stdout === "";
            verification[or.id] = toolMissing ? { ran: false, verdict: "unverified", reason: (res.error ?? res.stderr).slice(0, 200) } : { ran: true, verdict: res.exitCode === 0 ? "pass" : "fail", exitCode: res.exitCode };
            log(`    ${verification[or.id].verdict}${verification[or.id].reason ? `: ${verification[or.id].reason}` : ""}`);
          }
        }
      }
    }
    // Unverified oracles are dropped from the applicable set (an unverified oracle is worse than none) and recorded.
    const unverified = Object.entries(verification).filter(([, v]) => v.verdict === "unverified").map(([id]) => id);
    if (unverified.length) {
      const f = intent.detected["applicable-oracles"];
      f.value = /** @type {string[]} */ (f.value).filter((id) => !unverified.includes(id));
      // A deliberate narrowing of a detected fact carries its reason, so doctor reports "overridden", not "stale".
      f["override-reason"] = `init dropped oracles that could not be run on this machine: ${unverified.map((id) => `${id} (${String(verification[id].reason).split("\n")[0].slice(0, 80)})`).join("; ")}. Install the tool and re-add the id to re-enable.`;
    }
    intent.detected["oracle-verification"] = { value: Object.keys(verification).length ? verification : "not-run", evidence: Object.keys(verification).length ? "detected" : "unknown", at, "inputs-digest": "sha256:none;partial", inputs: [] };
    inputs = { ...inputs, intent };
    graph = resolve(inputs);

    // ---- ratchet baselines (measured, or "unmeasured")
    for (const or of graph.ratchets) {
      const identity = { argv: or.argv, cwd: String(or.cwd ?? "."), "config-files": or.configFiles, scope: or.scope, lockfile: graph.packs.find((p) => p.id === or.pack)?.lockfile ?? null };
      const measured = verification[or.id]?.verdict === "measured" ? verification[or.id].value : "unmeasured";
      metrics[or.id] = {
        title: or.title,
        direction: or.direction,
        baseline: or.direction === "ceiling" ? measured : measured === "unmeasured" || measured <= 0 ? "unmeasured" : measured,
        identity,
        "identity-hash": identityHash(repoRoot, identity).hash,
        parser: /** @type {string} */ (or.parser),
        ...(or.parserArgs ? { "parser-args": or.parserArgs } : {}),
        "measured-at": at,
      };
    }

    // ---- write everything: intent, baselines (if absent), artifacts + scaffold, manifest last
    writeIntent(repoRoot, intent);
    const baselinesPath = join(repoRoot, "project", "quality-baselines.json");
    if (!existsSync(baselinesPath)) {
      writeText(baselinesPath, stableJson({ schema: "sisu.baselines/1", _note: "Ceilings only fall, floors only rise. identity-hash binds argv/cwd/scope/config/lockfile (PARTIAL). Re-baseline explicitly: node harness/scripts/ratchet.mjs --rebaseline <id>. This file is a gated path.", metrics }));
    }
    // Scaffold FIRST (project/roles/domain-guide.md is a resolver input), then resolve
    // again from the committed state and emit — so the emitted tree equals a re-emit.
    const scaffolded = [];
    for (const s of graph.scaffold) {
      const full = join(repoRoot, ...s.path.split("/"));
      if (existsSync(full)) continue;
      writeText(full, s.content);
      scaffolded.push(s.path);
    }
    graph = resolve(loadInputs(repoRoot));
    const result = writeGraph(repoRoot, graph, { previous: null, writeScaffold: false });
    result.scaffolded = scaffolded;
    log(`\nsisu ${GENERATOR_VERSION}: emitted ${result.written.length} owned files, scaffolded ${result.scaffolded.length}, ${result.conflicts.length} conflict(s).`);
    for (const c of result.conflicts) log(`  CONFLICT ${c.path}: ${c.reason}`);
    const omitted = graph.catalog.filter((r) => r.state !== "installed");
    if (omitted.length) {
      log(`\n${omitted.length} mechanism(s) omitted with reason (doctor lists them all):`);
      for (const r of omitted) log(`  ${r.id}: ${r.state} — ${r.reason}`);
    }
    log(`\nNext:\n  1. Run SETUP.prompt.md in your agent (seeds candidate knowledge; never active).\n  2. node harness/scripts/setup-hooks.mjs   (per clone; speed bumps, not walls)\n  3. node harness/scripts/wire-remote.mjs   (prints the branch-protection mutations; you apply them)\n  4. sisu doctor [--remote]                  (which guardrails are walls, and against whom)`);
    return { intent, graph, result, verification };
  } finally {
    rl?.close();
  }
}
