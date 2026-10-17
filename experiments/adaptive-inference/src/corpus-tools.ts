import { Tool } from "@lloyal-labs/lloyal-agents";
import { z } from "zod";
import type { Problem } from "./aa-lcr.js";
const lookup = z
  .object({
    operation: z.enum(["find", "read"]),
    document: z.number().int().nonnegative(),
    query: z.string().max(300),
    offset: z.number().int().nonnegative(),
  })
  .strict();
export class DocumentTool extends Tool {
  readonly name = "document";
  readonly description =
    "Revisit the full documents already in your context. find locates a literal case-insensitive phrase (document=0 searches all); read returns 4000 characters starting at a character offset from a numbered document. No web or external sources.";
  readonly parameters = { ...z.toJSONSchema(lookup), type: "object" };
  constructor(readonly documents: Problem["documents"]) {
    super();
  }
  *execute(input: unknown) {
    const parsed = lookup.safeParse(input);
    if (!parsed.success) return { error: parsed.error.message };
    const a = parsed.data;
    if (a.operation === "read") {
      const d = this.documents[a.document - 1];
      return d
        ? {
            document: a.document,
            filename: d.filename,
            offset: a.offset,
            totalCharacters: d.text.length,
            text: d.text.slice(a.offset, a.offset + 4000),
          }
        : { error: "Document numbers begin at 1" };
    }
    if (a.query.trim().length < 3)
      return { error: "Supply a literal phrase of at least three characters" };
    const matches: unknown[] = [];
    for (const [i, d] of this.documents.entries()) {
      if (a.document !== 0 && a.document !== i + 1) continue;
      let offset = d.text
        .toLowerCase()
        .indexOf(a.query.toLowerCase(), a.offset);
      while (offset >= 0 && matches.length < 6) {
        const start = Math.max(0, offset - 400);
        matches.push({
          document: i + 1,
          filename: d.filename,
          offset,
          start,
          text: d.text.slice(start, offset + 800),
        });
        offset = d.text
          .toLowerCase()
          .indexOf(a.query.toLowerCase(), offset + a.query.length);
      }
      if (matches.length === 6) break;
    }
    return {
      matches,
      limit: 6,
      next: "Use a later offset or a specific document to continue; absence here is not proof of absence under other wording.",
    };
  }
}
const arithmetic = z
  .object({
    operation: z.enum(["add", "subtract", "multiply", "divide"]),
    values: z.array(z.number().finite()).min(2).max(30),
  })
  .strict();
export class ArithmeticTool extends Tool {
  readonly name = "arithmetic";
  readonly description =
    "Calculate left-to-right over the supplied numbers. State document evidence and units separately. No implicit percentage conversion.";
  readonly parameters = { ...z.toJSONSchema(arithmetic), type: "object" };
  *execute(input: unknown) {
    const parsed = arithmetic.safeParse(input);
    if (!parsed.success) return { error: parsed.error.message };
    const { operation, values } = parsed.data;
    let result = values[0]!;
    for (const v of values.slice(1))
      switch (operation) {
        case "add":
          result += v;
          break;
        case "subtract":
          result -= v;
          break;
        case "multiply":
          result *= v;
          break;
        case "divide":
          result /= v;
          break;
      }
    return Number.isFinite(result)
      ? { result }
      : { error: "Non-finite result" };
  }
}
