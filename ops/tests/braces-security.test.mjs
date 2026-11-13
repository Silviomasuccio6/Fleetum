import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const braces = require("braces");
const nested = (depth, open = "{", close = "}") => open.repeat(depth) + "x" + close.repeat(depth);
const limited = (error) => error instanceof SyntaxError && error.code === "ERR_BRACES_AST_LIMIT";
const deepAst = (depth) => {
  const root = { type: "root", nodes: [] };
  let current = root;
  for (let i = 0; i < depth; i++) {
    const child = { type: "root", nodes: [] };
    current.nodes.push(child);
    current = child;
  }
  current.nodes.push({ type: "text", value: "x" });
  return root;
};

for (const method of ["parse", "compile", "expand", "stringify"]) {
  test(`braces ${method} rejects deeply nested input below the existing character cap`, () => {
    assert.throws(() => braces[method](nested(4000)), limited);
  });
  test(`braces ${method} bounds nested parentheses and mixed grouping`, () => {
    assert.throws(() => braces[method](nested(256, "(", ")")), limited);
    assert.throws(() => braces[method]("{(".repeat(150) + "x" + ")}".repeat(150)), limited);
  });
}
for (const method of ["compile", "expand", "stringify"]) {
  test(`braces ${method} validates externally supplied deep, cyclic and oversized ASTs`, () => {
    assert.throws(() => braces[method](deepAst(4000)), limited);
    const cycle = { type: "root", nodes: [] };
    cycle.nodes.push(cycle);
    assert.throws(() => braces[method](cycle), limited);
    const parentCycle = { type: "root", nodes: [] };
    parentCycle.parent = parentCycle;
    assert.throws(() => braces[method](parentCycle), limited);
    assert.throws(() => braces[method]({ type: "root", nodes: Array.from({ length: 20001 }, () => ({ type: "text", value: "x" })) }), limited);
  });
}

test("every consumer resolves the corrected implementation, including nested watchers and Next lint", () => {
  for (const consumer of ["micromatch", "tailwindcss", "@next/eslint-plugin-next"]) {
    const fromConsumer = createRequire(require.resolve(consumer));
    const indirect = consumer === "@next/eslint-plugin-next"
      ? createRequire(fromConsumer.resolve("fast-glob"))
      : fromConsumer;
    const fromMatcher = createRequire(indirect.resolve("micromatch"));
    const actual = fromMatcher("braces");
    assert.throws(() => actual.compile(nested(4000)), limited);
    assert.equal(fromMatcher("braces/package.json").name, "@fleetum/braces");
  }
  const fromTailwind = createRequire(require.resolve("tailwindcss"));
  const fromWatcher = createRequire(fromTailwind.resolve("chokidar"));
  assert.throws(() => fromWatcher("braces").compile(nested(4000)), limited);
});

test("normal nested alternatives, ranges, escapes and quoted literals preserve the public API", () => {
  assert.deepEqual(braces.expand("src/{app,{tenant,platform}}/**/*.{ts,tsx}"), [
    "src/app/**/*.ts", "src/app/**/*.tsx", "src/tenant/**/*.ts", "src/tenant/**/*.tsx", "src/platform/**/*.ts", "src/platform/**/*.tsx",
  ]);
  assert.deepEqual(braces.expand("file-{01..05..2}.{js,ts}"), ["file-01.js", "file-01.ts", "file-03.js", "file-03.ts", "file-05.js", "file-05.ts"]);
  assert.equal(braces.compile("a/{b,c}/d"), "a/(b|c)/d");
  assert.equal(braces.stringify(braces.parse("a/{b,c}/d")), "a/{b,c}/d");
  const quoted = '"' + "{".repeat(500) + '"';
  assert.doesNotThrow(() => braces.compile(quoted));
  assert.doesNotThrow(() => braces.compile("\\{".repeat(500)));
  assert.doesNotThrow(() => braces.compile(nested(100)));
  assert.doesNotThrow(() => braces.parse(nested(127)));
  assert.throws(() => braces.parse(nested(128)), limited);
});

test("the bounds cannot be disabled by parser options or bypassed by default array entry points", () => {
  assert.throws(() => braces(nested(4000), { maxLength: Infinity, maxDepth: Infinity }), limited);
  assert.throws(() => braces(["src/*.{ts,tsx}", nested(4000)]), limited);
  assert.throws(() => braces(nested(4000), { expand: true }), limited);
});

test("shared acyclic AST nodes retain their existing semantics", () => {
  const node = { type: "text", value: "x" };
  assert.equal(braces.compile({ type: "root", nodes: [node, node] }), "xx");
  assert.equal(braces.stringify({ type: "root", nodes: [node, node] }), "xx");
});

test("shared ASTs cannot bypass the total work budget with repeated wide branches", () => {
  const leaf = { type: "text", value: "x" };
  const branch = { type: "root", nodes: Array(1000).fill(leaf) };
  const root = { type: "root", nodes: Array(1000).fill(branch) };
  assert.throws(() => braces.compile(root), limited);
});
