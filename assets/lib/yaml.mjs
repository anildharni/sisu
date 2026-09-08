// sisu-yaml: a strict SUBSET of YAML, shared verbatim between the generator and
// every emitted repo-local script (directive 1: emitted output has no runtime
// dependency on sisu or on any npm package).
//
// Supported — and this list is the whole contract; see canonical/schema/SCHEMA.md:
//   - comments (`# …` at line start or after whitespace, outside quotes)
//   - block mappings (`key: value`, nested by indentation)
//   - block sequences (`- item`; `- key: value` starts a mapping item whose
//     continuation lines are indented exactly two more spaces)
//   - scalars: plain strings, "double-quoted" (JSON escapes), 'single-quoted'
//     ('' escapes), integers, decimals, true/false, null/~/empty
//   - flow sequences of scalars `[a, b, "c"]`, and the empty forms `[]` / `{}`
//   - block scalars `|`, `|-`, `>`, `>-`
// Everything else (anchors, aliases, tags, multi-document, complex keys,
// multi-line plain scalars, flow mappings with content) is a parse ERROR, never
// a silent approximation. Dates stay strings (no YAML 1.1 coercion).

export class YamlError extends Error {
  /** @param {string} message @param {number} [line] */
  constructor(message, line) {
    super(line ? `line ${line}: ${message}` : message);
    this.name = "YamlError";
    this.line = line;
  }
}

/** @typedef {{ indent: number, raw: string, content: string, blank: boolean, lineNo: number }} Line */

/** Strip a trailing comment, honouring quotes. */
function stripComment(s) {
  let q = null;
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (q) {
      if (c === q) q = null;
      else if (c === "\\" && q === '"') i += 1;
    } else if (c === '"' || c === "'") {
      q = c;
    } else if (c === "#" && (i === 0 || s[i - 1] === " " || s[i - 1] === "\t")) {
      return s.slice(0, i).trimEnd();
    }
  }
  return s.trimEnd();
}

/** @param {string} text @returns {Line[]} */
function tokenize(text) {
  const out = [];
  const src = text.replace(/\r\n?/g, "\n").split("\n");
  src.forEach((raw, i) => {
    if (raw.includes("\t") && /^\s*\t/.test(raw)) throw new YamlError("tabs are not allowed for indentation", i + 1);
    const indent = raw.length - raw.trimStart().length;
    const content = stripComment(raw.trimStart());
    out.push({ indent, raw, content, blank: content === "", lineNo: i + 1 });
  });
  return out;
}

const NUMBER_RE = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/;
const MAP_START_RE = /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s"'\[\]{}#&*!|>%@`,-][^:#]*?)\s*:(\s|$)/;

/** @param {string} s */
function unquote(s, lineNo) {
  if (s.startsWith('"')) {
    if (!s.endsWith('"') || s.length < 2) throw new YamlError("unterminated double-quoted string", lineNo);
    try {
      return JSON.parse(s.replace(/\n/g, "\\n"));
    } catch {
      throw new YamlError(`invalid escape in ${s}`, lineNo);
    }
  }
  if (s.startsWith("'")) {
    if (!s.endsWith("'") || s.length < 2) throw new YamlError("unterminated single-quoted string", lineNo);
    return s.slice(1, -1).replace(/''/g, "'");
  }
  return s;
}

/** Split a flow sequence body on commas, honouring quotes. */
function splitFlow(body, lineNo) {
  const items = [];
  let cur = "";
  let q = null;
  for (let i = 0; i < body.length; i += 1) {
    const c = body[i];
    if (q) {
      cur += c;
      if (c === q) q = null;
      else if (c === "\\" && q === '"') {
        cur += body[i + 1] ?? "";
        i += 1;
      }
    } else if (c === '"' || c === "'") {
      q = c;
      cur += c;
    } else if (c === "[" || c === "{") {
      throw new YamlError("nested flow collections are not supported", lineNo);
    } else if (c === ",") {
      items.push(cur.trim());
      cur = "";
    } else {
      cur += c;
    }
  }
  if (q) throw new YamlError("unterminated quote in flow sequence", lineNo);
  if (cur.trim() !== "" || items.length > 0) items.push(cur.trim());
  if (items.length && items[items.length - 1] === "") items.pop();
  return items;
}

/** @param {string} s @param {number} lineNo @returns {unknown} */
function parseScalar(s, lineNo) {
  const t = s.trim();
  if (t === "" || t === "~" || t === "null") return null;
  if (t === "true") return true;
  if (t === "false") return false;
  if (t === "[]") return [];
  if (t === "{}") return {};
  if (t.startsWith("[")) {
    if (!t.endsWith("]")) throw new YamlError("unterminated flow sequence", lineNo);
    return splitFlow(t.slice(1, -1), lineNo).map((x) => parseScalar(x, lineNo));
  }
  if (t.startsWith("{")) throw new YamlError("flow mappings with content are not supported", lineNo);
  if (t.startsWith("&") || t.startsWith("*") || t.startsWith("!")) {
    throw new YamlError("anchors, aliases and tags are not supported", lineNo);
  }
  if (t.startsWith('"') || t.startsWith("'")) return unquote(t, lineNo);
  if (NUMBER_RE.test(t)) return Number(t);
  // A plain scalar containing ": " (or ending in ":") is invalid YAML. Real
  // parsers reject it; permissive loaders drop the whole document silently —
  // that is how two agent files sat dead for six weeks in the reference repo.
  if (t.includes(": ") || t.endsWith(":")) {
    throw new YamlError(`plain scalar contains ": " — quote it: ${JSON.stringify(t)}`, lineNo);
  }
  return t;
}

/**
 * Parse a sisu-yaml document.
 * @param {string} text
 * @returns {unknown}
 */
export function parse(text) {
  const lines = tokenize(text);
  let pos = 0;

  const skipBlank = () => {
    while (pos < lines.length && lines[pos].blank) pos += 1;
  };

  /** @param {number} indent @param {string} style @param {number} lineNo */
  function parseBlockScalar(indent, style, lineNo) {
    const collected = [];
    let blockIndent = -1;
    while (pos < lines.length) {
      const l = lines[pos];
      if (l.raw.trim() === "") {
        collected.push("");
        pos += 1;
        continue;
      }
      if (l.indent <= indent) break;
      if (blockIndent === -1) blockIndent = l.indent;
      if (l.indent < blockIndent) throw new YamlError("block scalar line under-indented", l.lineNo);
      collected.push(l.raw.slice(blockIndent));
      pos += 1;
    }
    // trailing blank lines are chomping territory
    while (collected.length && collected[collected.length - 1] === "") collected.pop();
    let body;
    if (style.startsWith("|")) {
      body = collected.join("\n");
    } else {
      // folded: single newlines become spaces, blank lines become newlines
      body = "";
      for (let i = 0; i < collected.length; i += 1) {
        const cur = collected[i];
        if (i === 0) body = cur;
        else if (cur === "") body += "\n";
        else if (collected[i - 1] === "") body += cur;
        else body += " " + cur;
      }
    }
    if (blockIndent === -1 && collected.length === 0) return style.endsWith("-") ? "" : "\n";
    return style.endsWith("-") ? body : body + "\n";
  }

  /** @param {number} indent */
  function parseNode(indent) {
    skipBlank();
    const line = lines[pos];
    if (!line || line.indent < indent) return null;
    if (line.content === "-" || line.content.startsWith("- ")) return parseSeq(line.indent);
    return parseMap(line.indent);
  }

  /** @param {string} rest @param {number} indent @param {number} lineNo */
  function parseValueAfterKey(rest, indent, lineNo) {
    if (rest === "") {
      skipBlank();
      const next = lines[pos];
      if (next && next.indent > indent) return parseNode(next.indent);
      if (next && next.indent === indent && (next.content === "-" || next.content.startsWith("- "))) {
        return parseSeq(indent);
      }
      return null;
    }
    if (rest === "|" || rest === "|-" || rest === ">" || rest === ">-") return parseBlockScalar(indent, rest, lineNo);
    if (/^[|>]/.test(rest)) throw new YamlError(`unsupported block scalar header ${rest}`, lineNo);
    return parseScalar(rest, lineNo);
  }

  /** @param {number} indent @returns {Record<string, unknown>} */
  function parseMap(indent) {
    /** @type {Record<string, unknown>} */
    const obj = {};
    for (;;) {
      skipBlank();
      const line = lines[pos];
      if (!line || line.indent < indent) break;
      if (line.indent > indent) throw new YamlError("unexpected indentation", line.lineNo);
      if (line.content === "-" || line.content.startsWith("- ")) break;
      const m = MAP_START_RE.exec(line.content);
      if (!m) throw new YamlError(`expected "key: value", got ${JSON.stringify(line.content)}`, line.lineNo);
      const key = unquote(m[1].trim(), line.lineNo);
      if (typeof key !== "string") throw new YamlError("keys must be strings", line.lineNo);
      if (Object.prototype.hasOwnProperty.call(obj, key)) throw new YamlError(`duplicate key ${key}`, line.lineNo);
      const rest = line.content.slice(m[0].length).trim();
      pos += 1;
      obj[key] = parseValueAfterKey(rest, indent, line.lineNo);
    }
    return obj;
  }

  /** @param {number} indent @returns {unknown[]} */
  function parseSeq(indent) {
    const arr = [];
    for (;;) {
      skipBlank();
      const line = lines[pos];
      if (!line || line.indent < indent) break;
      if (line.indent > indent) throw new YamlError("unexpected indentation in sequence", line.lineNo);
      if (!(line.content === "-" || line.content.startsWith("- "))) break;
      const rest = line.content === "-" ? "" : line.content.slice(2).trim();
      pos += 1;
      if (rest === "") {
        skipBlank();
        const next = lines[pos];
        arr.push(next && next.indent > indent ? parseNode(next.indent) : null);
      } else if (MAP_START_RE.test(rest) && !rest.startsWith("[") && !rest.startsWith('"') && !rest.startsWith("'")) {
        // `- key: value` — the mapping begins at the column after "- ".
        lines.splice(pos, 0, { indent: indent + 2, raw: " ".repeat(indent + 2) + rest, content: rest, blank: false, lineNo: line.lineNo });
        arr.push(parseMap(indent + 2));
      } else if (rest === "|" || rest === "|-" || rest === ">" || rest === ">-") {
        arr.push(parseBlockScalar(indent, rest, line.lineNo));
      } else {
        arr.push(parseScalar(rest, line.lineNo));
      }
    }
    return arr;
  }

  skipBlank();
  if (pos >= lines.length) return null;
  if (lines[pos].content === "---") {
    pos += 1;
  }
  const root = parseNode(lines[pos]?.indent ?? 0);
  skipBlank();
  if (pos < lines.length) {
    const l = lines[pos];
    if (l.content === "---" || l.content === "...") throw new YamlError("multi-document streams are not supported", l.lineNo);
    throw new YamlError(`unexpected content ${JSON.stringify(l.content)}`, l.lineNo);
  }
  return root;
}

// Plain tokens may contain ":" (e.g. sha256:abc, 2026-01-01T00:00:00Z) as long as it is never followed by a space.
const PLAIN_SAFE_RE = /^[A-Za-z_][A-Za-z0-9_./@+:-]*$/;

/** @param {string} s */
function needsQuote(s) {
  if (s === "") return true;
  if (s !== s.trim()) return true;
  if (/^[-?:,\[\]{}#&*!|>'"%@`]/.test(s)) return true;
  if (s.includes(": ") || s.endsWith(":") || s.includes(" #") || s.includes("\n")) return true;
  if (s === "true" || s === "false" || s === "null" || s === "~" || NUMBER_RE.test(s)) return true;
  if (PLAIN_SAFE_RE.test(s)) return false;
  // Anything with other punctuation or spaces: quote unless it is a simple sentence.
  return !/^[A-Za-z0-9_][A-Za-z0-9 _.,;()/@+'=-]*$/.test(s);
}

/** @param {string} s */
function quote(s) {
  return JSON.stringify(s);
}

/**
 * Serialize a value as sisu-yaml. Deterministic: object keys are emitted in
 * insertion order (sort them first if you need canonical order).
 * @param {unknown} value
 * @param {{ indent?: number }} [opts]
 * @returns {string}
 */
export function stringify(value, opts = {}) {
  const indent = opts.indent ?? 0;
  const pad = " ".repeat(indent);

  /** @param {unknown} v @returns {string} */
  function scalar(v) {
    if (v === null || v === undefined) return "null";
    if (typeof v === "boolean") return v ? "true" : "false";
    if (typeof v === "number") {
      if (!Number.isFinite(v)) throw new YamlError("non-finite numbers are not representable");
      return String(v);
    }
    if (typeof v === "string") return needsQuote(v) ? quote(v) : v;
    throw new YamlError(`cannot serialize ${typeof v}`);
  }

  /** @param {string} key */
  function keyOut(key) {
    return needsQuote(key) || key.includes(" ") ? quote(key) : key;
  }

  /** @param {unknown} v @param {number} ind @returns {string[]} */
  function lines(v, ind) {
    const p = " ".repeat(ind);
    if (Array.isArray(v)) {
      if (v.length === 0) return [p + "[]"];
      const out = [];
      for (const item of v) {
        if (item !== null && typeof item === "object" && !Array.isArray(item)) {
          const inner = lines(item, ind + 2);
          if (inner.length === 0) out.push(p + "- {}");
          else {
            out.push(p + "- " + inner[0].slice(ind + 2));
            out.push(...inner.slice(1));
          }
        } else if (Array.isArray(item)) {
          if (item.length === 0) out.push(p + "- []");
          else {
            out.push(p + "-");
            out.push(...lines(item, ind + 2));
          }
        } else if (typeof item === "string" && item.includes("\n")) {
          out.push(p + "- |-");
          out.push(...item.replace(/\n$/, "").split("\n").map((l) => (l === "" ? "" : p + "  " + l)));
        } else {
          out.push(p + "- " + scalar(item));
        }
      }
      return out;
    }
    if (v !== null && typeof v === "object") {
      const entries = Object.entries(v);
      if (entries.length === 0) return [p + "{}"];
      const out = [];
      for (const [k, val] of entries) {
        if (val === undefined) continue;
        if (Array.isArray(val)) {
          if (val.length === 0) out.push(`${p}${keyOut(k)}: []`);
          else {
            out.push(`${p}${keyOut(k)}:`);
            out.push(...lines(val, ind + 2));
          }
        } else if (val !== null && typeof val === "object") {
          const inner = lines(val, ind + 2);
          if (inner.length === 1 && inner[0].trim() === "{}") out.push(`${p}${keyOut(k)}: {}`);
          else {
            out.push(`${p}${keyOut(k)}:`);
            out.push(...inner);
          }
        } else if (typeof val === "string" && val.includes("\n")) {
          const chomp = val.endsWith("\n") ? "|" : "|-";
          out.push(`${p}${keyOut(k)}: ${chomp}`);
          out.push(...val.replace(/\n$/, "").split("\n").map((l) => (l === "" ? "" : p + "  " + l)));
        } else {
          out.push(`${p}${keyOut(k)}: ${scalar(val)}`);
        }
      }
      return out;
    }
    return [p + scalar(v)];
  }

  return lines(value, indent).map((l) => (indent ? l : l)).join("\n") + "\n";
}

/** Convenience: parse and assert the root is a mapping. */
export function parseMapping(text) {
  const v = parse(text);
  if (v === null) return {};
  if (typeof v !== "object" || Array.isArray(v)) throw new YamlError("expected a mapping at the document root");
  return /** @type {Record<string, unknown>} */ (v);
}
