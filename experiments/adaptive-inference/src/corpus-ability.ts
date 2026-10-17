import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { type Operation } from "effection";
import {
  Services,
  service,
  createAbilityRegistry,
  createInMemoryConfigStore,
  participating,
  type Reranker,
  type Ability,
} from "@lloyal-labs/rig";
import { createCorpusAbility } from "@lloyal-labs/corpus-ability";
import { digest } from "./artifacts.js";

type RecordEvent = (type: string, data: unknown) => void;
export function materializeCorpus(
  problem: { documents: readonly { filename: string; text: string }[] },
  directory: string,
) {
  mkdirSync(directory); // No reuse of another attempt's corpus or files.
  return problem.documents.map((doc, i) => {
    const file = `document-${i + 1}.md`;
    writeFileSync(join(directory, file), doc.text, { flag: "wx" });
    return {
      document: i + 1,
      file,
      originalFilename: doc.filename,
      sha256: digest(doc.text),
    };
  });
}

/** Decorates only the public service interface. Content-token counts exclude the private scoring template. */
export function measureReranker(inner: Reranker, record: RecordEvent) {
  const totals = {
    queries: 0,
    documents: 0,
    documentTokens: 0,
    queryTokens: 0,
    elapsedMs: 0,
    failed: 0,
  };
  const account = (
    kind: string,
    start: number,
    documents: number,
    documentTokens: number,
    queryTokens: number,
    success: boolean,
  ) => {
    const elapsedMs = performance.now() - start;
    totals.queries++;
    totals.documents += documents;
    totals.documentTokens += documentTokens;
    totals.queryTokens += queryTokens;
    totals.elapsedMs += elapsedMs;
    if (!success) totals.failed++;
    record("reranker", {
      kind,
      documents,
      documentTokens,
      queryTokens,
      elapsedMs,
      success,
      templateTokens: null,
    });
  };
  const reranker: Reranker = {
    async *score(query, chunks) {
      const start = performance.now();
      let success = false;
      const queryTokens = (await inner.tokenize(query)).length;
      try {
        for await (const result of inner.score(query, chunks)) yield result;
        success = true;
      } finally {
        account(
          "search",
          start,
          chunks.length,
          chunks.reduce((n, c) => n + c.tokens.length, 0),
          queryTokens,
          success,
        );
      }
    },
    async scoreBatch(query, texts) {
      const start = performance.now();
      let success = false;
      const [qt, ...dt] = await Promise.all(
        [query, ...texts].map((t) => inner.tokenize(t)),
      );
      try {
        const result = await inner.scoreBatch(query, texts);
        success = true;
        return result;
      } finally {
        account(
          "relevance",
          start,
          texts.length,
          dt.reduce((n, t) => n + t.length, 0),
          qt!.length,
          success,
        );
      }
    },
    tokenize: (t) => inner.tokenize(t),
    tokenizeChunks: (c) => inner.tokenizeChunks(c),
    dispose: () => inner.dispose(),
  };
  return { reranker, metrics: () => ({ ...totals, templateTokens: null }) };
}

/** One registry and one whitelisted corpus per attempt. Its tools cannot see keys or other questions. */
export function* useCorpus(
  problem: { documents: readonly { filename: string; text: string }[] },
  attemptDir: string,
  record: RecordEvent,
): Operation<{ ability: Ability; metrics: () => unknown }> {
  const start = performance.now(),
    directory = resolve(attemptDir, "corpus");
  const files = materializeCorpus(problem, directory);
  const observed = measureReranker(yield* service("reranker"), record);
  yield* Services.set({ reranker: observed.reranker });
  const configStore = createInMemoryConfigStore();
  yield* configStore.set("corpus", { corpusPath: directory });
  const registry = yield* createAbilityRegistry({ configStore });
  yield* registry.enable(createCorpusAbility);
  const [ability] = yield* participating();
  if (!ability || ability.manifest.name !== "corpus")
    throw new Error("Corpus ability was not enabled");
  record("ability", {
    name: ability.manifest.name,
    files,
    setupMs: performance.now() - start,
    tools: ability.tools.map((t) => t.name),
  });
  return { ability, metrics: observed.metrics };
}
