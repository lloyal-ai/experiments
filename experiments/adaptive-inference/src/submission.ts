import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { digest, writeJson } from './artifacts.js';

const submissionSchema = z.object({
  attemptId: z.string().min(1), questionId: z.string().regex(/^\d+$/),
  repeat: z.number().int().nonnegative(), seed: z.number().int().nonnegative(),
  datasetRevision: z.string().regex(/^[a-f0-9]{40}$/),
  promptSha256: z.string().regex(/^[a-f0-9]{64}$/), recipeSha256: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.enum(['completed', 'failed']), answer: z.string().min(1).nullable(),
  failure: z.string().nullable(),
}).strict().refine(s => s.status === 'completed' ? s.answer !== null && s.failure === null : s.answer === null && s.failure !== null);
export type Submission = z.infer<typeof submissionSchema>;
export function freezeSubmission(path: string, value: Submission): void {
  const payload = submissionSchema.parse(value);
  writeJson(path, { ...payload, sha256: digest(JSON.stringify(payload)) }, true);
}
export function readSubmission(path: string): Submission {
  const { sha256, ...raw } = JSON.parse(readFileSync(path, 'utf8'));
  const payload = submissionSchema.parse(raw);
  if (digest(JSON.stringify(payload)) !== sha256) throw new Error('Submission hash mismatch');
  return payload;
}
