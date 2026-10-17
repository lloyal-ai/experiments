import { defineOutput, type Output } from "@lloyal-labs/rig";
import { stripDanglingToolCall } from "@lloyal-labs/lloyal-agents";
import { answerSchema } from "./decisions.js";

// AA-LCR scores answer text. Use the public report capture contract, as citedReport
// does, so a completed prose response need not retain a JSON transport envelope.
const captured = defineOutput("report", answerSchema, {
  grammarOrder: "sampleFirst",
  description: "Submit the definitive answer to the original question, with all requested details.",
  capture: ({ answer }, _raw, thinkingEndTags) =>
    stripDanglingToolCall(answer, thinkingEndTags),
});
export const finalAnswer: Output<string> = {
  tool: captured.tool,
  read(outcome) {
    const text = captured.read(outcome);
    if (text === null || !text.trim()) return null;
    return answerSchema.shape.answer.safeParse(text).success ? text : null;
  },
};
