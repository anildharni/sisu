// Measurement identity (ratchet.measurement-identity). A baseline is meaningless
// without the recorded command, config and scope that produced it, so every
// metric stores a DECLARED identity and its hash. The hash covers: argv, cwd,
// scope, the content of each declared config file, and the lockfile content.
// It is PARTIAL by construction — plugin versions, `extends` chains and anything
// the tool reads that is not declared are outside it — and every consumer says so.
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { sha256 } from "./hash.mjs";

/**
 * @typedef {{ argv: string[], cwd: string, "config-files": string[], scope: string[], lockfile: string | null }} Identity
 */

/** Expand a simple `*` glob in the LAST path segment only (configs live at known places). */
export function expandConfig(repoRoot, pattern) {
  if (!pattern.includes("*")) return existsSync(join(repoRoot, ...pattern.split("/"))) ? [pattern] : [];
  const parts = pattern.split("/");
  const last = parts.pop() ?? "";
  const dir = join(repoRoot, ...parts);
  if (!existsSync(dir)) return [];
  const re = new RegExp("^" + last.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$");
  return readdirSync(dir)
    .filter((f) => re.test(f))
    .map((f) => [...parts, f].join("/"))
    .sort();
}

/**
 * Compute the identity hash for a metric in a repository.
 * @param {string} repoRoot
 * @param {Identity} identity
 * @returns {{ hash: string, resolvedConfigFiles: string[], lockfileHash: string | null }}
 */
export function identityHash(repoRoot, identity) {
  const resolved = [];
  for (const pattern of identity["config-files"] ?? []) resolved.push(...expandConfig(repoRoot, pattern));
  const unique = [...new Set(resolved)].sort();
  const parts = ["argv=" + JSON.stringify(identity.argv), "cwd=" + (identity.cwd ?? "."), "scope=" + JSON.stringify([...(identity.scope ?? ["."])].sort())];
  for (const f of unique) {
    const full = join(repoRoot, ...f.split("/"));
    const content = statSync(full).isFile() ? readFileSync(full) : Buffer.from("<dir>");
    parts.push(`config:${f}=` + sha256(content));
  }
  let lockfileHash = null;
  if (identity.lockfile) {
    const full = join(repoRoot, ...identity.lockfile.split("/"));
    if (existsSync(full)) {
      lockfileHash = sha256(readFileSync(full));
      parts.push(`lockfile:${identity.lockfile}=` + lockfileHash);
    } else {
      parts.push(`lockfile:${identity.lockfile}=<absent>`);
    }
  }
  return { hash: "sha256:" + sha256(parts.join("\n")) + ";partial", resolvedConfigFiles: unique, lockfileHash };
}
