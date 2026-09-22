#!/usr/bin/env node
// PreToolUse hook (matcher: Bash) — denies the spelled-out Tier-0 bypass shapes:
//   git push --no-verify            (also behind global options and inside sh -c)
//   git -c core.hooksPath=… <cmd>    (per-invocation hook override)
//   git config core.hooksPath <x>    unless x is the tracked harness/git-hooks dir
//   git commit --no-verify           (our pre-commit gate is the agent hook, but a
//                                    repo may add one; the flag is Tier 0 regardless)
// Contract (Claude Code): JSON on stdin; exit 0 allow; exit 2 block (stderr shown to the model).
// Enforcement tuple: preventive · agent-runtime · bypassable-by workspace-write · FAIL-OPEN.
// A fail-open hook that stops working looks exactly like one that works, so its behaviour
// is pinned by harness/tests/agent-hooks.test.mjs (executed in CI).
import { pathToFileURL } from "node:url";
import { allTexts, splitSegments, isGitInvocation, gitSubcommand, stripQuoted, readPayload } from "./shell-text.mjs";

// The flag followed by whitespace, `=`, a quote (closing a sh -c payload) or end of string.
const RE_NO_VERIFY = /(^|[\s'"])--no-verify(?=[\s'"=]|$)/;
// `-n` is --no-verify for `git commit` only (for push it is --dry-run).
const RE_COMMIT_N = /(^|\s)-n(?=[\s'"]|$)/;
const RE_HOOKSPATH_OVERRIDE = /\s-c\s+["']?core\.hooksPath(=|\s)/i;
const RE_CONFIG_HOOKSPATH = /\bconfig\b.*\bcore\.hooksPath\b\s+["']?([^\s"']*)/i;

/** @param {string} command @returns {string | null} block reason or null */
export function decide(command) {
  for (const text of allTexts(command)) {
    for (const seg of splitSegments(text)) {
      if (!isGitInvocation(seg.text)) continue;
      // Flags are matched with quoted spans blanked: `git commit -m "never use --no-verify"`
      // is prose about the rule. sh -c payloads are visited separately (allTexts), unquoted.
      const plain = stripQuoted(seg.text);
      const sub = gitSubcommand(plain);
      if (RE_HOOKSPATH_OVERRIDE.test(" " + plain)) return "Blocked: `git -c core.hooksPath=…` bypasses the tracked hooks (Tier 0). Fix the failing hook; do not route around it.";
      const noVerify = (sub === "push" || sub === "commit") && (RE_NO_VERIFY.test(plain) || (sub === "commit" && RE_COMMIT_N.test(plain)));
      if (noVerify) {
        return `Blocked: \`git ${sub} --no-verify\` is Tier 0 for agents. Fix the failing hook, do not bypass it. (Local hooks are speed bumps; CI is the wall — a push that skips them is still validated there, but the agent may not disable its own guardrails.)`;
      }
      if (sub === "config") {
        const m = seg.text.match(RE_CONFIG_HOOKSPATH);
        if (m && !/harness\/git-hooks\/?$/.test(m[1]) && !/--unset/.test(plain)) {
          return "Blocked: repointing core.hooksPath away from harness/git-hooks disables the tracked hooks (Tier 0). Use `node harness/scripts/setup-hooks.mjs`.";
        }
      }
    }
  }
  return null;
}

async function main() {
  try {
    const payload = await readPayload();
    const command = payload?.tool_input?.command;
    if (typeof command !== "string") process.exit(0);
    const reason = decide(command);
    if (reason) {
      process.stderr.write(reason + "\n");
      process.exit(2);
    }
    process.exit(0);
  } catch {
    process.exit(0); // fail-open: a guard that wedges the agent is worse than the bug it prevents
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
