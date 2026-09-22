// Shared helpers for the emitted maintenance scripts. Zero dependencies beyond
// node builtins and the vendored harness/lib. Nothing here needs sisu.
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import { parseMapping } from "../lib/yaml.mjs";
import { sha256 } from "../lib/hash.mjs";

export const INTENT_FILE = "sisu.yaml";
export const MANIFEST_FILE = "sisu.lock.json";
export const BASELINES_FILE = "project/quality-baselines.json";
export const WAIVERS_DIR = "project/waivers";
export const KNOWLEDGE_DIR = "project/knowledge";
export const LEDGER_DIR = "project/ledger/runs";

/** Walk up from `start` to the directory holding sisu.yaml. */
export function findRepoRoot(start = process.cwd()) {
  let dir = resolve(start);
  for (let i = 0; i < 40; i += 1) {
    if (existsSync(join(dir, INTENT_FILE))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`could not find ${INTENT_FILE} above ${start}`);
}

export function readText(path) {
  return readFileSync(path, "utf8").replace(/^﻿/, "").replace(/\r\n?/g, "\n");
}

export function writeText(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text.replace(/\r\n?/g, "\n"), "utf8");
}

export function readIntent(root) {
  return parseMapping(readText(join(root, INTENT_FILE)));
}

export function readManifest(root) {
  const p = join(root, MANIFEST_FILE);
  return existsSync(p) ? JSON.parse(readText(p)) : null;
}

export function readBaselines(root) {
  const p = join(root, ...BASELINES_FILE.split("/"));
  return existsSync(p) ? JSON.parse(readText(p)) : null;
}

export function writeBaselines(root, obj) {
  writeText(join(root, ...BASELINES_FILE.split("/")), JSON.stringify(obj, null, 2) + "\n");
}

/** Recursively list files (posix-relative, sorted). */
export function listFiles(dir, prefix = "") {
  if (!existsSync(dir)) return [];
  /** @type {string[]} */
  const out = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
    if (ent.isDirectory()) out.push(...listFiles(join(dir, ent.name), rel));
    else out.push(rel);
  }
  return out.sort();
}

const WIN_SCRIPT_WRAPPERS = new Set(["npm", "npx", "pnpm", "yarn", "node", "python", "python3", "pip", "ruff", "mypy", "pytest", "tsc", "eslint"]);

/** Quote one argv element for cmd.exe when a shell is unavoidable (Windows .cmd shims). */
function winQuote(a) {
  if (a === "") return '""';
  if (!/[\s"&|<>^()%!]/.test(a)) return a;
  return '"' + a.replace(/"/g, '\\"') + '"';
}

/**
 * Run an argv array (NEVER a shell string) and capture output. On Windows,
 * npm/npx-style .cmd shims need a shell; arguments are quoted individually.
 * @param {string[]} argv @param {{ cwd?: string, env?: Record<string, string>, timeoutMs?: number, input?: string }} [opts]
 * @returns {{ stdout: string, stderr: string, exitCode: number, error: string | null }}
 */
export function run(argv, opts = {}) {
  const [cmd, ...args] = argv;
  const useShell = process.platform === "win32" && WIN_SCRIPT_WRAPPERS.has(cmd);
  const common = { cwd: opts.cwd, env: { ...process.env, ...(opts.env ?? {}) }, encoding: /** @type {const} */ ("utf8"), maxBuffer: 256 * 1024 * 1024, timeout: opts.timeoutMs, input: opts.input };
  const res = useShell ? spawnSync([cmd, ...args].map(winQuote).join(" "), { ...common, shell: true }) : spawnSync(cmd, args, { ...common, shell: false });
  return {
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
    exitCode: typeof res.status === "number" ? res.status : res.error ? 127 : 1,
    error: res.error ? String(res.error.message ?? res.error) : null,
  };
}

export function git(root, args) {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

export function gitHead(root) {
  return git(root, ["rev-parse", "HEAD"]) ?? "no-commit";
}

/** Hash of the content of a set of repo-relative paths (files or whole directories). */
export function subjectHash(root, paths) {
  const parts = [];
  for (const p of [...paths].sort()) {
    const full = join(root, ...p.split("/"));
    if (!existsSync(full)) {
      parts.push(`${p}=<absent>`);
      continue;
    }
    if (statSync(full).isDirectory()) {
      for (const f of listFiles(full)) parts.push(`${p}/${f}=` + sha256(readFileSync(join(full, ...f.split("/")))));
    } else parts.push(`${p}=` + sha256(readFileSync(full)));
  }
  return "sha256:" + sha256(parts.join("\n"));
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function nowIso() {
  return new Date().toISOString();
}

/** Tiny argv parser: `--key value`, `--flag`, positionals. */
export function parseArgs(argv) {
  /** @type {Record<string, any>} */
  const opts = {};
  /** @type {string[]} */
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        opts[key] = opts[key] === undefined ? next : [].concat(opts[key], next);
        i += 1;
      } else opts[key] = true;
    } else positional.push(a);
  }
  return { opts, positional };
}

export function slugify(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
