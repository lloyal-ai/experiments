import test from "node:test";
import assert from "node:assert/strict";
import { finalAnswer } from "../src/final-output.js";

test("a completed plain-text answer is valid benchmark output without a JSON envelope", () => {
  assert.equal(finalAnswer.read({ result: "The answer is 42%." }), "The answer is 42%.");
});

test("the public terminal capture and ordinary completed prose have the same answer type", () => {
  const onReturn = finalAnswer.tool.hooks!.onReturn!;
  const decision = onReturn({
    args: { answer: "The answer is 42%." },
    raw: JSON.stringify({ answer: "The answer is 42%." }),
    agent: { fmt: { thinkingEndTags: [] } },
  } as any) as any;
  assert.equal(decision.type, "accept");
  assert.equal(finalAnswer.read({ result: decision.result }), "The answer is 42%.");
});

test("empty or protocol-contaminated final text cannot be submitted", () => {
  for (const result of [null, "", "  \n", "<function=report>unfinished"]) {
    assert.equal(finalAnswer.read({ result }), null);
  }
});
