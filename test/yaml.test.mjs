import { test } from "node:test";
import assert from "node:assert/strict";
import { parse, stringify, YamlError } from "../assets/lib/yaml.mjs";
import { splitFrontmatter, joinFrontmatter } from "../assets/lib/frontmatter.mjs";

test("parses nested mappings, sequences and scalars", () => {
  const doc = `
# intent file
schema: 1
name: demo app
targets:
  - claude-code
  - agents-md
policy:
  floors:
    strict: true
    count: 0
  tier1-paths: [".github/**", "src/auth/*"]
detected:
  stack: node
  ci: null
  empty: ~
notes: "a: b"
items:
  - id: one
    weight: 1.5
  - id: two
    tags: []
`;
  assert.deepEqual(parse(doc), {
    schema: 1,
    name: "demo app",
    targets: ["claude-code", "agents-md"],
    policy: { floors: { strict: true, count: 0 }, "tier1-paths": [".github/**", "src/auth/*"] },
    detected: { stack: "node", ci: null, empty: null },
    notes: "a: b",
    items: [{ id: "one", weight: 1.5 }, { id: "two", tags: [] }],
  });
});

test("block scalars keep and chomp correctly", () => {
  const doc = `a: |\n  line one\n  line two\n\nb: |-\n  x\n  y\nc: >-\n  folded\n  text\n\n  para\nd: 1\n`;
  assert.deepEqual(parse(doc), { a: "line one\nline two\n", b: "x\ny", c: "folded text\npara", d: 1 });
});

test("rejects unsupported YAML instead of approximating", () => {
  assert.throws(() => parse("a: &x 1\nb: *x\n"), YamlError);
  assert.throws(() => parse("a: 1\n---\nb: 2\n"), YamlError);
  assert.throws(() => parse("a: {b: 1}\n"), YamlError);
  assert.throws(() => parse("a: 1\na: 2\n"), YamlError);
  assert.throws(() => parse("\tkey: v\n"), YamlError);
  assert.throws(() => parse("a: [1, [2]]\n"), YamlError);
});

test("the unquoted-colon trap that killed two agent files is a hard error, not a silent drop", () => {
  // `description: Foo: bar` is invalid YAML; the reference's loader dropped the
  // whole agent with no error. Here it must throw.
  assert.throws(() => parse("description: Change-control classifier: use before coding\n"), YamlError);
  assert.equal(/** @type {any} */ (parse('description: "Change-control classifier: use before coding"\n')).description, "Change-control classifier: use before coding");
});

test("stringify round-trips and quotes what needs quoting", () => {
  const value = {
    name: "x",
    desc: "has: colon",
    num: "42",
    truthy: "true",
    empty: "",
    list: ["a", "b c", "d: e"],
    nested: { deep: { k: null, f: false } },
    multi: "line1\nline2",
    objs: [{ a: 1, b: [1, 2] }, { c: "d" }],
    none: [],
    obj: {},
  };
  const text = stringify(value);
  assert.deepEqual(parse(text), value);
  // deterministic
  assert.equal(stringify(value), text);
  assert.ok(text.includes('desc: "has: colon"'));
  assert.ok(text.includes('num: "42"'));
});

test("frontmatter split/join", () => {
  const md = "---\nname: role\ntools: Read, Grep\n---\n\n# Body\n\ntext\n";
  const s = splitFrontmatter(md);
  assert.deepEqual(s.data, { name: "role", tools: "Read, Grep" });
  // body is everything after the closing delimiter LINE (the blank line is kept)
  assert.equal(s.body, "\n# Body\n\ntext\n");
  const joined = joinFrontmatter(s.data, s.body);
  assert.equal(joined, "---\nname: role\ntools: Read, Grep\n---\n\n# Body\n\ntext\n");
  assert.equal(splitFrontmatter("# no fm\n").data, null);
  assert.throws(() => splitFrontmatter("---\nname: x\n"), YamlError);
  // CRLF input normalizes
  assert.deepEqual(splitFrontmatter("---\r\nname: y\r\n---\r\nbody\r\n").data, { name: "y" });
});
