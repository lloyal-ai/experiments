import { z } from "zod";
export const JUDGE = {
  model: "gpt-5.6-luna",
  effort: "medium",
  maxOutputTokens: 8192,
} as const;
export type JudgePrompts = { system: string; user: string };
export function readJudgePrompts(readme: string): JudgePrompts {
  const scoring = readme.split("## Scoring Approach")[1]?.split("<details>")[0];
  const blocks = [...(scoring ?? "").matchAll(/\x60{3}\n([\s\S]*?)\n\x60{3}/g)];
  if (blocks.length !== 2)
    throw new Error("Official judge prompt layout changed");
  return { system: blocks[0]![1]!, user: blocks[1]![1]! };
}
export function judgeRequest(
  prompts: JudgePrompts,
  question: string,
  criteria: string[],
  answer: string,
) {
  // One-pass substitution: candidate content containing a placeholder is never interpolated.
  const values: Record<string, string> = {
    question,
    official_answer: JSON.stringify(criteria),
    candidate_answer: answer,
  };
  const user = prompts.user.replace(
    /\{(question|official_answer|candidate_answer)\}/g,
    (_, name: string) => values[name]!,
  );
  return {
    model: JUDGE.model,
    reasoning: { effort: JUDGE.effort },
    store: false,
    max_output_tokens: JUDGE.maxOutputTokens,
    input: [
      { role: "system", content: prompts.system },
      { role: "user", content: user },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "equality_verdict",
        strict: true,
        schema: {
          type: "object",
          properties: {
            verdict: { type: "string", enum: ["CORRECT", "INCORRECT"] },
          },
          required: ["verdict"],
          additionalProperties: false,
        },
      },
    },
  };
}
const responseSchema = z
  .object({
    status: z.literal("completed"),
    output: z.array(
      z
        .object({
          type: z.string(),
          content: z
            .array(
              z
                .object({ type: z.string(), text: z.string().optional() })
                .passthrough(),
            )
            .optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough();
export function verdictFromResponse(raw: unknown): "CORRECT" | "INCORRECT" {
  const response = responseSchema.parse(raw);
  const content = response.output
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content ?? []);
  if (content.some((item) => item.type !== "output_text"))
    throw new Error("Judge refused or returned an unexpected content type");
  const text = content.map((item) => item.text ?? "").join("");
  return z
    .object({ verdict: z.enum(["CORRECT", "INCORRECT"]) })
    .strict()
    .parse(JSON.parse(text)).verdict;
}
