import { readFileSync, existsSync } from "node:fs";
import { analyzeTrace } from "./trace-analysis.js";
import { writeJson } from "./artifacts.js";
const root = process.argv[2];
if (!root) throw new Error("Usage: analyze-run <completed run directory>");
const read = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const jsonl = (p: string) =>
  readFileSync(p, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
if (!existsSync(`${root}/completed.json`)) throw new Error("Run is incomplete");
const plan = read(`${root}/plan.json`),
  trace = jsonl(`${root}/trace.jsonl`),
  manifest = read(`${root}/manifest.json`);
const rows = plan.planned.map((p: { questionId: string; repeat: number }) => {
  const id = `q${p.questionId}-r${p.repeat}`,
    m = read(`${root}/${id}/metrics.json`),
    events = jsonl(`${root}/${id}/events.jsonl`);
  return {
    id,
    ...analyzeTrace(events, trace),
    elapsedMs: m.elapsedMs,
    prefillMs: m.input?.prefillMs ?? null,
    inputTokens: m.input?.inputTokens ?? null,
    generatedTokens: m.generatedTokens,
    generatedByRole: m.generatedByRole,
    peakGpuMiB: m.peakGpuMiB,
    peakLiveCells: m.peakLiveCells,
    reranker: m.reranker ?? null,
  };
});
writeJson(
  `${root}/performance.json`,
  {
    git: plan.git,
    recipeSha256: plan.recipeSha256,
    gpu: manifest.gpu,
    loadMs: manifest.loadMs,
    rerankerLoadMs: manifest.reranker?.loadMs ?? null,
    wallTimeNote:
      "Tool times and reranker times are cumulative and may overlap; they are not subtracted from elapsed time to infer decoding speed.",
    billingRate: null,
    operatingDollars: null,
    rows,
  },
  true,
);
console.log(
  JSON.stringify({
    cases: rows.length,
    totalSeconds: rows.reduce((n: number, r: any) => n + r.elapsedMs / 1000, 0),
    generatedTokens: rows.reduce(
      (n: number, r: any) => n + r.generatedTokens,
      0,
    ),
  }),
);
