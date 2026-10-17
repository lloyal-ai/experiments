import { z } from "zod";
import { baseFinding, findingSchema, decisionSchema, type Finding } from "./decisions.js";
const span = z
  .object({
    document: z.number().int().positive(),
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
  })
  .strict();
const submission = baseFinding.extend({ evidence: z.array(span).max(24) });
type Submission = z.infer<typeof submission>;
export function evidenceSpanSchema(documents: readonly { text: string }[]) {
  const lines = documents.map((d) => d.text.split("\n"));
  return submission.superRefine((report, ctx) => {
    for (const [i, e] of report.evidence.entries()) {
      const source = lines[e.document - 1];
      if (
        !source ||
        e.endLine < e.startLine ||
        e.endLine > source.length ||
        e.endLine - e.startLine >= 100
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["evidence", i],
          message:
            "Use a real document and ordered 1-based line range from read_file, at most 100 lines",
        });
        continue;
      }
      const quote = source.slice(e.startLine - 1, e.endLine).join("\n");
      if (quote.length < 8 || quote.length > 1600)
        ctx.addIssue({
          code: "custom",
          path: ["evidence", i],
          message:
            "Choose a concise supporting range between 8 and 1600 characters, including necessary row headers or units",
        });
    }
    if (!report.evidence.length && !report.uncertainty.trim())
      ctx.addIssue({
        code: "custom",
        path: ["uncertainty"],
        message: "State uncertainty when no supporting passage is cited",
      });
  });
}
export function resolveFinding(
  report: Submission,
  documents: readonly { text: string }[],
): Finding {
  const validated = evidenceSpanSchema(documents).parse(report);
  return {
    ...validated,
    evidence: validated.evidence.map((e) => ({
      document: e.document,
      quote: documents[e.document - 1]!.text.split("\n")
        .slice(e.startLine - 1, e.endLine)
        .join("\n"),
    })),
  };
}
export class InvalidDecision extends Error {}
export function decisionFeedback(raw: string): string {
  let issues: unknown;
  try {
    const p = decisionSchema.safeParse(JSON.parse(raw));
    issues = p.success ? [] : p.error.issues;
  } catch {
    issues = "Not valid JSON";
  }
  return `The decision was rejected and no tasks ran. Correct the schema errors before choosing the next action. Errors: ${JSON.stringify(issues)}. Previous output: ${raw.slice(0, 16000)}`;
}

export function findingOutputSchema(documents: readonly { text: string }[]) {
  // The public terminal hook captures canonical quotations. A completed worker
  // may instead return its valid tool arguments as JSON without calling the hook.
  // Validate either representation before admitting the same canonical finding.
  return z.union([
    findingSchema(documents),
    evidenceSpanSchema(documents).transform((report) => resolveFinding(report, documents)),
  ]);
}
