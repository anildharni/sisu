#!/usr/bin/env node
// sisu — agent-governance harness generator. Private, internal.
// Verbs: init · emit · doctor · upgrade · index · lint-canonical · compare
import { resolve as resolvePath } from "node:path";
import { parseInitArgs, init } from "../src/commands/init.mjs";
import { emit } from "../src/commands/emit.mjs";
import { doctor, renderDoctor } from "../src/commands/doctor.mjs";
import { upgrade } from "../src/commands/upgrade.mjs";
import { lintCanonical } from "../src/commands/lint-canonical.mjs";
import { compare } from "../src/commands/compare.mjs";
import { GENERATOR_VERSION } from "../src/manifest.mjs";

const USAGE = `sisu ${GENERATOR_VERSION} — agent-governance harness generator (private)

  sisu init [--name N --summary S --profile P --targets a,b --release-model M] [--packs node,python]
            [--default-branch main --integration-branch dev --approver @handle --agent-principal login]
            [--tier1-paths a,b] [--yes] [--no-oracles] [--non-interactive]
  sisu emit [--target <claude-code|agents-md>] [--out <dir>] [--scaffold]
  sisu doctor [--remote] [--strict] [--run-tests] [--format=json]
  sisu upgrade [--force]
  sisu index [--check]
  sisu lint-canonical
  sisu compare <path-to-repo-with-harness>

Everything emitted works with no sisu binary present; the CLI verbs are conveniences.`;

async function main() {
  const [verb, ...rest] = process.argv.slice(2);
  const o = parseInitArgs(rest);
  const repoRoot = resolvePath(typeof o.cwd === "string" ? o.cwd : process.cwd());
  switch (verb) {
    case "init":
      await init(repoRoot, o);
      return 0;
    case "emit":
      emit(repoRoot, { target: typeof o.target === "string" ? o.target : undefined, out: typeof o.out === "string" ? resolvePath(o.out) : undefined, scaffold: Boolean(o.scaffold) });
      return 0;
    case "doctor": {
      const json = o.format === "json" || rest.includes("--format=json");
      const { report, strictUnmet, exitCode } = doctor(repoRoot, { remote: Boolean(o.remote), strict: Boolean(o.strict), runTests: Boolean(o["run-tests"]) });
      process.stdout.write(json ? JSON.stringify(report, null, 2) + "\n" : renderDoctor(report, { strictUnmet }) + "\n");
      return exitCode;
    }
    case "upgrade":
      upgrade(repoRoot, { force: Boolean(o.force) });
      return 0;
    case "index": {
      const mod = await import("../assets/scripts/index.mjs");
      process.chdir(repoRoot);
      mod.main(rest);
      return 0;
    }
    case "lint-canonical":
      lintCanonical();
      return 0;
    case "compare": {
      const target = rest.find((a) => !a.startsWith("--"));
      if (!target) throw new Error("usage: sisu compare <path>");
      const r = compare(repoRoot, resolvePath(target));
      process.stdout.write(r.text + "\n");
      return 0;
    }
    case undefined:
    case "--help":
    case "-h":
    case "help":
      process.stdout.write(USAGE + "\n");
      return 0;
    default:
      throw new Error(`unknown verb ${verb}\n\n${USAGE}`);
  }
}

main().then(
  (code) => process.exit(code),
  (e) => {
    process.stderr.write(`sisu: ${e.message}\n`);
    process.exit(2);
  },
);
