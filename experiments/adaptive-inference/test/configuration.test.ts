import test from "node:test";
import assert from "node:assert/strict";
import { benchmarkOptions, verifyModelReceipt } from "../src/configuration.js";
test("AA-LCR always requests native context, full precision KV, explicit supported batch", () => {
  const options = benchmarkOptions("weights.gguf", 1024);
  assert.deepEqual(options, {
    modelPath: "weights.gguf",
    nCtx: 262144,
    nSeqMax: 16,
    nBatch: 1024,
    typeK: "f16",
    typeV: "f16",
  });
  assert.throws(() => benchmarkOptions("weights.gguf", 256), /batch/i);
});
test("a wrong model, hash or precision cannot masquerade as the selected checkpoint", () => {
  const receipt = {
    model: {
      sha256: "abc",
      tensorTypes: { BF16: 257, F32: 184 },
      metadata: {
        "general.architecture": "qwen35",
        "qwen35.context_length": 262144,
      },
    },
  };
  assert.doesNotThrow(() => verifyModelReceipt(receipt, "abc"));
  assert.throws(() => verifyModelReceipt(receipt, "other"), /hash/i);
  assert.throws(
    () =>
      verifyModelReceipt(
        { model: { ...receipt.model, tensorTypes: { Q4_K: 257 } } },
        "abc",
      ),
    /precision/i,
  );
});
