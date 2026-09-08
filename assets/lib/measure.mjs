// Measurement parsers shared by the generator (oracle verification at init) and
// the emitted ratchet script. A parser turns an oracle's output into a number or
// a verdict. Every parser FAILS LOUDLY on empty/unparseable output instead of
// returning 0 — a parser that returns zero on a crashed tool is a silent pass,
// which is the false-green shape this whole system exists to stop.

export class MeasureError extends Error {
  constructor(message) {
    super(message);
    this.name = "MeasureError";
  }
}

/**
 * @typedef {{ stdout: string, stderr: string, exitCode: number }} RunResult
 * @typedef {{ parser: string, parserArgs?: Record<string, any> }} ParserSpec
 */

/** Count a regex across stdout+stderr. */
function countMatches(text, re) {
  const m = text.match(re);
  return m ? m.length : 0;
}

/**
 * Parse an oracle result into a count.
 * @param {ParserSpec} spec
 * @param {RunResult} result
 * @returns {number}
 */
export function parseCount(spec, result) {
  const out = result.stdout ?? "";
  const err = result.stderr ?? "";
  const all = out + "\n" + err;
  switch (spec.parser) {
    case "eslint-json-errors": {
      const trimmed = out.trim();
      const start = trimmed.indexOf("[");
      if (start === -1) throw new MeasureError(`eslint produced no JSON report (exit ${result.exitCode}): ${err.slice(0, 300)}`);
      let report;
      try {
        report = JSON.parse(trimmed.slice(start));
      } catch (e) {
        throw new MeasureError(`eslint JSON report unparseable: ${e.message}`);
      }
      if (!Array.isArray(report)) throw new MeasureError("eslint report is not an array");
      let n = 0;
      for (const f of report) n += Number(f.errorCount ?? 0);
      return n;
    }
    case "tsc-error-count": {
      const n = countMatches(all, /error TS\d+/g);
      if (n === 0 && result.exitCode !== 0 && all.trim() === "") {
        throw new MeasureError(`tsc exited ${result.exitCode} with no output — tool missing or crashed`);
      }
      if (n === 0 && result.exitCode !== 0 && !/error TS/.test(all)) {
        throw new MeasureError(`tsc exited ${result.exitCode} without diagnostics: ${all.slice(0, 300)}`);
      }
      return n;
    }
    case "ruff-json-count": {
      const trimmed = out.trim();
      const start = trimmed.indexOf("[");
      if (start === -1) throw new MeasureError(`ruff produced no JSON (exit ${result.exitCode}): ${err.slice(0, 300)}`);
      let arr;
      try {
        arr = JSON.parse(trimmed.slice(start));
      } catch (e) {
        throw new MeasureError(`ruff JSON unparseable: ${e.message}`);
      }
      if (!Array.isArray(arr)) throw new MeasureError("ruff output is not an array");
      return arr.length;
    }
    case "mypy-error-count": {
      const summary = all.match(/Found (\d+) errors? in/);
      if (summary) return Number(summary[1]);
      if (/Success: no issues found/.test(all)) return 0;
      const n = countMatches(all, /: error: /g);
      if (n === 0 && result.exitCode !== 0) throw new MeasureError(`mypy exited ${result.exitCode} without a summary: ${all.slice(0, 300)}`);
      return n;
    }
    case "regex-count": {
      const pattern = spec.parserArgs?.pattern;
      if (typeof pattern !== "string") throw new MeasureError("regex-count needs parserArgs.pattern");
      if (all.trim() === "" && result.exitCode !== 0) throw new MeasureError(`tool exited ${result.exitCode} with no output`);
      return countMatches(all, new RegExp(pattern, "g"));
    }
    case "line-count": {
      if (result.exitCode !== 0) throw new MeasureError(`tool exited ${result.exitCode}: ${err.slice(0, 300)}`);
      return out.split("\n").filter((l) => l.trim() !== "").length;
    }
    case "number": {
      const m = all.trim().match(/-?\d+(\.\d+)?/);
      if (!m) throw new MeasureError(`expected a number in output, got: ${all.slice(0, 120)}`);
      return Number(m[0]);
    }
    default:
      throw new MeasureError(`unknown parser ${spec.parser}`);
  }
}

/** Verdict for an invariant (exit-zero) oracle. */
export function verdictOf(result) {
  return result.exitCode === 0 ? "pass" : "fail";
}

export const PARSERS = Object.freeze(["eslint-json-errors", "tsc-error-count", "ruff-json-count", "mypy-error-count", "regex-count", "line-count", "number", "file-count"]);
