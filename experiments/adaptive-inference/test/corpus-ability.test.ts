import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { materializeCorpus, measureReranker } from "../src/corpus-ability.js";
import type { Reranker } from "@lloyal-labs/rig";

test("corpus contains only complete ordered documents, never unrelated case metadata", () => {
  const dir = mkdtempSync(join(tmpdir(), "corpus-test-"));
  try {
    const input = {
      documents: [
        {
          filename: "../../answer-key.json",
          text: "First document\nComplete text",
        },
        { filename: "elsewhere.txt", text: "Second document" },
      ],
      answer: "HIDDEN",
    };
    const map = materializeCorpus(input, join(dir, "corpus"));
    assert.deepEqual(readdirSync(join(dir, "corpus")), [
      "document-1.md",
      "document-2.md",
    ]);
    assert.equal(
      readFileSync(join(dir, "corpus/document-1.md"), "utf8"),
      input.documents[0].text,
    );
    assert.equal(map[1].document, 2);
    assert.throws(
      () => materializeCorpus(input, join(dir, "corpus")),
      /exist/i,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("reranker accounting counts discarded scoring work and forwards all results unchanged", async () => {
  const events: unknown[] = [];
  const fake = {
    tokenize: async (t: string) => [...t].map(() => 1),
    async *score() {
      yield { filled: 1, total: 1, results: [] };
    },
    scoreBatch: async () => [2, -3],
    tokenizeChunks: async () => {},
    dispose() {},
  } as unknown as Reranker;
  const measured = measureReranker(fake, (_t, d) => events.push(d));
  const chunks = [
    {
      resource: "document-1.md",
      heading: "",
      section: "",
      text: "abc",
      tokens: [1, 2, 3],
      startLine: 1,
      endLine: 1,
    },
  ];
  for await (const r of measured.reranker.score("q", chunks))
    assert.equal(r.filled, 1);
  assert.deepEqual(
    await measured.reranker.scoreBatch("q", ["ab", "xyz"]),
    [2, -3],
  );
  assert.equal(measured.metrics().documentTokens, 8);
  assert.equal(measured.metrics().queries, 2);
  assert.equal(measured.metrics().documents, 3);
  assert.equal(events.length, 2);
});
