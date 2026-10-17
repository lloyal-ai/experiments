import { readFileSync, realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import { digest } from './artifacts.js';

export const DATASET = {
  name: 'ArtificialAnalysis/AA-LCR', version: '1.1',
  revision: '9a77ef56b717057ade24ceab4d273712a0b4f19e',
} as const;

const pathPart = z.string().min(1).refine(
  value => !/[\\/\x00]/.test(value) && value !== '.' && value !== '..',
  'Unsafe corpus path',
);
const questionSchema = z.object({
  id: z.string().regex(/^\d+$/),
  category: pathPart, setId: pathPart, question: z.string().min(1),
  filenames: z.array(pathPart).min(1),
  publishedInputTokens: z.number().int().positive(),
}).strict();
export type Question = z.infer<typeof questionSchema>;
const documentSchema = z.object({
  filename: pathPart, text: z.string().min(1), sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export const problemSchema = questionSchema.extend({
  documents: z.array(documentSchema).min(1),
  prompt: z.string().min(1), promptSha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type Problem = z.infer<typeof problemSchema>;

export function parseQuestions(csv: string): Question[] {
  const rows = parse(csv, { columns: true, bom: true, skip_empty_lines: true }) as Record<string, string>[];
  const questions = rows.map(row => questionSchema.parse({
    id: row.question_id, category: row.document_category, setId: row.document_set_id,
    question: row.question, filenames: row.data_source_filenames?.split(';'),
    publishedInputTokens: Number(row.input_tokens),
  }));
  if (new Set(questions.map(q => q.id)).size !== questions.length)
    throw new Error('Duplicate question identifiers');
  if (!questions.length) throw new Error('Empty dataset');
  return questions;
}

export function renderPrompt(question: string, documents: readonly { text: string }[]): string {
  const text = documents.map((doc, i) => `BEGIN DOCUMENT ${i + 1}:\n${doc.text}\nEND DOCUMENT ${i + 1}`).join('\n\n');
  return `BEGIN INPUT DOCUMENTS\n\n${text}\n\nEND INPUT DOCUMENTS\n\nAnswer the following question using the input documents provided above.\n\nSTART QUESTION\n\n${question}\n\nEND QUESTION\n`;
}

function inside(parent: string, path: string): string {
  const resolved = realpathSync(path);
  if (!resolved.startsWith(parent + sep)) throw new Error('Corpus path escapes outside its document set');
  return resolved;
}

export function loadProblem(input: Question, root: string): Problem {
  const question = questionSchema.parse(input);
  const corpus = realpathSync(root);
  const set = inside(corpus, resolve(corpus, question.category, question.setId));
  const documents = question.filenames.map(filename => {
    const bytes = readFileSync(inside(set, resolve(set, filename)));
    return { filename, text: bytes.toString('utf8'), sha256: digest(bytes) };
  });
  const prompt = renderPrompt(question.question, documents);
  return { ...question, documents, prompt, promptSha256: digest(prompt) };
}

export function readProblem(path: string): Problem {
  const problem = problemSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
  if (problem.documents.length !== problem.filenames.length ||
      problem.documents.some((doc, i) => doc.filename !== problem.filenames[i] || digest(doc.text) !== doc.sha256) ||
      problem.prompt !== renderPrompt(problem.question, problem.documents) ||
      digest(problem.prompt) !== problem.promptSha256)
    throw new Error('Prepared problem failed integrity verification');
  return problem;
}

export function validateCapacity(inputTokens: number, nCtx: number, reserve: number): void {
  if (![inputTokens, nCtx, reserve].every(n => Number.isSafeInteger(n) && n > 0))
    throw new Error('Invalid context capacity figures');
  if (inputTokens + reserve > nCtx)
    throw new Error(`Input exceeds capacity: ${inputTokens} tokens + ${reserve} reserve > ${nCtx}`);
}
