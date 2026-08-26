// `sisu lint-canonical` — conformance validation of the canonical tree against
// SCHEMA.md (detective; sisu's own CI runs it). Also proves every rule's
// placeholders are known and every role's dispatch line is one line.
import { loadCanonical, CanonicalError } from "../canonical.mjs";
import { fill, PLACEHOLDERS } from "../compose.mjs";
import { GENERATOR_ROOT } from "../manifest.mjs";

export function lintCanonical(generatorRoot = GENERATOR_ROOT, io = {}) {
  const log = io.log ?? ((s) => console.log(s));
  const c = loadCanonical(generatorRoot);
  const dummy = Object.fromEntries(PLACEHOLDERS.map((p) => [p, "x"]));
  const problems = [];
  for (const r of c.rules) {
    try {
      fill(r.body, dummy);
    } catch (e) {
      problems.push(`${r.source}: ${/** @type {Error} */ (e).message}`);
    }
  }
  for (const r of c.roles) if (/\n/.test(r.dispatch)) problems.push(`${r.source}: dispatch must be one line`);
  const sections = new Set(c.rules.map((r) => r.section));
  for (const s of ["answer", "tiers", "oracle-integrity", "session", "dispatch", "knowledge", "enforcement"]) if (!sections.has(s)) problems.push(`no rule renders root section ${s}`);
  // every rule's enforced-by resolves (parseCanonicalFiles already checks); every mechanism with renders has a body
  if (problems.length) {
    for (const p of problems) log(`FAIL ${p}`);
    throw new CanonicalError("canonical", `${problems.length} problem(s)`);
  }
  log(`canonical OK: ${c.mechanisms.length} mechanisms, ${c.rules.length} rules, ${c.roles.length} roles`);
  return c;
}
