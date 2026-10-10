import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Emit } from './types.js';

export interface Ranker {
  tokenize(text: string, signal?: AbortSignal): Promise<number[]>;
  score(query: string, documents: string[], signal?: AbortSignal): Promise<number[]>;
}

/** Stock HTTP ranking. Scores are server probabilities, not mislabeled SDK logits. */
export class HttpReranker implements Ranker {
  constructor(private baseUrl: string, private dir: string, private emit: Emit) {}
  private async post(route: string, body: unknown, signal?: AbortSignal): Promise<any> {
    const id = randomUUID(), serialized = JSON.stringify(body), at = performance.now();
    await mkdir(this.dir, { recursive: true });
    await writeFile(resolve(this.dir, `${id}.request.json`), serialized);
    this.emit('reranker.request', { id, route, wireBytes: Buffer.byteLength(serialized) });
    const response = await fetch(this.baseUrl + route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: serialized, signal });
    const raw = await response.text();
    await writeFile(resolve(this.dir, `${id}.response.json`), raw);
    this.emit('reranker.response', { id, route, status: response.status, durationMs: performance.now() - at });
    if (!response.ok) throw new Error(`Reranker ${response.status}: ${raw.slice(0, 1000)}`);
    return JSON.parse(raw);
  }
  async tokenize(content: string, signal?: AbortSignal): Promise<number[]> {
    const result = await this.post('/tokenize', { content, add_special: false, parse_special: false }, signal);
    if (!Array.isArray(result.tokens) || result.tokens.some((t: unknown) => !Number.isInteger(t))) throw new Error('Invalid reranker tokenizer response');
    return result.tokens;
  }
  async score(query: string, documents: string[], signal?: AbortSignal): Promise<number[]> {
    if (!documents.length) return [];
    const result = await this.post('/rerank', { query, documents, top_n: documents.length, return_documents: false }, signal);
    const rows = result.results ?? result.data ?? result;
    if (!Array.isArray(rows) || rows.length !== documents.length) throw new Error('Reranker did not score every candidate');
    const scores = new Array<number>(documents.length);
    for (const row of rows) {
      const score = row.relevance_score ?? row.score;
      if (!Number.isInteger(row.index) || row.index < 0 || row.index >= documents.length || scores[row.index] !== undefined || !Number.isFinite(score)) throw new Error('Malformed reranker scores');
      scores[row.index] = score;
    }
    return scores;
  }
  async verify(signal?: AbortSignal) {
    const scores = await this.score('What is the capital of France?', ['Paris is the capital and most populous city of France.', 'Photosynthesis converts carbon dioxide and water into glucose.'], signal);
    if (!(scores[0] > scores[1])) throw new Error(`Reranker canary failed: relevant=${scores[0]}, unrelated=${scores[1]}`);
    this.emit('reranker.verified', { scores, scoring: 'stock /rerank classification-head probability; SDK score equivalence requires paired validation' });
  }
}
