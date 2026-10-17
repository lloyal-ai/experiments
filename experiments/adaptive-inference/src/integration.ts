import assert from "node:assert/strict";
import { main, scoped, ensure, race, sleep } from "effection";
import { Branch, BranchStore } from "@lloyal-labs/sdk";
import {
  agentPool,
  parallel,
  ContextPressure,
  waitUntilSettled,
} from "@lloyal-labs/lloyal-agents";
import { defineOutput } from "@lloyal-labs/rig";
import { z } from "zod";
import { gpuRuntime } from "./runtime.js";
import { writeJson, digest } from "./artifacts.js";
import { executeWork } from "./solver.js";
import { AttemptMeter, LimitedPolicy, BUDGETS } from "./budgets.js";
import { SAMPLING } from "./configuration.js";
import { SYSTEM } from "./prompts.js";
import { renderPrompt, type Problem } from "./aa-lcr.js";
main(function* () {
  const { ctx, out } = yield* gpuRuntime("retained-topology-integration", true);
  const text =
    "The March inventory contains 117 red parts and 165 blue parts. There are no other parts in the March inventory.";
  const documents = [{ filename: "inventory.txt", text, sha256: digest(text) }];
  const question = "How many parts are in the March inventory in total?";
  const problem = {
    id: "fixture",
    category: "fixture",
    setId: "fixture",
    question,
    filenames: ["inventory.txt"],
    publishedInputTokens: 0,
    documents,
    prompt: "",
    promptSha256: "",
  } as Problem;
  problem.prompt = renderPrompt(problem.question, documents);
  problem.promptSha256 = digest(problem.prompt);
  const events: unknown[] = [],
    meter = new AttemptMeter();
  yield* scoped(function* () {
    const root = Branch.create(ctx, 0, { ...SAMPLING, seed: 81 }, 2048);
    yield* ensure(() => {
      if (!root.disposed) root.pruneSubtreeSync();
    });
    const f = ctx.formatChatSync(
      JSON.stringify([
        { role: "system", content: SYSTEM },
        { role: "user", content: problem.prompt },
      ]),
      { enableThinking: true, addGenerationPrompt: false },
    );
    yield* waitUntilSettled(root.prefill(ctx.tokenizeSync(f.prompt, false)));
    const handle = root.handle;
    const result = yield* executeWork(
      root,
      problem,
      {
        action: "compose",
        reason:
          "Exercise two alternative supported calculations and retain one.",
        topology: "speculate",
        tasks: [
          {
            id: "sum",
            instruction:
              "Calculate total March parts by adding the two quantities. Quote the inventory statement exactly and call findings.",
            reason: "Direct sum",
            dependsOn: [],
          },
          {
            id: "check",
            instruction:
              "Independently verify the total March inventory, checking that no other parts are listed. Quote the inventory statement exactly and call findings.",
            reason: "Independent completeness check",
            dependsOn: [],
          },
        ],
      },
      meter,
      82,
      (type, data) => {
        events.push({ type, data });
        console.log(JSON.stringify({ type, data }));
      },
    );
    assert.equal(result.size, 1);
    assert.equal(root.handle, handle);
    const output = defineOutput(
      "finish",
      z.object({ total: z.number().int() }),
    );
    const policy = new LimitedPolicy("synthesis", meter, "finish");
    const started = performance.now(),
      before = meter.total;
    const pool = yield* agentPool({
      parent: root,
      terminal: output.tool,
      policy,
      maxTurns: BUDGETS.synthesis.maxTurns,
      capacity: 1,
      pruneOnReturn: true,
      orchestrate: parallel([
        {
          key: "continuation",
          seed: 83,
          systemPrompt: SYSTEM,
          content:
            "Read the retained calculation above. Call finish with the total March inventory.",
        },
      ]),
    });
    assert.equal(output.read(pool.byKey("continuation")!)?.total, 282);
    const seconds = (performance.now() - started) / 1000;
    const generated = meter.total - before;
    writeJson(
      `${out}/continuation.json`,
      { generated, seconds, tokensPerSecond: generated / seconds },
      true,
    );
  });
  assert.equal(new ContextPressure(ctx).cellsUsed, 0);
  assert.equal(new BranchStore(ctx).available, 16);
  assert.ok(
    events.some(
      (e: any) =>
        e.type === "fast-forward" && e.data.kind === "selected-candidate",
    ),
  );
  // Cancellation must settle the native prefill before the scope prunes it.
  const cancelled = yield* race([
    scoped(function* () {
      const b = Branch.create(ctx, 0, SAMPLING, 2048);
      yield* ensure(() => {
        if (!b.disposed) b.pruneSubtreeSync();
      });
      yield* waitUntilSettled(
        b.prefill(
          ctx.tokenizeSync("Cancellation safety token. ".repeat(12000), false),
        ),
      );
      return "prefill";
    }),
    (function* () {
      yield* sleep(1);
      return "cancel";
    })(),
  ]);
  assert.equal(new ContextPressure(ctx).cellsUsed, 0);
  assert.equal(new BranchStore(ctx).available, 16);
  writeJson(
    `${out}/integration.json`,
    {
      passed: true,
      events,
      generatedTokens: meter.total,
      peakCells: meter.peakCells,
      cancelled,
      cleanCells: 0,
      availableSequences: 16,
    },
    true,
  );
  console.log(
    "Retained selection, two-level adoption, continuation and cancellation passed.",
  );
});
