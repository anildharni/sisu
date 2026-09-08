// Content hashing shared by the generator and emitted scripts.
// Text content is hashed after CRLF→LF normalization, so a checkout with
// autocrlf does not masquerade as an edit. Mode bits are hashed SEPARATELY and
// explicitly (see contentChecksum) because a hook that loses its executable bit
// is functionally changed. This is disclosed in the manifest schema.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

/** @param {string | Uint8Array} data */
export function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

/** @param {string} text */
export function normalizeLF(text) {
  return text.replace(/\r\n?/g, "\n");
}

/** Hash text after LF normalization. */
export function textHash(text) {
  return sha256(normalizeLF(text));
}

/**
 * Checksum string recorded in the manifest: `sha256:<hex>;mode:<0644|0755>`.
 * @param {string} text
 * @param {"0644" | "0755"} mode
 */
export function contentChecksum(text, mode) {
  return `sha256:${textHash(text)};mode:${mode}`;
}

/** Hash a file's bytes exactly (no normalization) — for lockfiles and binaries. */
export function fileBytesHash(path) {
  return sha256(readFileSync(path));
}

/** Short stable id from a string (first 12 hex chars of sha256). */
export function shortId(s) {
  return sha256(s).slice(0, 12);
}
