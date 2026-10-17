import { main, scoped, ensure } from "effection";
import { Branch, BranchStore } from "@lloyal-labs/sdk";
import { agentPool, parallel, ContextPressure, waitUntilSettled } from "@lloyal-labs/lloyal-agents";
import { defineOutput, renderSpine } from "@lloyal-labs/rig";
import { gpuRuntime, command } from "./runtime.js";
import { writeJson } from "./artifacts.js";
import { readProblem, validateCapacity } from "./aa-lcr.js";
import { useCorpus } from "./corpus-ability.js";
import { AttemptMeter, LimitedPolicy, LIMITS } from "./budgets.js";
import { executeWork } from "./solver.js";
import { SAMPLING } from "./configuration.js";
import { SYSTEM, recipe } from "./prompts.js";
import { decisionSchema } from "./decisions.js";
main(function* () {
  const { ctx, out, manifest, trace } = yield* gpuRuntime(
    "corpus-preflight",
    true,
  );
  writeJson(`${out}/recipe.json`, recipe(), true);
  const problem = readProblem("work/prepared/aa-lcr-v1.1-ready/4.json");
  const events: unknown[] = [];
  const record = (type: string, data: unknown) => {
    events.push({ type, data });
    console.log(JSON.stringify({ type, data }));
    trace.flush();
  };
  const started = performance.now();
  const result = yield* scoped(function* () {
    const corpus = yield* useCorpus(problem, out, record);
    const root = Branch.create(ctx, 0, { ...SAMPLING, seed: 42 }, 2048);
    yield* ensure(() => {
      if (!root.disposed) root.pruneSubtreeSync();
    });
    const chat = ctx.formatChatSync(
      JSON.stringify([
        {
          role: "system",
          content:
            SYSTEM +
            "\n" +
            renderSpine({ abilities: [corpus.ability] }) +
            "\nThe file document-N.md is BEGIN DOCUMENT N, exactly.",
        },
        { role: "user", content: problem.prompt },
      ]),
      { enableThinking: true, addGenerationPrompt: false },
    );
    const tokens = ctx.tokenizeSync(chat.prompt, false);
    validateCapacity(tokens.length, 262144, 49152);
    const t = performance.now();
    yield* waitUntilSettled(root.prefill(tokens));
    record("prefill", {
      inputTokens: tokens.length,
      ms: performance.now() - t,
    });
    const read = corpus.ability.tools.find((t) => t.name === "read_file")!;
    const offset = yield* read.execute({ filename: "document-1.md", startLine: 112 }) as any;
    const expected = problem.documents[0]!.text.split("\n").slice(111, 211).join("\n");
    if (offset.lines?.[0] !== "112-211" || offset.content !== expected)
      throw new Error("Installed corpus ability failed the offset-read regression");
    record("offset-read-check", { lines: offset.lines, characters: offset.content.length });
    const search = corpus.ability.tools.find((t) => t.name === "search")!;
    const found = yield* search.execute({
      query: "prompt injection defense evaluation",
    }) as any;
    if (
      !Array.isArray(found.hits) ||
      !found.hits.length ||
      found.hits.some((h: any) => !/^document-\d+\.md$/.test(h.file))
    )
      throw new Error("Corpus search returned no bounded evidence");
    record("search-check", {
      hits: found.hits.length,
      totalScored: found.totalScored,
    });
    const meter = new AttemptMeter(),
      rejections: unknown[] = [];
    const findings = yield* executeWork(
      root,
      problem,
      decisionSchema.parse({
        action: "discover",
        reason: "Validate four independent full-context discovery workers together",
        topology: "parallel",
        tasks: Array.from({ length: 4 }, (_, i) => ({
          id: `reader_${i}`,
          instruction: `Use read_file to read lines 1-12 of document-${i + 1}.md. Report its opening subject in one sentence, citing a short exact startLine/endLine range from read_file as evidence with document number ${i + 1}. Do not solve the benchmark question.`,
          reason: "Exercise the corpus protocol and exact evidence capture",
          dependsOn: [],
        })),
      }),
      meter,
      42,
      record,
      corpus.ability,
      rejections,
    );
    if (findings.size !== 4)
      throw new Error(
        `Expected four accepted corpus readers, got ${findings.size}: ${JSON.stringify(rejections)}`,
      );
    const decisionOutput = defineOutput("decide", decisionSchema);
    const probePolicy = new LimitedPolicy("controller", meter, "decide");
    const decisionProbe = yield* agentPool({
      parent: root,
      terminal: decisionOutput.tool,
      enableThinking: true,
      policy: probePolicy,
      maxTurns: 8,
      capacity: 1,
      pruneOnReturn: true,
      orchestrate: parallel([{
        key: "answer-contract",
        systemPrompt: SYSTEM,
        content: "Runtime contract probe, not the benchmark question: all needed fixture facts are established. Call decide with action answer and a short reason. Omit topology and tasks because no work remains.",
        seed: 42,
      }]),
    });
    const probeOutcome = decisionProbe.byKey("answer-contract");
    const probe = probeOutcome && decisionOutput.read(probeOutcome);
    const physical = decisionProbe.agents.find((a) => a.agentId === probeOutcome?.agentId);
    if (decisionProbe.failure || probeOutcome?.failed || probeOutcome?.exitReason || !physical || probePolicy.wasCapped(physical.agent) || probe?.action !== "answer")
      throw new Error("Answer-only decision failed through the public tool/grammar path");
    record("answer-decision-check", { decision: probe, tokens: decisionProbe.totalTokens });
    const memory = command("nvidia-smi", [
      "--query-gpu=memory.used,memory.free",
      "--format=csv,noheader,nounits",
    ])
      .split(",")
      .map(Number);
    if (memory[1]! < LIMITS.gpuHeadroomMiB)
      throw new Error("Combined models violate GPU headroom");
    return {
      inputTokens: tokens.length,
      generatedTokens: meter.total,
      peakCells: meter.peakCells,
      reranker: corpus.metrics(),
      memoryMiB: memory,
      accepted: findings.size,
    };
  });
  if (
    new ContextPressure(ctx).cellsUsed !== 0 ||
    new BranchStore(ctx).available !== 16
  )
    throw new Error("Leaked main-model state");
  writeJson(
    `${out}/preflight.json`,
    {
      ...result,
      elapsedMs: performance.now() - started,
      cleanup: { cells: 0, slots: 16 },
      events,
    },
    true,
  );
});
