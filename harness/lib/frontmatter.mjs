// Markdown + YAML-frontmatter split/join, shared verbatim between the generator
// and emitted scripts. Uses the sisu-yaml subset (./yaml.mjs) — never a full
// YAML parser — so a file that parses here parses identically everywhere.
import { parseMapping, stringify, YamlError } from "./yaml.mjs";

/**
 * @typedef {{ data: Record<string, unknown> | null, body: string, hasFrontmatter: boolean }} Split
 */

/**
 * Split a markdown document into frontmatter data and body.
 * Frontmatter must start on line 1 with `---` and end with a `---` line.
 * CRLF is normalized to LF. A file without frontmatter returns data=null.
 * @param {string} text
 * @returns {Split}
 */
export function splitFrontmatter(text) {
  const src = text.replace(/\r\n?/g, "\n");
  if (!src.startsWith("---\n")) return { data: null, body: src, hasFrontmatter: false };
  const end = src.indexOf("\n---", 4);
  if (end === -1) throw new YamlError("unterminated frontmatter (missing closing ---)");
  const after = src.slice(end + 4);
  if (after !== "" && !after.startsWith("\n")) throw new YamlError("frontmatter closing --- must be on its own line");
  const yaml = src.slice(4, end + 1);
  const data = parseMapping(yaml);
  return { data, body: after.replace(/^\n/, ""), hasFrontmatter: true };
}

/**
 * Join frontmatter data and body into a markdown document (LF line endings).
 * @param {Record<string, unknown>} data
 * @param {string} body
 */
export function joinFrontmatter(data, body) {
  const yaml = stringify(data);
  const b = body.replace(/\r\n?/g, "\n");
  return `---\n${yaml}---\n${b.startsWith("\n") || b === "" ? b : "\n" + b}`.replace(/\n*$/, "\n");
}

export { YamlError };
