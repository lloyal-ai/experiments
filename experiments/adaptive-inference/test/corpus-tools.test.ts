import test from "node:test";
import assert from "node:assert/strict";
import { run } from "effection";
import { DocumentTool, ArithmeticTool } from "../src/corpus-tools.js";
const documents = [
  { filename: "one", text: "Alpha beta gamma. Alpha delta.", sha256: "unused" },
  { filename: "two", text: "ALPHA theta.", sha256: "unused" },
];
test("document lookup stays inside numbered input documents and preserves exact text", async () => {
  const tool = new DocumentTool(documents);
  const found = (await run(() =>
    tool.execute({ operation: "find", document: 0, query: "alpha", offset: 0 }),
  )) as any;
  assert.deepEqual(
    found.matches.map((m: any) => [m.document, m.offset]),
    [
      [1, 0],
      [1, 18],
      [2, 0],
    ],
  );
  assert.equal(found.matches[0].text, documents[0]!.text);
  const read = (await run(() =>
    tool.execute({ operation: "read", document: 2, query: "", offset: 6 }),
  )) as any;
  assert.equal(read.text, "theta.");
  const bad = (await run(() =>
    tool.execute({ operation: "read", document: 0, query: "", offset: 0 }),
  )) as any;
  assert.ok(bad.error);
});
test("arithmetic is finite, ordered and cannot evaluate code", async () => {
  const tool = new ArithmeticTool();
  assert.deepEqual(
    await run(() => tool.execute({ operation: "divide", values: [120, 3, 4] })),
    { result: 10 },
  );
  assert.ok(
    (
      (await run(() =>
        tool.execute({ operation: "divide", values: [1, 0] }),
      )) as any
    ).error,
  );
  assert.ok(
    (
      (await run(() =>
        tool.execute({ operation: "eval", values: ["process.env"] }),
      )) as any
    ).error,
  );
});
