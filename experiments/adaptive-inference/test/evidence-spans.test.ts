import test from "node:test";
import assert from "node:assert/strict";
import {
  evidenceSpanSchema,
  resolveFinding,
  decisionFeedback,
} from "../src/evidence-spans.js";
const docs = [
  {
    text: "# Report\nRevenue | 2024 | 2025\nTotal | 10 | 12\nFootnote: millions",
  },
];
const report = {
  finding: "Revenue rose by 20%.",
  evidence: [{ document: 1, startLine: 2, endLine: 4 }],
  uncertainty: "",
};
test("accepted source ranges resolve byte-exact evidence without asking the model to transcribe", () => {
  const s = evidenceSpanSchema(docs);
  assert.ok(s.safeParse(report).success);
  assert.deepEqual(resolveFinding(report, docs), {
    finding: report.finding,
    evidence: [
      {
        document: 1,
        quote: "Revenue | 2024 | 2025\nTotal | 10 | 12\nFootnote: millions",
      },
    ],
    uncertainty: "",
  });
  for (const change of [
    { document: 2 },
    { startLine: 0 },
    { startLine: 4, endLine: 2 },
    { endLine: 99 },
  ])
    assert.equal(
      s.safeParse({
        ...report,
        evidence: [{ ...report.evidence[0], ...change }],
      }).success,
      false,
    );
  assert.equal(
    s.safeParse({ ...report, evidence: [], uncertainty: "" }).success,
    false,
  );
});
test("decision repair feedback preserves the invalid output and specific validation errors", () => {
  const feedback = decisionFeedback(
    '{"action":"parallel","topology":"parallel","reason":"x","tasks":[]}',
  );
  assert.match(feedback, /action/);
  assert.match(feedback, /parallel/);
  assert.match(feedback, /answer/);
});
