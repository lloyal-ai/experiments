import { z } from 'zod';
const example = z.object({
  input: z.string(), output: z.string(), testtype: z.enum(['stdin', 'functional']),
});
export const problemSchema = z.object({
  id: z.string().min(1), title: z.string(), question: z.string().min(1),
  starterCode: z.string(), examples: z.array(example), functionName: z.string().nullable(),
  difficulty: z.string(), date: z.string(), platform: z.string(),
}).strict();
export type Problem = z.infer<typeof problemSchema>;
/** This explicit projection is the only dataset-to-solver boundary. */
export function publicProblem(row: Record<string, unknown>): Problem {
  const metadata = JSON.parse(String(row.metadata || '{}'));
  return problemSchema.parse({
    id: row.question_id, title: row.question_title, question: row.question_content,
    starterCode: row.starter_code ?? '',
    examples: JSON.parse(String(row.public_test_cases ?? '[]')),
    functionName: metadata.func_name ?? null,
    difficulty: row.difficulty, date: row.contest_date, platform: row.platform,
  });
}
export function acceptedText(outcome: {
  result: string | null; failed?: string | null; exitReason?: string;
}): string {
  if (outcome.failed || outcome.exitReason || !outcome.result?.trim())
    throw new Error(`Unaccepted outcome: ${outcome.failed ?? outcome.exitReason ?? 'empty result'}`);
  return outcome.result;
}
/** Matches the upstream last-code-block extraction convention; never invents code. */
export function extractCode(answer: string): string {
  const blocks = [...answer.matchAll(/```(?:python|py)?[ \t]*\r?\n([\s\S]*?)```/g)];
  const code = blocks.at(-1)?.[1]?.trim();
  if (!code) throw new Error('No complete Python code block in accepted answer');
  return code;
}
