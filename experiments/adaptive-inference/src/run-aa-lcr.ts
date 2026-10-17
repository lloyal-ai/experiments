/** GPU solver entry point. Imports neither answer keys nor judge code. */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { main, race, sleep, scoped, spawn, ensure } from "effection";
import { ContextPressure } from "@lloyal-labs/lloyal-agents";
import { BranchStore } from "@lloyal-labs/sdk";
import { gpuRuntime, command } from "./runtime.js";
import { readProblem, DATASET } from "./aa-lcr.js";
import { recipe } from "./prompts.js";
import { stableSeed } from "./decisions.js";
import { AttemptMeter, LIMITS } from "./budgets.js";
import { solve } from "./solver.js";
import { digest, writeJson } from "./artifacts.js";
import { freezeSubmission } from "./submission.js";

main(function* () {
  const [planFile, preparedArg = "work/prepared/aa-lcr-v1.1-ready"] =
    process.argv.slice(2);
  if (!planFile)
    throw new Error(
      "Usage: run-aa-lcr <declared-plan.json> [prepared-directory]",
    );
  if (command("git", ["status", "--porcelain"]))
    throw new Error("Commit the complete solver before running");
  const plan = JSON.parse(readFileSync(planFile, "utf8")) as {
    label: string;
    ids: string[];
    repeats: number[];
    timeoutMs: number;
    seed: number;
    purpose: string;
  };
  if (
    !plan.ids.length ||
    new Set(plan.ids).size !== plan.ids.length ||
    !plan.ids.every((id) => /^\d+$/.test(id)) ||
    !plan.repeats.length ||
    !plan.repeats.every((n) => Number.isInteger(n) && n >= 0) ||
    new Set(plan.repeats).size !== plan.repeats.length ||
    !(plan.timeoutMs >= 5400000)
  )
    throw new Error("Invalid declared plan");
  const prepared = resolve(preparedArg),
    preparedManifest = JSON.parse(
      readFileSync(`${prepared}/manifest.json`, "utf8"),
    );
  if (preparedManifest.dataset.revision !== DATASET.revision)
    throw new Error("Wrong prepared dataset");
  const problems = plan.ids.map((id) => readProblem(`${prepared}/${id}.json`));
  const { ctx, out, trace, manifest } = yield* gpuRuntime(plan.label, true);
  const config = recipe();
  writeJson(`${out}/recipe.json`, config, true);
  const planned = plan.repeats.flatMap((repeat) =>
    problems.map((p) => ({ questionId: p.id, repeat })),
  );
  writeJson(
    `${out}/plan.json`,
    {
      ...plan,
      planned,
      recipeSha256: config.sha256,
      git: manifest.git,
      preparedManifestSha256: digest(readFileSync(`${prepared}/manifest.json`)),
    },
    true,
  );
  const summaries: unknown[] = [];
  for (const { questionId, repeat } of planned) {
    const problem = problems.find((p) => p.id === questionId)!;
    const id = `q${questionId}-r${repeat}`,
      attemptDir = `${out}/${id}`;
    mkdirSync(attemptDir); // Existing outputs are never overwritten or silently rerun.
    const meter = new AttemptMeter(),
      seed = stableSeed(plan.seed, questionId, repeat),
      started = performance.now();
    let input: unknown = null,
      peakGpuMiB = 0,
      lastTokens = 0,
      lastProgress = performance.now();
    const record = (type: string, data: unknown) => {
      if (type === "input") input = data;
      appendFileSync(
        `${attemptDir}/events.jsonl`,
        JSON.stringify({
          at: new Date().toISOString(),
          elapsedMs: performance.now() - started,
          type,
          data,
        }) + "\n",
      );
      console.log(
        JSON.stringify({
          attempt: id,
          type,
          elapsedSeconds: Math.round((performance.now() - started) / 1000),
          generatedTokens: meter.total,
          ...(type === "decision" ? { decision: data } : {}),
        }),
      );
      trace.flush();
    };
    record("attempt-start", {
      questionId,
      repeat,
      seed,
      recipeSha256: config.sha256,
    });
    let answer: string | null = null,
      failure: string | null = null;
    try {
      answer = yield* scoped(function* () {
        yield* spawn(function* () {
          while (true) {
            const rows = command("nvidia-smi", [
              "--query-compute-apps=pid,used_memory",
              "--format=csv,noheader,nounits",
            ])
              .split("\n")
              .map((l) => l.split(",").map(Number));
            const used = rows.find((r) => r[0] === process.pid)?.[1] ?? 0;
            peakGpuMiB = Math.max(peakGpuMiB, used);
            appendFileSync(
              `${out}/gpu.jsonl`,
              JSON.stringify({
                at: new Date().toISOString(),
                attempt: id,
                pid: process.pid,
                usedMiB: used,
                tokens: meter.total,
              }) + "\n",
            );
            if (meter.total !== lastTokens) {
              lastTokens = meter.total;
              lastProgress = performance.now();
            }
            if (performance.now() - lastProgress > 600000)
              throw new Error("No sampled-token progress for ten minutes");
            yield* sleep(5000);
          }
        });
        return yield* race([
          solve(
            ctx,
            problem,
            meter,
            seed,
            (manifest.options as { nBatch: number }).nBatch,
            record,
          ),
          (function* () {
            yield* sleep(plan.timeoutMs);
            throw new Error("Whole-attempt operational timeout");
          })(),
        ]);
      });
    } catch (e) {
      failure = e instanceof Error ? e.message : String(e);
    }
    const status = answer !== null ? "completed" : "failed";
    freezeSubmission(`${attemptDir}/submission.json`, {
      attemptId: id,
      questionId,
      repeat,
      seed,
      datasetRevision: DATASET.revision,
      promptSha256: problem.promptSha256,
      recipeSha256: config.sha256,
      status,
      answer,
      failure,
    });
    const pressure = new ContextPressure(ctx),
      availableSequences = new BranchStore(ctx).available;
    const metrics = {
      id,
      questionId,
      repeat,
      status,
      failure,
      elapsedMs: performance.now() - started,
      input,
      generatedTokens: meter.total,
      generatedByRole: meter.byRole(),
      peakLiveCells: meter.peakCells,
      peakGpuMiB,
      remainingCells: pressure.cellsUsed,
      availableSequences,
    };
    writeJson(`${attemptDir}/metrics.json`, metrics, true);
    summaries.push(metrics);
    writeJson(`${out}/progress.json`, summaries);
    record("attempt-complete", metrics);
    if (pressure.cellsUsed !== 0 || availableSequences !== 16)
      throw new Error(
        "Attempt cleanup leaked cells or sequences; refusing another question",
      );
    if (
      failure &&
      /CUDA|decode.*fail|context.*disposed|assertion|no.*gpu/i.test(failure)
    )
      throw new Error("Systemic runtime failure; frozen submission preserved");
  }
  writeJson(
    `${out}/completed.json`,
    { completedAt: new Date().toISOString(), attempts: summaries },
    true,
  );
});
