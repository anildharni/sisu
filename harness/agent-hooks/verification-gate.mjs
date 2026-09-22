#!/usr/bin/env node
// PreToolUse hook (matcher: Bash) — the verification gate: a commit is allowed
// only when the index still hashes to a `git diff --cached` the agent was shown
// in an EARLIER tool call, in THIS session, within the TTL.
//
// Decides on CONTENT IDENTITY (sha256 of the staged patch), never on command
// shape: `git add X && git diff --cached && git commit` is ONE tool call, so the
// commit runs before the model can read a byte of the diff — a string-matching
// version of this hook allowed exactly that and fixed nothing.
//
// Evidence class: review-observation. The store lives in the OS temp dir, is
// writable by the same user, and proves presentation, not comprehension. It is
// UX, never proof; CI is the artifact-verification plane.
// Enforcement tuple: preventive · agent-runtime · bypassable-by workspace-write · FAIL-OPEN.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { allTexts, splitSegments, isGitInvocation, gitSubcommand, gitDashC, stripQuoted, readPayload } from "./shell-text.mjs";

export const REVIEW_TTL_MS = 30 * 60 * 1000;

const RE_DIFF_STAGED = /\bdiff\b[^|]*?(--cached|--staged)\b/;
const RE_BLINDING = /--(name-only|name-status|stat|numstat|shortstat|summary|quiet|compact-summary)\b|\s-q(\s|$)/;
const RE_PATHSPEC = /\s--\s+\S/;
// stdout redirected away (>, >>, 1>, &>) hides the diff; `2>…` only moves stderr and `>&2` still shows it.
const RE_REDIRECT = /(^|[^<>&\d])(1?>{1,2}|&>)\s*(?!&2\b|\/dev\/stderr\b)\S/;
const RE_COMMIT_ALL = /(?:^|\s)(?:-[A-Za-z]*a[A-Za-z]*|--all)(?=\s|$)/;
const RE_ADD = new RegExp(String.raw`\bgit(?:\.exe)?(?:\s+\S+)*?\s+add(\s|$)`);

const sha = (s) => createHash("sha256").update(s).digest("hex");

export function stateFile(repoDir) {
  return join(tmpdir(), `sisu-review-${sha(repoDir).slice(0, 16)}.json`);
}

function readState(file) {
  try {
    return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  } catch {
    return {};
  }
}

function writeState(file, state) {
  try {
    writeFileSync(file, JSON.stringify(state), "utf8");
  } catch {
    /* state is an optimisation, not a correctness requirement */
  }
}

/** sha256 of the staged patch in `dir`, or null when git fails (fail-open). */
export function stagedHash(dir) {
  try {
    const out = execFileSync("git", ["-C", dir, "diff", "--cached", "--no-color", "--no-ext-diff"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });
    return sha(out);
  } catch {
    return null;
  }
}

function repoDirFor(segment, cwd) {
  const c = gitDashC(segment); // flag must be unquoted; a path mentioned inside a message does not misdirect
  const dir = c ? (isAbsolute(c) ? c : resolve(cwd, c)) : cwd;
  try {
    return realpathSync(dir);
  } catch {
    return dir;
  }
}

/**
 * Pure decision over the parsed command.
 * @param {{ command: string, cwd: string, sessionId: string, now: number, io: { stagedHash: (dir: string) => string | null, read: (dir: string) => any, write: (dir: string, s: any) => void } }} p
 * @returns {string | null} block reason or null
 */
export function decide(p) {
  const texts = allTexts(p.command);
  /** @type {Array<{ seg: string, sub: string | null, sep: string }>} */
  const gitSegs = [];
  for (const text of texts) {
    for (const seg of splitSegments(text)) {
      if (!isGitInvocation(seg.text)) continue;
      gitSegs.push({ seg: seg.text, sub: gitSubcommand(seg.text), sep: seg.sep });
    }
  }
  const commits = gitSegs.filter((g) => g.sub === "commit");
  if (!commits.length) {
    // Record reviews: a plain `git diff --cached` in command position, not blinded, not filtered, not redirected/piped away.
    for (const g of gitSegs) {
      if (g.sub !== "diff") continue;
      const s = stripQuoted(g.seg);
      if (!RE_DIFF_STAGED.test(s) || RE_BLINDING.test(s) || RE_PATHSPEC.test(s) || RE_REDIRECT.test(s) || g.sep === "|") continue;
      const dir = repoDirFor(g.seg, p.cwd);
      const h = p.io.stagedHash(dir);
      if (h) p.io.write(dir, { hash: h, sessionId: p.sessionId, at: p.now });
    }
    return null;
  }
  // A call that STAGES and COMMITS has shown nothing to anyone.
  const stagesHere = gitSegs.some((g) => g.sub === "add" && RE_ADD.test(stripQuoted(g.seg))) || commits.some((c) => RE_COMMIT_ALL.test(stripQuoted(c.seg).replace(/\bgit(?:\.exe)?(?:\s+\S+)*?\s+commit/, "git commit")));
  if (stagesHere) return "Blocked: this command STAGES and COMMITS in one call, so nothing has seen the staged content. Run `git diff --cached` in its own tool call, read it, then commit in the next call.";
  for (const c of commits) {
    const dir = repoDirFor(c.seg, p.cwd);
    const h = p.io.stagedHash(dir);
    if (!h) continue; // not a git repo / git failed: fail-open for this segment
    const st = p.io.read(dir);
    const fresh = st && st.hash === h && st.sessionId === p.sessionId && typeof st.at === "number" && p.now - st.at <= REVIEW_TTL_MS;
    if (!fresh) {
      return "Blocked: the staged content of this commit has not been shown to you in an earlier step of this session (or the index moved since). Run `git diff --cached` (no --stat/--name-only, no pathspec, no redirect) in its own tool call, read it, then commit.";
    }
    p.io.write(dir, {}); // consumed: the next commit needs its own review
  }
  return null;
}

async function main() {
  try {
    const payload = await readPayload();
    const command = payload?.tool_input?.command;
    if (typeof command !== "string") process.exit(0);
    const cwd = typeof payload.cwd === "string" ? payload.cwd : process.cwd();
    const sessionId = typeof payload.session_id === "string" ? payload.session_id : "no-session";
    const io = {
      stagedHash,
      read: (dir) => readState(stateFile(dir)),
      write: (dir, s) => writeState(stateFile(dir), s),
    };
    const reason = decide({ command, cwd, sessionId, now: Date.now(), io });
    if (reason) {
      process.stderr.write(reason + "\n");
      process.exit(2);
    }
    process.exit(0);
  } catch {
    process.exit(0); // fail-open
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
