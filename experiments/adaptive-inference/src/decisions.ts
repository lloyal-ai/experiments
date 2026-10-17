import { z } from "zod";
import { dag } from "@lloyal-labs/lloyal-agents";
import { digest } from "./artifacts.js";

const cleanText = z
  .string()
  .refine(
    (text) =>
      !/<\/?(?:tool_call|function(?:=|>)|parameter(?:=|>)|arg_value|think>)|<\|(?:im_|tool|endof)/i.test(
        text,
      ),
    "Contains tool protocol instead of plain text; submit the field value without embedded tool calls",
  );
const taskSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
    instruction: cleanText.min(1).max(3000),
    reason: cleanText.min(1).max(1000),
    dependsOn: z.array(z.string()).max(8),
  })
  .strict();
export type WorkTask = z.infer<typeof taskSchema>;
export const decisionSchema = z
  .object({
    action: z.enum(["answer", "discover", "compose", "verify"]),
    reason: cleanText.min(1).max(2000),
    topology: z.enum(["parallel", "chain", "fanout", "dag", "speculate"]),
    tasks: z.array(taskSchema).max(8),
  })
  .strict()
  .superRefine((d, c) => {
    const error = (message: string) => c.addIssue({ code: "custom", message });
    if (d.action === "answer") {
      if (d.tasks.length) error("Answer requires no additional tasks");
      return;
    }
    if (!d.tasks.length) error("Work requires tasks");
    try {
      dag(
        d.tasks.map((t) => ({
          id: t.id,
          dependsOn: t.dependsOn,
          task: { content: t.instruction, systemPrompt: "" },
        })),
      );
    } catch (e) {
      error(e instanceof Error ? e.message : "Invalid dependencies");
    }
    switch (d.topology) {
      case "parallel":
      case "speculate":
        if (d.tasks.some((t) => t.dependsOn.length))
          error("Independent tasks cannot have prerequisites");
        if (
          d.topology === "speculate" &&
          (d.tasks.length < 2 || d.tasks.length > 4)
        )
          error(
            "Speculation requires two to four independent alternative approaches",
          );
        break;
      case "chain":
        if (
          d.tasks.some((t, i) =>
            i === 0
              ? t.dependsOn.length !== 0
              : !t.dependsOn.includes(d.tasks[i - 1]!.id),
          )
        )
          error(
            "Each chain task after the first must depend on the previous task",
          );
        break;
      case "fanout":
        if (
          d.tasks.length < 2 ||
          d.tasks[0]!.dependsOn.length ||
          d.tasks
            .slice(1)
            .some(
              (t) =>
                t.dependsOn.length !== 1 || t.dependsOn[0] !== d.tasks[0]!.id,
            )
        )
          error(
            "Fanout requires a root task and subsequent tasks depending only on that root",
          );
        break;
      case "dag":
        break;
    }
  });
export type Decision = z.infer<typeof decisionSchema>;
const evidenceSchema = z
  .object({
    document: z.number().int().positive(),
    quote: z.string().min(8).max(1600),
  })
  .strict();
export const baseFinding = z
  .object({
    finding: cleanText.min(1).max(16000),
    evidence: z.array(evidenceSchema).max(24),
    uncertainty: cleanText.max(4000),
  })
  .strict();
export type Finding = z.infer<typeof baseFinding>;
const normalize = (text: string) =>
  text.normalize("NFC").replace(/\s+/g, " ").trim();
export function findingSchema(documents: readonly { text: string }[]) {
  const normalized = documents.map((d) => normalize(d.text));
  return baseFinding.superRefine((value, ctx) => {
    for (const [i, e] of value.evidence.entries()) {
      if (!normalized[e.document - 1]?.includes(normalize(e.quote)))
        ctx.addIssue({
          code: "custom",
          path: ["evidence", i],
          message:
            "Quote is not present in that numbered document; copy exact supporting words or omit it and state the uncertainty",
        });
    }
    if (!value.evidence.length && !value.uncertainty.trim())
      ctx.addIssue({
        code: "custom",
        path: ["uncertainty"],
        message:
          "A finding without quoted evidence must explicitly state its uncertainty",
      });
  });
}
export function acceptedFinding(
  outcome: {
    result: string | null;
    failed: string | null;
    exitReason?: string;
  },
  schema: z.ZodType<Finding>,
  capped: boolean,
): Finding | null {
  if (capped || outcome.failed || outcome.exitReason || !outcome.result)
    return null;
  try {
    return schema.parse(JSON.parse(outcome.result));
  } catch {
    return null;
  }
}
export const answerSchema = z
  .object({ answer: cleanText.min(1).max(60000) })
  .strict();
export function stableSeed(...identity: (string | number)[]): number {
  return (
    parseInt(digest(JSON.stringify(identity)).slice(0, 8), 16) & 0x7fffffff
  );
}
