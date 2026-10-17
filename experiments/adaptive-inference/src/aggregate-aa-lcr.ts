import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { readSubmission } from "./submission.js";
import { aggregate, type Graded } from "./aggregation.js";
import { writeJson } from "./artifacts.js";
const directory = resolve(process.argv[2]!);
const plan = JSON.parse(readFileSync(`${directory}/plan.json`, "utf8"));
const rows = plan.planned.map(
  ({ questionId, repeat }: { questionId: string; repeat: number }) => {
    const base = `${directory}/q${questionId}-r${repeat}`;
    const s = readSubmission(`${base}/submission.json`);
    if (s.recipeSha256 !== plan.recipeSha256) throw new Error("Mixed recipes");
    const g = JSON.parse(readFileSync(`${base}/grading/grade.json`, "utf8"));
    const metrics = JSON.parse(readFileSync(`${base}/metrics.json`, "utf8"));
    const responseFiles = readdirSync(`${base}/grading`).filter((n: string) =>
      /^response-\d+\.json$/.test(n),
    );
    const usage = responseFiles.reduce(
      (sum: { input: number; output: number }, f: string) => {
        const u = JSON.parse(readFileSync(`${base}/grading/${f}`, "utf8"))
          .response.usage;
        sum.input += u?.input_tokens ?? 0;
        sum.output += u?.output_tokens ?? 0;
        return sum;
      },
      { input: 0, output: 0 },
    );
    return { ...s, verdict: g.verdict, metrics, judgeUsage: usage };
  },
);
const score = aggregate(plan.planned, rows as Graded[]);
const summary = {
  ...score,
  label: plan.label,
  purpose: plan.purpose,
  git: plan.git,
  recipeSha256: plan.recipeSha256,
  reference: {
    name: "Artificial Analysis Qwen3.5 4B (Reasoning), AA-LCR v1.1",
    percent: 63,
    comparableFullSet: plan.ids.length === 100,
  },
  solverElapsedMs: rows.reduce(
    (n: number, r: any) => n + r.metrics.elapsedMs,
    0,
  ),
  generatedTokens: rows.reduce(
    (n: number, r: any) => n + r.metrics.generatedTokens,
    0,
  ),
  judgeUsage: rows.reduce(
    (n: { input: number; output: number }, r: any) => ({
      input: n.input + r.judgeUsage.input,
      output: n.output + r.judgeUsage.output,
    }),
    { input: 0, output: 0 },
  ),
  rows: rows.map((r: any) => ({
    questionId: r.questionId,
    repeat: r.repeat,
    status: r.status,
    verdict: r.verdict,
    elapsedMs: r.metrics.elapsedMs,
    generatedTokens: r.metrics.generatedTokens,
  })),
};
writeJson(`${directory}/summary.json`, summary, true);
console.log(JSON.stringify(summary, null, 2));
