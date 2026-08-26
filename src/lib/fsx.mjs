// Filesystem helpers for the generator. Paths are handled as POSIX strings
// internally (the artifact graph is platform-independent); conversion happens
// only at the OS boundary here.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, chmodSync, lstatSync } from "node:fs";
import { dirname, join, relative, sep, resolve, isAbsolute } from "node:path";

/** @param {string} p */
export function toPosix(p) {
  return p.split(sep).join("/").replace(/\\/g, "/");
}

/** Join a repo root (OS path) with a POSIX-relative path. */
export function osPath(root, rel) {
  return join(root, ...rel.split("/"));
}

/** Read UTF-8 text with CRLF normalized to LF. */
export function readText(path) {
  return readFileSync(path, "utf8").replace(/^﻿/, "").replace(/\r\n?/g, "\n");
}

export function readJson(path) {
  return JSON.parse(readText(path));
}

/**
 * Write text with LF endings, creating parent directories. Mode bits are
 * applied where the OS honours them (no-op on Windows; recorded in the manifest
 * regardless so a Linux checkout gets them from the emitter, not from luck).
 * @param {string} path
 * @param {string} text
 * @param {{ mode?: "0644" | "0755" }} [opts]
 */
export function writeText(path, text, opts = {}) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text.replace(/\r\n?/g, "\n"), "utf8");
  if (opts.mode === "0755" && process.platform !== "win32") chmodSync(path, 0o755);
}

export function exists(path) {
  return existsSync(path);
}

export function isDir(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function isSymlink(path) {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Recursively list files under `dir`, returning sorted POSIX paths relative to `dir`.
 * @param {string} dir
 * @param {{ ignore?: (relPosix: string) => boolean }} [opts]
 */
export function listFiles(dir, opts = {}) {
  /** @type {string[]} */
  const out = [];
  if (!existsSync(dir)) return out;
  const walk = (d) => {
    for (const ent of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, ent.name);
      const rel = toPosix(relative(dir, full));
      if (opts.ignore && opts.ignore(rel)) continue;
      if (ent.isDirectory()) walk(full);
      else if (ent.isFile() || ent.isSymbolicLink()) out.push(rel);
    }
  };
  walk(dir);
  return out.sort();
}

/** Refuse paths that escape the repo root. Returns the resolved OS path. */
export function safeJoin(root, relPosix) {
  if (isAbsolute(relPosix) || /^[A-Za-z]:/.test(relPosix)) throw new Error(`absolute path not allowed: ${relPosix}`);
  const target = resolve(root, ...relPosix.split("/"));
  const rootResolved = resolve(root);
  const rel = relative(rootResolved, target);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error(`path escapes repository root: ${relPosix}`);
  return target;
}

/** Stable JSON: sorted keys, 2-space indent, trailing newline. */
export function stableJson(value) {
  return JSON.stringify(sortKeys(value), null, 2) + "\n";
}

/** @param {any} v @returns {any} */
export function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    /** @type {Record<string, any>} */
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = sortKeys(v[k]);
    return out;
  }
  return v;
}
