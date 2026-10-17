import { Tool } from "@lloyal-labs/lloyal-agents";
import { z } from "zod";
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
