// Committed target constants, keyed by target contract version. Emitters read
// ONLY from here — never from an installed tool — so the same commit emits the
// same bytes on every machine (emitter purity). Each constant is dated to the
// primary source it was verified against; re-verify before bumping a contract.
export const TARGETS = Object.freeze({
  "claude-code": Object.freeze({
    contract: "2.1",
    verifiedAgainst: "Claude Code 2.1.x docs, 2026-08-21",
    rootFile: "CLAUDE.md",
    agentsDir: ".claude/agents",
    settingsFile: ".claude/settings.json",
    localSettingsOverlay: ".claude/settings.local.json",
    configDirEnv: "CLAUDE_CONFIG_DIR",
    projectDirEnv: "CLAUDE_PROJECT_DIR",
    hookProtocol: Object.freeze({ stdin: "json", allowExit: 0, blockExit: 2, defaultTimeoutSeconds: 600 }),
    hookEvents: Object.freeze(["PreToolUse", "PostToolUse", "SessionStart"]),
    // Documented subagent frontmatter table (no official JSON schema exists —
    // the emitted conformance validator encodes THIS table and is labelled detective).
    agentFrontmatter: Object.freeze({
      required: Object.freeze(["name", "description"]),
      optional: Object.freeze(["tools", "disallowedTools", "model", "permissionMode", "maxTurns", "skills", "mcpServers"]),
      models: Object.freeze(["sonnet", "opus", "haiku", "inherit"]),
    }),
    modelTier: Object.freeze({ inherit: "inherit", fast: "sonnet", strong: "opus" }),
    capabilityTools: Object.freeze({
      "read-repo": Object.freeze(["Read", "Grep", "Glob", "Bash"]),
      "execute-oracles": Object.freeze(["Bash"]),
      "modify-code": Object.freeze(["Edit", "Write"]),
      "write-knowledge": Object.freeze(["Bash"]),
      "spawn-agents": Object.freeze(["Agent"]),
      network: Object.freeze(["WebFetch", "WebSearch"]),
      "mutate-governance": Object.freeze([]),
    }),
    // Tools denied to any role lacking the capability (omission upgrades privilege).
    capabilityDenies: Object.freeze({
      "modify-code": Object.freeze(["Edit", "Write", "NotebookEdit"]),
      "spawn-agents": Object.freeze(["Agent"]),
      network: Object.freeze(["WebFetch", "WebSearch"]),
    }),
    agentsMdAutoLoad: "needs-import-shim",
    agentsMdShim: "@AGENTS.md",
    eagerBudgetBytes: 24 * 1024,
  }),
  "agents-md": Object.freeze({
    contract: "1",
    verifiedAgainst: "OpenAI Codex AGENTS.md guide + source, 2026-08-21",
    rootFile: "AGENTS.md",
    rolesDir: "harness/roles",
    combinedCapBytes: 32 * 1024,
    emittedCapBytes: 28 * 1024,
    eagerBudgetBytes: 28 * 1024,
    autoLoad: Object.freeze({
      codex: "observed",
      "github-copilot": "observed",
      cursor: "observed",
      amp: "observed",
      zed: "observed",
      windsurf: "observed",
      "gemini-cli": "needs-config",
      aider: "advisory",
      "claude-code": "needs-import-shim",
      other: "advisory",
    }),
  }),
});

export const TARGET_NAMES = Object.freeze(Object.keys(TARGETS));

/** Full-SHA pins for third-party actions used in the emitted workflow (ci.action-sha-pinning). */
export const ACTION_PINS = Object.freeze({
  // Resolved via `gh api repos/<owner>/<repo>/git/ref/tags/<tag>` on 2026-10-03.
  "actions/checkout": Object.freeze({ tag: "v5.0.0", sha: "08c6903cd8c0fde910a37f88322edcfb5dd907a8" }),
  "actions/setup-node": Object.freeze({ tag: "v5.0.0", sha: "a0853c24544627f65ddf259abe73b1d18a591444" }),
  "actions/setup-python": Object.freeze({ tag: "v6.0.0", sha: "e797f83bcb11b83ae66e0230d6156d7c80228e7c" }),
});

export const GITLEAKS_VERSION = "8.18.4";
