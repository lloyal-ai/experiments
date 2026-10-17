export const RERANKER = {
  path: "models/reranker/Qwen3-Reranker-0.6B-BF16.gguf",
  repository: "Qwen/Qwen3-Reranker-0.6B",
  revision: "e61197ed45024b0ed8a2d74b80b4d909f1255473",
  weights: "BF16",
  options: {
    nCtx: 32768,
    nSeqMax: 10,
    nBatch: 2048,
    typeK: "f16" as const,
    typeV: "f16" as const,
  },
  scoring:
    "Default Qwen retrieval relevance; logit(yes)-logit(no), not an answer judge",
  retrieval: {
    chunkTokens: 256,
    bm25Candidates: 100,
    topK: 5,
    admissionTokens: 2048,
  },
} as const;
