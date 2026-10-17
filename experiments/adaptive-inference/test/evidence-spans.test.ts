import { acceptedFinding } from "../src/decisions.js";
import test from "node:test";
import assert from "node:assert/strict";
import {
  evidenceSpanSchema,
  findingOutputSchema,
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


test("a completed range report is accepted identically to terminal-captured quotations", () => {
  const schema = findingOutputSchema(docs);
  const expected = resolveFinding(report, docs);
  assert.deepEqual(acceptedFinding({ result: JSON.stringify(report), failed: null }, schema, false), expected);
  assert.deepEqual(acceptedFinding({ result: JSON.stringify(expected), failed: null }, schema, false), expected);
});

test("normalizing completed reports never admits invalid sources or unfinished workers", () => {
  const schema = findingOutputSchema(docs);
  for (const evidence of [
    [{ document: 1, startLine: 2, endLine: 999 }],
    [{ document: 2, startLine: 2, endLine: 3 }],
    [{ document: 1, quote: "This invented quotation is not in the document." }],
    [{ document: 1, startLine: 2, endLine: 3, quote: "Unexpected mixed representation" }],
  ]) assert.equal(acceptedFinding({ result: JSON.stringify({ ...report, evidence }), failed: null }, schema, false), null);
  const outcome = { result: JSON.stringify(report), failed: null };
  assert.equal(acceptedFinding(outcome, schema, true), null);
  assert.equal(acceptedFinding({ ...outcome, failed: "tool failure" }, schema, false), null);
  assert.equal(acceptedFinding({ ...outcome, exitReason: "budget" }, schema, false), null);
});

test("a complete supporting section may exceed 1600 characters within the total evidence allowance", () => {
  const text = "A complete financial table row with its headings and units. ".repeat(40);
  const documents = [{ text }];
  const value = { finding: "The table supplies the requested value.", evidence: [{ document: 1, startLine: 1, endLine: 1 }], uncertainty: "" };
  const accepted = acceptedFinding({ result: JSON.stringify(value), failed: null }, findingOutputSchema(documents), false);
  assert.equal(accepted?.evidence[0]?.quote, text);
});

test("larger individual sections never exceed the existing total evidence character allowance", () => {
  const text = "a".repeat(8000);
  const documents = [{ text }];
  const value = { finding: "A bounded report.", evidence: Array.from({ length: 5 }, () => ({ document: 1, startLine: 1, endLine: 1 })), uncertainty: "" };
  assert.equal(findingOutputSchema(documents).safeParse(value).success, false);
  assert.equal(findingOutputSchema(documents).safeParse({ ...value, evidence: value.evidence.map(() => ({ document: 1, quote: text })) }).success, false);
});
