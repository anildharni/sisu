// Knowledge engine core, shared by the emitted scripts and the generator's
// doctor. One file per fact, typed frontmatter, typed verification handle,
// typed edges. Graph semantics on a markdown substrate — no database.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { splitFrontmatter } from "./frontmatter.mjs";
import { sha256 } from "./hash.mjs";

export const KNOWLEDGE_DIR = "project/knowledge";
export const HANDLE_KINDS = ["oracle-id", "command", "test-name", "file-anchor", "none"];
export const STATUSES = ["candidate", "active", "stale", "superseded"];

/** Edge semantics: direction / expiry propagation / promotion check. */
export const EDGE_TYPES = Object.freeze({
  supersedes: { directed: true, propagates: false, promotionCheck: "target-exists" },
  contradicts: { directed: false, propagates: false, promotionCheck: "blocks" },
  "depends-on": { directed: true, propagates: true, promotionCheck: "target-active" },
  "verified-by": { directed: true, propagates: "reverify-on-subject-change", promotionCheck: "target-exists" },
  "applies-to": { directed: true, propagates: "subject-drift", promotionCheck: null },
  "caused-by": { directed: true, propagates: false, promotionCheck: null },
});

/** Imperative / governance-shaped openers the promotion lint rejects in ACTIVE facts. */
export const AUTHORITY_PATTERNS = [
  /^\s*(?:[-*]\s*)?(always|never|you must|agents? must|do not|don't|must not)\b/i,
  /^\s*(?:[-*]\s*)?tier\s*[012]\b/i,
  /\b(is|are) (now )?(allowed|permitted|forbidden|blocked) to\b/i,
  /\b(grant|grants|granting) (permission|access)\b/i,
  /\b(raise|lower|change|edit) (the )?(baseline|threshold|floor|ceiling|gate)\b/i,
  /\bskip (the )?(test|check|gate)s?\b/i,
];

/**
 * @typedef {{ id: string, title: string, status: string, appliesTo: string[], why: string, verification: any, edges: Array<{ type: string, target: string }>,
 *   created: string | null, verifiedAt: string | null, subjectHash: string | null, promotedBy: any, subjectKind: string | null, redObserved: string | null,
 *   tier: "candidate" | "active", file: string, body: string, raw: Record<string, any> }} Fact
 */

/** @param {Record<string, any>} fm @param {string} body @param {"candidate"|"active"} tier @returns {string[]} */
export function validateFact(fm, body, tier) {
  const errs = [];
  if (fm.kind !== "fact") errs.push("kind must be fact");
  if (typeof fm.id !== "string" || !/^[a-z0-9][a-z0-9-]{2,}$/.test(fm.id)) errs.push("id must be a lowercase slug (>= 3 chars)");
  if (typeof fm.title !== "string" || fm.title.length < 8) errs.push("title must be a short claim (>= 8 chars)");
  if (!STATUSES.includes(fm.status)) errs.push(`status must be one of ${STATUSES.join("|")}`);
  if (!Array.isArray(fm["applies-to"]) || !fm["applies-to"].every((p) => typeof p === "string")) errs.push("applies-to must be a list of paths/globs");
  const v = fm.verification;
  if (!v || typeof v !== "object") errs.push("verification is required (kind none is legal in candidate/)");
  else {
    if (!HANDLE_KINDS.includes(v.kind)) errs.push(`verification.kind must be one of ${HANDLE_KINDS.join("|")}`);
    if (v.kind === "oracle-id" && typeof v["oracle-id"] !== "string") errs.push("verification.oracle-id required");
    if (v.kind === "command" && !(Array.isArray(v.command) && v.command.every((a) => typeof a === "string"))) errs.push("verification.command must be an argv array");
    if (v.kind === "test-name" && typeof v["test-name"] !== "string") errs.push("verification.test-name required");
    if (v.kind === "file-anchor" && !(v["file-anchor"] && typeof v["file-anchor"].path === "string" && typeof v["file-anchor"].contains === "string")) errs.push("verification.file-anchor needs { path, contains }");
    if (v.expected !== undefined && !["pass", "fail"].includes(v.expected)) errs.push("verification.expected must be pass|fail");
  }
  const edges = fm.edges ?? [];
  if (!Array.isArray(edges)) errs.push("edges must be a list");
  else
    edges.forEach((e, i) => {
      if (!e || !EDGE_TYPES[e.type]) errs.push(`edges[${i}].type must be one of ${Object.keys(EDGE_TYPES).join("|")} (no 'related' edge exists)`);
      if (typeof e?.target !== "string") errs.push(`edges[${i}].target required`);
    });
  if (tier === "active") {
    if (fm.status === "candidate") errs.push("a file in active/ cannot have status candidate");
    if (typeof fm.why !== "string" || fm.why.length < 20) errs.push("why must explain the fact (>= 20 chars)");
    const handleOk = v && v.kind !== "none";
    const humanOk = fm["promoted-by"] && fm["promoted-by"]["evidence-level"] === "human" && typeof fm["promoted-by"].value === "string";
    if (!handleOk && !humanOk) errs.push("active facts need a verification handle (kind != none) OR promoted-by with evidence-level human");
    if (typeof fm["verified-at"] !== "string" && !humanOk) errs.push("active facts need verified-at");
    for (const line of (fm.title + "\n" + body).split("\n")) {
      for (const re of AUTHORITY_PATTERNS) if (re.test(line)) errs.push(`governance-shaped content rejected by the authority lint: ${JSON.stringify(line.trim().slice(0, 80))}`);
    }
    if (fm["subject-kind"] === "oracle" && !(edges.some((e) => e.type === "caused-by") && typeof fm["red-observed"] === "string")) {
      errs.push("a fact about an oracle needs a caused-by edge to its incident AND red-observed (when the handle was seen red on the motivating input)");
    }
  }
  return [...new Set(errs)];
}

/** @param {string} root @param {"candidate"|"active"} tier @returns {{ facts: Fact[], errors: Array<{ file: string, errors: string[] }> }} */
export function loadTier(root, tier) {
  const dir = join(root, ...KNOWLEDGE_DIR.split("/"), tier);
  /** @type {Fact[]} */
  const facts = [];
  const errors = [];
  if (!existsSync(dir)) return { facts, errors };
  for (const f of readdirSync(dir).sort()) {
    if (!f.endsWith(".md")) continue;
    const file = `${KNOWLEDGE_DIR}/${tier}/${f}`;
    let data, body;
    try {
      ({ data, body } = splitFrontmatter(readFileSync(join(dir, f), "utf8")));
    } catch (e) {
      errors.push({ file, errors: [`unparseable frontmatter: ${e.message}`] });
      continue;
    }
    if (!data) {
      errors.push({ file, errors: ["missing frontmatter"] });
      continue;
    }
    const errs = validateFact(data, body, tier);
    if (data.id && `${data.id}.md` !== f) errs.push(`file name must be ${data.id}.md`);
    if (errs.length) errors.push({ file, errors: errs });
    facts.push({
      id: String(data.id ?? f.replace(/\.md$/, "")),
      title: String(data.title ?? ""),
      status: String(data.status ?? tier),
      appliesTo: Array.isArray(data["applies-to"]) ? data["applies-to"] : [],
      why: String(data.why ?? ""),
      verification: data.verification ?? { kind: "none" },
      edges: Array.isArray(data.edges) ? data.edges : [],
      created: typeof data.created === "string" ? data.created : null,
      verifiedAt: typeof data["verified-at"] === "string" ? data["verified-at"] : null,
      subjectHash: typeof data["subject-hash"] === "string" ? data["subject-hash"] : null,
      promotedBy: data["promoted-by"] ?? null,
      subjectKind: typeof data["subject-kind"] === "string" ? data["subject-kind"] : null,
      redObserved: typeof data["red-observed"] === "string" ? data["red-observed"] : null,
      tier,
      file,
      body,
      raw: data,
    });
  }
  return { facts, errors };
}

/** Hash of the content of the fact's subject (applies-to files/dirs). Globs: `dir/**` hashes the dir. */
export function factSubjectHash(root, fact) {
  const parts = [];
  for (const p0 of [...fact.appliesTo].sort()) {
    const p = p0.replace(/\/\*\*?(\/\*)?$/, "");
    const full = join(root, ...p.split("/"));
    if (!existsSync(full)) {
      parts.push(`${p}=<absent>`);
      continue;
    }
    if (statSync(full).isDirectory()) {
      const walk = (d, rel) => {
        for (const ent of readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
          if (ent.name === "node_modules" || ent.name === ".git") continue;
          const r = rel ? `${rel}/${ent.name}` : ent.name;
          if (ent.isDirectory()) walk(join(d, ent.name), r);
          else parts.push(`${p}/${r}=` + sha256(readFileSync(join(d, ent.name))));
        }
      };
      walk(full, "");
    } else parts.push(`${p}=` + sha256(readFileSync(full)));
  }
  return "sha256:" + sha256(parts.join("\n"));
}

/**
 * Edge checks at promotion. Returns blocking problems.
 * @param {Fact} fact @param {Fact[]} active
 */
export function checkEdges(fact, active) {
  const problems = [];
  const byId = new Map(active.map((a) => [a.id, a]));
  for (const e of fact.edges) {
    const sem = EDGE_TYPES[e.type];
    if (!sem) continue;
    if (sem.promotionCheck === "blocks") problems.push(`declared contradiction with ${e.target} blocks promotion — resolve it (supersede the loser) first`);
    if (sem.promotionCheck === "target-active" && byId.get(e.target)?.status !== "active") problems.push(`depends-on ${e.target}, which is not an active fact`);
    if (sem.promotionCheck === "target-exists" && e.type === "supersedes" && !byId.has(e.target)) problems.push(`supersedes ${e.target}, which does not exist in active/`);
  }
  // symmetric contradiction declared on the OTHER side
  for (const a of active) for (const e of a.edges) if (e.type === "contradicts" && e.target === fact.id) problems.push(`${a.id} declares a contradiction with this fact — blocks promotion`);
  return problems;
}

/** Downstream facts invalidated when `id` goes stale (depends-on propagation, transitive). */
export function propagateStale(id, active) {
  const out = new Set();
  const queue = [id];
  while (queue.length) {
    const cur = queue.shift();
    for (const a of active) {
      if (a.edges.some((e) => e.type === "depends-on" && e.target === cur) && !out.has(a.id)) {
        out.add(a.id);
        queue.push(a.id);
      }
    }
  }
  return [...out];
}

/** Render INDEX.md: one line per active fact + materialized edges. Deterministic. */
export function renderIndex(active) {
  const live = active.filter((f) => f.status === "active" || f.status === "stale").sort((a, b) => (a.id < b.id ? -1 : 1));
  const L = ["# Knowledge index", "", "<!-- generated by harness/scripts/index.mjs — run it; do not edit. One line per active fact; load the fact file for detail. -->", ""];
  if (!live.length) L.push("_No active facts yet._");
  for (const f of live) {
    const h = f.verification?.kind ?? "none";
    L.push(`- \`${f.id}\`${f.status === "stale" ? " ⚠stale" : ""} — ${f.title} · applies-to: ${f.appliesTo.map((p) => `\`${p}\``).join(", ") || "—"} · handle: ${h} · verified: ${f.verifiedAt ?? "never"} · ${f.file}`);
  }
  const edges = live.flatMap((f) => f.edges.map((e) => `- \`${f.id}\` —${e.type}→ \`${e.target}\``)).sort();
  if (edges.length) L.push("", "## Edges", "", "<!-- declared only; no semantic inference. contradicts blocks promotion; depends-on propagates expiry. -->", "", ...edges);
  L.push("");
  return L.join("\n");
}

/**
 * Loop health against the pre-committed kill criteria.
 * @param {{ candidates: Fact[], active: Fact[] }} facts
 * @param {{ "min-candidates": number, "max-age-days": number, "min-promotion-rate": number, "window-days": number }} kill
 * @param {string} today ISO date
 */
export function loopHealth(facts, kill, today) {
  const day = (s) => (s ? Math.floor((Date.parse(today) - Date.parse(s)) / 86400000) : null);
  const staleCandidates = facts.candidates.filter((c) => (day(c.created) ?? 0) > kill["max-age-days"]).length;
  const inWindow = (d) => d !== null && d <= kill["window-days"];
  const createdInWindow = [...facts.candidates, ...facts.active].filter((f) => inWindow(day(f.created))).length;
  const promotedInWindow = facts.active.filter((f) => inWindow(day(f.promotedBy?.at ?? f.verifiedAt))).length;
  const rate = createdInWindow ? promotedInWindow / createdInWindow : null;
  let loop = "alive";
  if (facts.candidates.length + facts.active.length < kill["min-candidates"]) loop = "warming-up";
  else if (staleCandidates >= kill["min-candidates"] && (rate ?? 0) < kill["min-promotion-rate"]) loop = "DEAD (kill criterion met: retreat to a single human-curated tier)";
  return { candidates: facts.candidates.length, active: facts.active.length, staleCandidates, createdInWindow, promotedInWindow, promotionRate: rate, loop };
}
