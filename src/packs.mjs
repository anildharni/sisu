// Stack packs ship WITH the generator. A pack declares oracle commands as argv
// arrays (never shell strings), each with its green condition, parser, metric
// direction, the config files that define its measurement identity, and the
// checker paths that must be gated. The ratchet machinery is stack-agnostic on
// top of this; nothing here is domain content.
import { textHash } from "../assets/lib/hash.mjs";

/**
 * @typedef {{ files: Set<string>, readJson: (p: string) => any, readText: (p: string) => string, intent: any }} DetectCtx
 * @typedef {{ id: string, title: string, kind: "invariant" | "ratchet", direction?: "ceiling" | "floor", argv: string[],
 *   cwd: string, parser?: string, parserArgs?: Record<string, any>, configFiles: string[], scope: string[],
 *   checkerPaths: string[], when: (ctx: DetectCtx) => boolean, fast: boolean, description: string }} Oracle
 * @typedef {{ id: string, title: string, detect: (ctx: DetectCtx) => boolean, lockfile: string | null,
 *   manifestFiles: string[], testConvention: string[], gateDefinitionPaths: string[], oracles: Oracle[],
 *   ci: { setup: "node" | "python" | "none", installArgv: string[] | null, versionFile?: string },
 *   contentHash: string }} Pack
 */

const has = (ctx, ...names) => names.some((n) => ctx.files.has(n));
const hasPrefix = (ctx, prefix) => [...ctx.files].some((f) => f.startsWith(prefix));
const hasGlob = (ctx, re) => [...ctx.files].some((f) => re.test(f));

function pkgJson(ctx) {
  try {
    return ctx.files.has("package.json") ? ctx.readJson("package.json") : null;
  } catch {
    return null;
  }
}

/** @type {Pack} */
export const nodePack = {
  id: "node",
  title: "Node.js / TypeScript",
  detect: (ctx) => ctx.files.has("package.json"),
  lockfile: "package-lock.json",
  manifestFiles: ["package.json", "package-lock.json"],
  testConvention: ["test/**", "tests/**", "**/__tests__/**", "**/*.test.*", "**/*.spec.*"],
  gateDefinitionPaths: ["package.json", "package-lock.json", "tsconfig.json", "tsconfig.*.json", "eslint.config.*", ".eslintrc*", "jest.config.*", "vitest.config.*", "playwright.config.*"],
  ci: { setup: "node", installArgv: ["npm", "ci"], versionFile: ".nvmrc" },
  oracles: [
    {
      id: "node.test", title: "Unit tests", kind: "invariant", argv: ["npm", "test"], cwd: ".", fast: false,
      configFiles: ["package.json", "jest.config.*", "vitest.config.*"], scope: ["."], checkerPaths: ["package.json"],
      when: (ctx) => {
        const p = pkgJson(ctx);
        const t = p?.scripts?.test;
        return typeof t === "string" && !/no test specified/.test(t);
      },
      description: "The project's own test command. Pass = exit 0.",
    },
    {
      id: "node.typecheck", title: "Type check", kind: "invariant", argv: ["npx", "tsc", "--noEmit"], cwd: ".", fast: true,
      configFiles: ["tsconfig.json"], scope: ["."], checkerPaths: ["tsconfig.json"],
      when: (ctx) => ctx.files.has("tsconfig.json"),
      description: "tsc --noEmit against tsconfig.json. Pass = exit 0.",
    },
    {
      id: "node.lint-errors", title: "Lint error count", kind: "ratchet", direction: "ceiling", argv: ["npx", "eslint", ".", "--format", "json"], cwd: ".", fast: true,
      parser: "eslint-json-errors", configFiles: ["eslint.config.js", "eslint.config.mjs", "eslint.config.cjs", ".eslintrc.json", ".eslintrc.cjs", ".eslintrc.js"], scope: ["."],
      checkerPaths: ["eslint.config.*", ".eslintrc*"],
      when: (ctx) => hasGlob(ctx, /^(eslint\.config\.(js|mjs|cjs|ts)|\.eslintrc(\.json|\.cjs|\.js)?)$/),
      description: "Sum of ESLint errorCount across files (warnings are not gated). Debt ceiling: may only fall.",
    },
    {
      id: "node.audit", title: "Dependency audit (high+)", kind: "invariant", argv: ["npm", "audit", "--audit-level", "high"], cwd: ".", fast: true,
      configFiles: ["package-lock.json"], scope: ["."], checkerPaths: ["package-lock.json"],
      when: (ctx) => ctx.files.has("package-lock.json"),
      description: "Absolute invariant: zero high/critical advisories. Never baselined.",
    },
  ],
  contentHash: "",
};

/** @type {Pack} */
export const pythonPack = {
  id: "python",
  title: "Python",
  detect: (ctx) => has(ctx, "pyproject.toml", "setup.py", "setup.cfg", "requirements.txt"),
  lockfile: null,
  manifestFiles: ["pyproject.toml", "requirements.txt", "setup.cfg"],
  testConvention: ["tests/**", "test/**", "**/test_*.py", "**/*_test.py"],
  gateDefinitionPaths: ["pyproject.toml", "setup.cfg", "requirements*.txt", "ruff.toml", ".ruff.toml", "mypy.ini", ".mypy.ini", "pytest.ini", "tox.ini"],
  ci: { setup: "python", installArgv: null, versionFile: ".python-version" },
  oracles: [
    {
      id: "python.test", title: "Unit tests (pytest)", kind: "invariant", argv: ["python", "-m", "pytest", "-q"], cwd: ".", fast: false,
      configFiles: ["pyproject.toml", "pytest.ini", "setup.cfg", "tox.ini"], scope: ["."], checkerPaths: ["pyproject.toml", "pytest.ini"],
      when: (ctx) => hasPrefix(ctx, "tests/") || hasPrefix(ctx, "test/") || hasGlob(ctx, /(^|\/)test_[^/]+\.py$/),
      description: "pytest over the project's tests. Pass = exit 0.",
    },
    {
      id: "python.lint-errors", title: "Lint finding count (ruff)", kind: "ratchet", direction: "ceiling", argv: ["python", "-m", "ruff", "check", ".", "--output-format", "json"], cwd: ".", fast: true,
      parser: "ruff-json-count", configFiles: ["pyproject.toml", "ruff.toml", ".ruff.toml"], scope: ["."], checkerPaths: ["pyproject.toml", "ruff.toml", ".ruff.toml"],
      when: (ctx) => has(ctx, "ruff.toml", ".ruff.toml") || (ctx.files.has("pyproject.toml") && /\[tool\.ruff/.test(safeText(ctx, "pyproject.toml"))),
      description: "Number of ruff findings. Debt ceiling: may only fall.",
    },
    {
      id: "python.type-errors", title: "Type error count (mypy)", kind: "ratchet", direction: "ceiling", argv: ["python", "-m", "mypy", "."], cwd: ".", fast: true,
      parser: "mypy-error-count", configFiles: ["pyproject.toml", "mypy.ini", ".mypy.ini", "setup.cfg"], scope: ["."], checkerPaths: ["pyproject.toml", "mypy.ini", ".mypy.ini"],
      when: (ctx) => has(ctx, "mypy.ini", ".mypy.ini") || (ctx.files.has("pyproject.toml") && /\[tool\.mypy/.test(safeText(ctx, "pyproject.toml"))),
      description: "mypy error count. Debt ceiling: may only fall.",
    },
  ],
  contentHash: "",
};

function safeText(ctx, p) {
  try {
    return ctx.readText(p);
  } catch {
    return "";
  }
}

/**
 * The declare-your-own pack: oracles come from the intent file
 * (`custom-oracles:`), each `{ id, title, kind, direction?, argv, cwd?, parser?, parserArgs?, config-files?, scope?, checker-paths?, fast? }`.
 * @param {any} intent
 * @returns {Pack}
 */
export function customPack(intent) {
  const decl = Array.isArray(intent?.["custom-oracles"]) ? intent["custom-oracles"] : [];
  /** @type {Oracle[]} */
  const oracles = decl.map((o, i) => {
    if (typeof o?.id !== "string" || !/^custom\.[a-z0-9-]+$/.test(o.id)) throw new Error(`custom-oracles[${i}].id must match custom.<name>`);
    if (!Array.isArray(o.argv) || o.argv.length === 0 || !o.argv.every((a) => typeof a === "string")) throw new Error(`custom-oracles[${i}].argv must be a non-empty string array (argv, not a shell string)`);
    if (!["invariant", "ratchet"].includes(o.kind)) throw new Error(`custom-oracles[${i}].kind must be invariant|ratchet`);
    if (o.kind === "ratchet" && !["ceiling", "floor"].includes(o.direction)) throw new Error(`custom-oracles[${i}].direction must be ceiling|floor`);
    if (o.kind === "ratchet" && typeof o.parser !== "string") throw new Error(`custom-oracles[${i}].parser is required for ratchets`);
    return {
      id: o.id,
      title: o.title ?? o.id,
      kind: o.kind,
      direction: o.direction,
      argv: o.argv,
      cwd: o.cwd ?? ".",
      parser: o.parser,
      parserArgs: o["parser-args"] ?? undefined,
      configFiles: o["config-files"] ?? [],
      scope: o.scope ?? ["."],
      checkerPaths: o["checker-paths"] ?? [],
      fast: o.fast ?? true,
      when: () => true,
      description: o.description ?? "Declared by the project in sisu.yaml.",
    };
  });
  return {
    id: "custom",
    title: "Declared oracles",
    detect: () => false,
    lockfile: null,
    manifestFiles: [],
    testConvention: Array.isArray(intent?.["test-convention"]) ? intent["test-convention"] : ["test/**", "tests/**"],
    gateDefinitionPaths: oracles.flatMap((o) => o.checkerPaths),
    ci: { setup: "none", installArgv: null },
    oracles,
    contentHash: "",
  };
}

export const BUILTIN_PACKS = Object.freeze({ node: nodePack, python: pythonPack });
export const PACK_IDS = Object.freeze(["node", "python", "custom"]);

/**
 * Resolve the packs named in the intent. Content hash = hash of the pack's
 * declared oracle table (what the manifest records as audit data).
 * @param {string[]} ids
 * @param {any} intent
 * @returns {Pack[]}
 */
export function resolvePacks(ids, intent) {
  return ids.map((id) => {
    const base = id === "custom" ? customPack(intent) : BUILTIN_PACKS[id];
    if (!base) throw new Error(`unknown pack ${id}; known: ${PACK_IDS.join(", ")}`);
    const table = base.oracles.map((o) => ({ id: o.id, kind: o.kind, direction: o.direction ?? null, argv: o.argv, cwd: o.cwd, parser: o.parser ?? null, configFiles: o.configFiles, scope: o.scope }));
    return { ...base, contentHash: "sha256:" + textHash(JSON.stringify({ id: base.id, table, gate: base.gateDefinitionPaths, test: base.testConvention })) };
  });
}

/**
 * Oracles applicable to a repo (per `when`). Pure given ctx.
 * @param {Pack[]} packs @param {DetectCtx} ctx
 */
export function applicableOracles(packs, ctx) {
  return packs.flatMap((p) => p.oracles.filter((o) => o.when(ctx)).map((o) => ({ ...o, pack: p.id })));
}
