import { call, ensure, scoped, type Operation } from 'effection';
import { judgeRequest, verdictFromResponse, type JudgePrompts } from './grading.js';
import { readFileSync, statSync } from 'node:fs';

export function privateKey(path: string): string {
  if ((statSync(path).mode & 0o077) !== 0) throw new Error('Judge credential file must be private (0600)');
  const key = readFileSync(path, 'utf8').trim();
  if (!key) throw new Error('Empty judge credential file');
  return key;
}
export function* requestVerdict(prompts: JudgePrompts, question: string, criteria: string[], answer: string, key: string) {
  return yield* scoped(function* (): Operation<{
    verdict: 'CORRECT' | 'INCORRECT'; response: unknown; request: ReturnType<typeof judgeRequest>; elapsedMs: number;
  }> {
    const abort = new AbortController();
    yield* ensure(() => abort.abort());
    const request = judgeRequest(prompts, question, criteria, answer);
    const started = performance.now();
    const response = yield* call(() => fetch('https://api.openai.com/v1/responses', {
      method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify(request), signal: AbortSignal.any([abort.signal, AbortSignal.timeout(180000)]),
    }));
    // Error bodies can echo credentials or submitted text. Keep them out of logs.
    if (!response.ok) throw new JudgeHttpError(response.status);
    const data: unknown = yield* call(() => response.json());
    return { verdict: verdictFromResponse(data), response: data, request, elapsedMs: performance.now() - started };
  });
}
export class JudgeHttpError extends Error {
  constructor(readonly status: number) { super('Judge HTTP ' + status); }
}
