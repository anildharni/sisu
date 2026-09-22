// Behavioural pins for the agent-runtime hooks (emitted with them; runs in CI).
// All three hooks FAIL OPEN by design, so a silently disarmed hook looks exactly
// like a working one — these cases are the only thing that tells them apart.
// Each known bypass shape from the reference incidents is asserted here, and the
// fail-open paths are asserted too: they are load-bearing behaviour.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { decide as denyDecide } from "../agent-hooks/deny-tier0.mjs";
import { decide as gateDecide, REVIEW_TTL_MS } from "../agent-hooks/verification-gate.mjs";
import { decide as protectDecide } from "../agent-hooks/protect-owned-paths.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const hooksDir = join(here, "..", "agent-hooks");
const ALLOW = 0;
const BLOCK = 2;

/** Invoke a hook the way the agent runtime does: JSON on stdin, decision via exit code. */
function runHook(file, payload) {
  const r = spawnSync(process.execPath, [join(hooksDir, file)], { input: typeof payload === "string" ? payload : JSON.stringify(payload), encoding: "utf8" });
  return { code: r.status, stderr: r.stderr };
}

// ---------------- deny-tier0 ----------------
const BLOCKED = [
  "git push --no-verify",
  "git push origin main --no-verify",
  "git push --no-verify origin HEAD",
  "git -C /some/worktree push origin br --no-verify",
  "git -c core.hooksPath= push --no-verify",
  "git -c core.hooksPath=/dev/null push",
  "git --no-pager push --no-verify",
  'bash -c "git push --no-verify"',
  "sh -c 'cd repo && git push --no-verify'",
  'bash -c "sh -c \\"git push --no-verify\\""',
  "cd x && git push --no-verify",
  "git commit -m fix --no-verify",
  "git commit -n -m fix",
  "git config core.hooksPath /tmp/nothing",
  "FOO=1 git push --no-verify",
];
const ALLOWED = [
  "git push",
  "git push origin main",
  "git -C /some/worktree push origin br",
  "git -c color.ui=false push",
  "npm run something --no-verify",
  "git commit -m \"never use git push --no-verify\"",
  "git commit -m 'docs: explain --no-verify is Tier 0'",
  "echo 'git push --no-verify' > notes.txt",
  "cat <<'EOF'\ngit push --no-verify\nEOF",
  "git push -n origin main",
  "git config core.hooksPath harness/git-hooks",
  "node harness/scripts/setup-hooks.mjs",
  "git config --unset core.hooksPath",
  "ls -la",
];
for (const c of BLOCKED) test(`deny-tier0 BLOCKS: ${c}`, () => assert.ok(denyDecide(c), "expected a block reason"));
for (const c of ALLOWED) test(`deny-tier0 ALLOWS: ${c}`, () => assert.equal(denyDecide(c), null));

test("deny-tier0 end-to-end: exit codes and fail-open on malformed input", () => {
  assert.equal(runHook("deny-tier0.mjs", { tool_input: { command: "git push --no-verify" } }).code, BLOCK);
  assert.match(runHook("deny-tier0.mjs", { tool_input: { command: "git push --no-verify" } }).stderr, /Tier 0/);
  assert.equal(runHook("deny-tier0.mjs", { tool_input: { command: "git push" } }).code, ALLOW);
  assert.equal(runHook("deny-tier0.mjs", "not json").code, ALLOW);
  assert.equal(runHook("deny-tier0.mjs", {}).code, ALLOW);
  assert.equal(runHook("deny-tier0.mjs", { tool_input: {} }).code, ALLOW);
});

// ---------------- verification gate (pure decision with fake io) ----------------
function fakeIo(initialHash = "h1") {
  const store = new Map();
  let hash = initialHash;
  return {
    io: {
      stagedHash: () => hash,
      read: (dir) => store.get(dir) ?? {},
      write: (dir, s) => store.set(dir, s),
    },
    setHash: (h) => (hash = h),
    store,
  };
}
const CWD = process.platform === "win32" ? "C:\\repo" : "/repo";
const base = { cwd: CWD, sessionId: "s1", now: 1_000_000 };

test("gate: a commit whose staged content was never shown is BLOCKED", () => {
  const { io } = fakeIo();
  assert.match(gateDecide({ ...base, command: "git commit -m x", io }) ?? "", /has not been shown/);
});

test("gate: review in an EARLIER call, then commit, is ALLOWED and the review is consumed", () => {
  const { io } = fakeIo();
  assert.equal(gateDecide({ ...base, command: "git diff --cached", io }), null);
  assert.equal(gateDecide({ ...base, command: "git commit -m x", now: base.now + 1000, io }), null);
  assert.match(gateDecide({ ...base, command: "git commit -m y", now: base.now + 2000, io }) ?? "", /has not been shown/);
});

test("gate: the incident shape — stage, (status|diff --cached), commit in ONE call — is BLOCKED", () => {
  const { io } = fakeIo();
  assert.match(gateDecide({ ...base, command: "git add -A && git status --short && git commit -F msg.txt", io }) ?? "", /STAGES and COMMITS/);
  assert.match(gateDecide({ ...base, command: "git add . && git diff --cached && git commit -m x", io }) ?? "", /STAGES and COMMITS/);
  assert.match(gateDecide({ ...base, command: "git commit -am x", io }) ?? "", /STAGES and COMMITS/);
  assert.match(gateDecide({ ...base, command: "git commit --all -m x", io }) ?? "", /STAGES and COMMITS/);
});

test("gate: staging moved after the review → BLOCKED (content identity, not command shape)", () => {
  const f = fakeIo("h1");
  assert.equal(gateDecide({ ...base, command: "git diff --cached", io: f.io }), null);
  f.setHash("h2");
  assert.match(gateDecide({ ...base, command: "git commit -m x", now: base.now + 1, io: f.io }) ?? "", /has not been shown/);
});

test("gate: summary flags, pipes, redirects and pathspecs do not count as a review", () => {
  for (const c of ["git diff --cached --stat", "git diff --cached --name-only", "git diff --staged --quiet", "git diff --cached | head -5", "git diff --cached > out.txt", "git diff --cached -- src/x.js", "git status --short", "git diff"]) {
    const { io } = fakeIo();
    gateDecide({ ...base, command: c, io });
    assert.match(gateDecide({ ...base, command: "git commit -m x", now: base.now + 1, io }) ?? "", /has not been shown/, `after: ${c}`);
  }
  const { io } = fakeIo();
  gateDecide({ ...base, command: "git diff --cached 2>/dev/null", io }); // stderr redirect still shows the diff
  assert.equal(gateDecide({ ...base, command: "git commit -m x", now: base.now + 1, io }), null);
});

test("gate: mentions are not invocations; a commit hidden in bash -c is still seen", () => {
  const { io } = fakeIo();
  gateDecide({ ...base, command: "echo 'git diff --cached'", io });
  gateDecide({ ...base, command: "cat <<'EOF'\ngit diff --cached\nEOF", io });
  assert.match(gateDecide({ ...base, command: "git commit -m 'ran git diff --cached already'", now: base.now + 1, io }) ?? "", /has not been shown/);
  assert.match(gateDecide({ ...base, command: 'bash -c "git commit -m x"', io }) ?? "", /has not been shown/);
});

test("gate: a review from another session or older than the TTL does not count", () => {
  const a = fakeIo();
  gateDecide({ ...base, command: "git diff --cached", io: a.io });
  assert.match(gateDecide({ ...base, sessionId: "s2", command: "git commit -m x", now: base.now + 1, io: a.io }) ?? "", /has not been shown/);
  const b = fakeIo();
  gateDecide({ ...base, command: "git diff --cached", io: b.io });
  assert.match(gateDecide({ ...base, command: "git commit -m x", now: base.now + REVIEW_TTL_MS + 1, io: b.io }) ?? "", /has not been shown/);
});

test("gate: -C <path> routes review and commit to the same repo; a mentioned path does not misdirect", () => {
  const store = new Map();
  const io = { stagedHash: (dir) => `hash-of-${dir}`, read: (dir) => store.get(dir) ?? {}, write: (dir, s) => store.set(dir, s) };
  const wt = process.platform === "win32" ? "C:\\wt" : "/wt";
  assert.match(gateDecide({ ...base, command: `git -C ${wt} commit -m x`, io }) ?? "", /has not been shown/);
  assert.equal(gateDecide({ ...base, command: `git -C ${wt} diff --cached`, io }), null);
  assert.equal(gateDecide({ ...base, command: `git -C ${wt} commit -m x`, now: base.now + 1, io }), null);
  gateDecide({ ...base, command: "git diff --cached", io });
  assert.equal(gateDecide({ ...base, command: `git commit -m "see -C ${wt} for context"`, now: base.now + 2, io }), null);
});

test("gate: non-commit git commands pass; fail-open outside a repo and on malformed payloads", () => {
  const { io } = fakeIo();
  assert.equal(gateDecide({ ...base, command: "git status", io }), null);
  assert.equal(gateDecide({ ...base, command: "git log --oneline", io }), null);
  const noRepo = { stagedHash: () => null, read: () => ({}), write: () => {} };
  assert.equal(gateDecide({ ...base, command: "git commit -m x", io: noRepo }), null);
  assert.equal(runHook("verification-gate.mjs", "garbage").code, ALLOW);
  assert.equal(runHook("verification-gate.mjs", { tool_input: {} }).code, ALLOW);
});

test("gate end-to-end against a real throwaway repository", () => {
  const dir = mkdtempSync(join(tmpdir(), "sisu-gate-"));
  try {
    const g = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    g("init", "-q");
    g("config", "user.email", "t@example.com");
    g("config", "user.name", "t");
    writeFileSync(join(dir, "a.txt"), "hello\n");
    g("add", "a.txt");
    const payload = (command) => ({ tool_input: { command }, cwd: dir, session_id: "e2e-session" });
    assert.equal(runHook("verification-gate.mjs", payload("git commit -m first")).code, BLOCK);
    assert.equal(runHook("verification-gate.mjs", payload("git diff --cached")).code, ALLOW);
    assert.equal(runHook("verification-gate.mjs", payload("git commit -m first")).code, ALLOW);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------- protect-owned-paths ----------------
test("protect-owned-paths blocks build output and the manifest; allows project files; fails open", () => {
  assert.match(protectDecide("harness/scripts/ratchet.mjs", CWD) ?? "", /build output/);
  assert.match(protectDecide(join(CWD, "harness", "lib", "yaml.mjs"), CWD) ?? "", /build output/);
  assert.match(protectDecide("sisu.lock.json", CWD) ?? "", /manifest/);
  assert.equal(protectDecide("project/knowledge/candidate/x.md", CWD), null);
  assert.equal(protectDecide("overrides/rules/x.md", CWD), null);
  assert.equal(protectDecide("src/app.js", CWD), null);
  assert.equal(runHook("protect-owned-paths.mjs", { tool_input: { file_path: "harness/x.mjs" }, cwd: CWD }).code, BLOCK);
  assert.equal(runHook("protect-owned-paths.mjs", "nope").code, ALLOW);
});
