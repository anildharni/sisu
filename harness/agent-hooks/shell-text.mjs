// Shared command-text analysis for the agent-runtime hooks. These hooks decide
// on STATE where they can (the verification gate hashes the index); where they
// must read command text (deny-tier0), they parse structure — heredoc bodies,
// quoted spans, `sh -c` payloads, git global-option preambles — because every
// flat-regex version of these hooks was bypassed by construction in the
// reference repo (`git -C`, `bash -c "…"`, a flag followed by a closing quote).

/** Remove heredoc BODIES: documentation that quotes a banned command is not the command. */
export function stripHeredocs(s) {
  let out = s;
  for (let guard = 0; guard < 20; guard += 1) {
    const m = out.match(/<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/);
    if (!m) break;
    const nl = out.indexOf("\n", m.index);
    if (nl === -1) {
      out = out.slice(0, m.index) + out.slice(m.index + m[0].length);
      continue;
    }
    const rest = out.slice(nl + 1);
    const end = rest.match(new RegExp(String.raw`^[ \t]*${m[2]}[ \t]*$`, "m"));
    const bodyEnd = end ? nl + 1 + end.index + end[0].length : out.length;
    out = out.slice(0, m.index) + out.slice(m.index + m[0].length, nl + 1) + out.slice(bodyEnd);
  }
  return out;
}

/** Blank quoted spans (keep length) so mentions inside messages are not invocations. */
export function stripQuoted(s) {
  let out = "";
  let q = null;
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (q) {
      if (c === q) {
        q = null;
        out += c;
      } else if (c === "\\" && q === '"') {
        out += "  ";
        i += 1;
      } else out += c === "\n" ? "\n" : " ";
    } else if (c === '"' || c === "'") {
      q = c;
      out += c;
    } else out += c;
  }
  return out;
}

/** Payloads of `sh -c "…"` / `bash -c '…'` — real commands wearing a quoted span. */
export function shellPayloads(s) {
  const re = /\b(?:ba|z|k|da)?sh(?:\.exe)?\s+(?:-[A-Za-z]+\s+)*-c\s+(?:'([^']*)'|"((?:\\.|[^"\\])*)")/g;
  const out = [];
  let m;
  while ((m = re.exec(s)) !== null) out.push((m[1] ?? m[2] ?? "").replace(/\\(.)/g, "$1"));
  return out;
}

/** Every text reachable from a command: itself plus nested sh -c payloads (capped). */
export function allTexts(command) {
  const found = [];
  const seen = new Set();
  const queue = [stripHeredocs(command)];
  while (queue.length && found.length < 10) {
    const next = queue.shift();
    if (seen.has(next)) continue;
    seen.add(next);
    found.push(next);
    queue.push(...shellPayloads(next));
  }
  return found;
}

/** git accepts global options before the subcommand. */
export const PREAMBLE = String.raw`(?:\s+(?:-C\s+\S+|-c\s+\S+|--git-dir=\S+|--work-tree=\S+|--exec-path=\S+|--no-pager|--paginate|-p|--no-optional-locks))*`;

/** Split a shell text into command segments, keeping the separator that FOLLOWS each. */
export function splitSegments(text) {
  const segs = [];
  let cur = "";
  let q = null;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (q) {
      cur += c;
      if (c === q) q = null;
      else if (c === "\\" && q === '"') cur += text[++i] ?? "";
      continue;
    }
    if (c === '"' || c === "'") {
      q = c;
      cur += c;
      continue;
    }
    if (text.startsWith("&&", i) || text.startsWith("||", i)) {
      segs.push({ text: cur.trim(), sep: text.slice(i, i + 2) });
      cur = "";
      i += 1;
      continue;
    }
    if (c === ";" || c === "|" || c === "\n") {
      segs.push({ text: cur.trim(), sep: c });
      cur = "";
      continue;
    }
    cur += c;
  }
  if (cur.trim()) segs.push({ text: cur.trim(), sep: "" });
  return segs.filter((s) => s.text !== "");
}

const RE_GIT_HEAD = /^(?:\S*[/\\])?git(?:\.exe)?(?:\s|$)/;

/** True when the segment's command position is git (after env assignments / wrappers). */
export function isGitInvocation(segment) {
  let s = segment.trim();
  for (let guard = 0; guard < 6; guard += 1) {
    const m = s.match(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+|(?:sudo|command|time|nohup|exec)\s+)/);
    if (!m) break;
    s = s.slice(m[0].length);
  }
  return RE_GIT_HEAD.test(s);
}

/**
 * Extract `-C <path>` from a git invocation, or null. The FLAG must be in
 * unquoted command position (a `-C` inside a commit message is a mention), but
 * the VALUE is read from the original text so a quoted path keeps its spaces.
 * stripQuoted preserves length, so positions line up.
 */
export function gitDashC(segment) {
  const stripped = stripQuoted(segment);
  const m = /\bgit(?:\.exe)?\s+(?:[^\s"']+\s+)*?-C\s+/.exec(stripped);
  if (!m) return null;
  const rest = segment.slice(m.index + m[0].length);
  const q = rest.match(/^"((?:\\.|[^"\\])*)"|^'([^']*)'|^(\S+)/);
  if (!q) return null;
  return q[1] !== undefined ? q[1].replace(/\\(.)/g, "$1") : q[2] ?? q[3] ?? null;
}

/** The git subcommand of a segment (e.g. "push", "commit", "diff"), or null. */
export function gitSubcommand(segment) {
  const re = new RegExp(String.raw`\bgit(?:\.exe)?${PREAMBLE}\s+([a-z][a-z-]*)`);
  const m = segment.match(re);
  return m ? m[1] : null;
}

/** Read the hook payload from stdin (JSON). Resolves {} on empty/malformed input. */
export function readPayload() {
  return new Promise((resolveP) => {
    let raw = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (raw += c));
    process.stdin.on("end", () => {
      try {
        resolveP(JSON.parse(raw));
      } catch {
        resolveP({});
      }
    });
    process.stdin.on("error", () => resolveP({}));
  });
}
