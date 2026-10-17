import test from "node:test";
import assert from "node:assert/strict";
import { run } from "effection";
import { ArithmeticTool } from "../src/corpus-tools.js";
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
