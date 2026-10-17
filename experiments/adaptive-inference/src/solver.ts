import {
  evidenceSpanSchema,
  findingOutputSchema,
  resolveFinding,
  decisionFeedback,
  InvalidDecision,
} from "./evidence-spans.js";
import { z } from "zod";
import { scoped, ensure, type Operation } from "effection";
import { Branch, type SessionContext } from "@lloyal-labs/sdk";
import {
  agentPool,
  parallel,
  withSpine,
  useAgentPool,
  createToolkit,
  waitUntilSettled,
  type SpawnSpec,
} from "@lloyal-labs/lloyal-agents";
import {
  defineOutput,
  renderSpine,
  renderAgentPreamble,
  type Ability,
  type Output,
} from "@lloyal-labs/rig";
import {
  AttemptMeter,
  LimitedPolicy,
  BUDGETS,
  LIMITS,
  WindDown,
  type Role,
} from "./budgets.js";
import {
  decisionSchema,
  acceptedFinding,
  stableSeed,
  type Decision,
  type Finding,
  type WorkTask,
} from "./decisions.js";
import { guardedShape, DependencyRejected } from "./composition.js";
import { SYSTEM, prompt } from "./prompts.js";
import { SAMPLING } from "./configuration.js";
import { validateCapacity, type Problem } from "./aa-lcr.js";
import { ArithmeticTool } from "./corpus-tools.js";
import { finalAnswer } from "./final-output.js";

type RecordEvent = (type: string, data: unknown) => void;
function* one<T>(
  root: Branch,
  output: Output<T>,
  role: Role,
  meter: AttemptMeter,
  seed: number,
  content: string,
  record: RecordEvent,
  ability?: Ability,
  originalQuestion?: string,
): Operation<T> {
  const policy = new LimitedPolicy(role, meter, output.tool.name);
  const started = performance.now();
  record("stage-start", { role });
  const pool = yield* agentPool({
    parent: root,
    terminal: output.tool,
    tools: ability ? [...ability.tools, new ArithmeticTool()] : [],
    scorer: ability?.source.createScorer(originalQuestion ?? content),
    enableThinking: true,
    policy,
    maxTurns: BUDGETS[role].maxTurns,
    capacity: 1,
    pruneOnReturn: true,
    orchestrate: parallel([
      {
        key: "value",
        systemPrompt: SYSTEM,
        content: ability
          ? renderAgentPreamble(ability, { maxTurns: BUDGETS[role].maxTurns }) +
            "\n" +
            content
          : content,
        seed,
        assignedAbility: ability?.manifest.name,
      },
    ]),
  });
  const outcome = pool.byKey("value"),
    physical = pool.agents.find((a) => a.agentId === outcome?.agentId);
  record(role, {
    ms: performance.now() - started,
    outcomes: pool.outcomes,
    tokens: pool.totalTokens,
    failure: pool.failure?.message ?? null,
  });
  if (pool.failure) throw pool.failure;
  if (
    !outcome ||
    outcome.failed ||
    outcome.exitReason ||
    !physical ||
    policy.wasCapped(physical.agent)
  )
    throw new Error(
      `${role} did not complete: ${outcome?.failed ?? outcome?.exitReason ?? "missing/capped result"}`,
    );
  const result = output.read(outcome);
  if (result === null) {
    if (role === "controller")
      throw new InvalidDecision(decisionFeedback(outcome.result ?? "null"));
    throw new Error(`${role} returned an invalid typed output`);
  }
  return result;
}

export function* executeWork(
  root: Branch,
  problem: Problem,
  decision: Decision,
  meter: AttemptMeter,
  seed: number,
  record: RecordEvent,
  ability?: Ability,
  rejections: unknown[] = [],
): Operation<Map<string, Finding>> {
  const schema = findingOutputSchema(problem.documents);
  const output = defineOutput("report", evidenceSpanSchema(problem.documents), {
    grammarOrder: "sampleFirst",
    capture: (value) =>
      JSON.stringify(resolveFinding(value, problem.documents)),
    description:
      "Submit supported findings with document numbers and exact line ranges from read_file. The harness copies those source passages; do not transcribe quotes.",
  });
  const role = decision.action === "verify" ? "verifier" : "worker";
  const policy = new LimitedPolicy(role, meter, output.tool.name),
    findings = new Map<string, Finding>();
  const specs = (t: WorkTask): SpawnSpec => ({
    key: t.id,
    seed: stableSeed(seed, t.id),
    systemPrompt: SYSTEM,
    assignedAbility: ability?.manifest.name,
    content:
      (ability
        ? renderAgentPreamble(ability, {
            agentCount: 1,
            maxTurns: BUDGETS[role].maxTurns,
          }) + "\n"
        : "") +
      prompt("worker", {
        question: problem.question,
        instruction: t.instruction,
        reason: t.reason,
      }),
  });
  const orchestrate = guardedShape(decision, specs, findings, (a) => {
    const accepted = acceptedFinding(a, schema, policy.wasCapped(a));
    if (!accepted) {
      let reason: unknown = a.failed ?? a.exitReason ?? "Generated-token cap";
      if (a.result && !policy.wasCapped(a) && !a.failed && !a.exitReason) {
        try {
          const parsed = schema.safeParse(JSON.parse(a.result));
          reason = parsed.error?.issues ?? "Invalid result";
        } catch {
          reason = "Report was not valid JSON";
        }
      }
      const rejection = { agent: a.id, reason };
      rejections.push(rejection);
      record("finding-rejected", rejection);
    }
    return accepted;
  });
  const toolkit = createToolkit(
    [...(ability?.tools ?? []), new ArithmeticTool()],
    output.tool,
  );
  const started = performance.now(),
    rootHandle = root.handle,
    rootPosition = root.position;
  record("stage-start", {
    role,
    topology: decision.topology,
    tasks: decision.tasks.map((t) => t.id),
  });
  // All writes land on a direct child. Accepted stage state is adopted atomically;
  // a failed stage leaves its caller's trunk untouched.
  return yield* withSpine(
    { parent: root, enableThinking: true },
    function* (spine) {
      const accepted = yield* scoped(function* () {
        const handle = spine.handle,
          position = spine.position;
        const sub = yield* useAgentPool({
          spine,
          tools: toolkit.toolMap,
          toolsJson: toolkit.toolsJson,
          terminalToolName: toolkit.terminalName,
          policy,
          scorer: ability?.source.createScorer(problem.question),
          maxTurns: BUDGETS[role].maxTurns,
          capacity: LIMITS.capacity,
          enableThinking: true,
          pruneOnReturn: decision.topology !== "speculate",
          orchestrate,
        });
        let next = yield* sub.next();
        while (!next.done) next = yield* sub.next();
        const pool = next.value;
        record("work", {
          decision,
          ms: performance.now() - started,
          outcomes: pool.outcomes,
          findings: [...findings],
          failure: pool.failure?.message ?? null,
        });
        if (pool.failure) {
          if (pool.failure instanceof DependencyRejected)
            return new Map<string, Finding>();
          throw pool.failure;
        }
        if (!findings.size) return findings;
        let accepted = findings;
        if (decision.topology === "speculate") {
          const candidates = [...findings.keys()];
          const choose = defineOutput(
            "select",
            z
              .object({
                key: z
                  .string()
                  .refine(
                    (k) => candidates.includes(k),
                    "Select an accepted candidate key",
                  ),
                reason: z.string().min(1),
              })
              .strict(),
          );
          const selected =
            candidates.length === 1
              ? { key: candidates[0]!, reason: "Only accepted candidate" }
              : yield* one(
                  spine,
                  choose,
                  "verifier",
                  meter,
                  stableSeed(seed, "selector"),
                  `Select the best supported complete approach to the original question. Compare against the original documents, not confidence or writing style. Do not use external answers. Call select.\nQuestion: ${problem.question}\nAccepted candidates: ${JSON.stringify([...findings])}`,
                  record,
                );
          const outcome = pool.byKey(selected.key),
            winner = pool.agents.find((a) => a.agentId === outcome?.agentId);
          if (!winner || winner.branch.disposed || spine.position !== position)
            throw new Error("Speculative winner no longer eligible");
          const before = performance.now();
          yield* waitUntilSettled(spine.fastForward(winner.branch));
          if (spine.handle !== handle)
            throw new Error("Fast-forward changed spine identity");
          record("fast-forward", {
            kind: "selected-candidate",
            selected,
            handle,
            previousPosition: position,
            position: spine.position,
            ms: performance.now() - before,
          });
          accepted = new Map([[selected.key, findings.get(selected.key)!]]);
        }
        return accepted;
      }); // Retained siblings are reclaimed before collapsing the next tree edge.
      if (!accepted.size) return accepted;
      if (root.position !== rootPosition)
        throw new Error("Trunk changed during isolated work");
      const before = performance.now();
      yield* waitUntilSettled(root.fastForward(spine));
      if (root.handle !== rootHandle)
        throw new Error("Fast-forward changed trunk identity");
      record("fast-forward", {
        kind: "stage-commit",
        handle: rootHandle,
        previousPosition: rootPosition,
        position: root.position,
        ms: performance.now() - before,
      });
      return accepted;
    },
  );
}

export function* solve(
  ctx: SessionContext,
  problem: Problem,
  meter: AttemptMeter,
  seed: number,
  nBatch: number,
  record: RecordEvent,
  ability?: Ability,
): Operation<string> {
  return yield* scoped(function* () {
    const root = Branch.create(ctx, 0, { ...SAMPLING, seed }, nBatch);
    yield* ensure(() => {
      if (!root.disposed) root.pruneSubtreeSync();
    });
    const formatted = ctx.formatChatSync(
      JSON.stringify([
        {
          role: "system",
          content:
            SYSTEM +
            (ability
              ? "\n" +
                renderSpine({ abilities: [ability] }) +
                "\nCorpus filenames document-N.md map exactly to BEGIN DOCUMENT N, preserving every original byte. These are the only allowed sources."
              : ""),
        },
        { role: "user", content: problem.prompt },
      ]),
      { enableThinking: true, addGenerationPrompt: false },
    );
    const tokens = ctx.tokenizeSync(formatted.prompt, false);
    validateCapacity(tokens.length, 262144, 49152);
    const start = performance.now();
    yield* waitUntilSettled(root.prefill(tokens));
    record("input", {
      inputTokens: tokens.length,
      prefillMs: performance.now() - start,
      promptSha256: problem.promptSha256,
    });
    const history: unknown[] = [],
      completed: unknown[] = [];
    let requested = 0;
    const decisionOutput = defineOutput("decide", decisionSchema, {
      description:
        "Choose the next useful reasoning action and its executable topology.",
    });
    for (
      let round = 1;
      round <= LIMITS.rounds && meter.total < LIMITS.windDownTokens;
      round++
    ) {
      let decision: Decision;
      try {
        decision = yield* one(
          root,
          decisionOutput,
          "controller",
          meter,
          stableSeed(seed, round, "decision"),
          prompt("controller", {
            question: problem.question,
            history: JSON.stringify(history),
            completed: JSON.stringify(completed),
            remaining: LIMITS.workerSpawns - requested,
            round,
          }),
          record,
        );
      } catch (e) {
        history.push({
          round,
          error: e instanceof Error ? e.message : String(e),
        });
        record("controller-rejected", {
          round,
          error: e instanceof Error ? e.message : String(e),
        });
        if (e instanceof InvalidDecision) continue;
        if (e instanceof WindDown) break;
        throw e;
      }
      record("decision", { round, decision });
      if (decision.action === "answer") break;
      if (decision.tasks.length > LIMITS.workerSpawns - requested) {
        history.push({
          round,
          error: "Plan exceeds remaining worker allowance",
        });
        break;
      }
      requested += decision.tasks.length;
      let findings: Map<string, Finding>;
      const rejections: unknown[] = [];
      try {
        findings = yield* executeWork(
          root,
          problem,
          decision,
          meter,
          stableSeed(seed, round, "work"),
          record,
          ability,
          rejections,
        );
      } catch (e) {
        if (!(e instanceof WindDown)) throw e;
        history.push({ round, error: e.message });
        break;
      }
      completed.push(
        ...[...findings].map(([id, finding]) => ({ round, id, finding })),
      );
      history.push({
        round,
        action: decision.action,
        topology: decision.topology,
        reason: decision.reason,
        accepted: [...findings.keys()],
        rejections,
        missing: decision.tasks
          .filter((t) => !findings.has(t.id))
          .map((t) => t.id),
      });
      if (requested >= LIMITS.workerSpawns) break;
    }
    return yield* one(
      root,
      finalAnswer,
      "synthesis",
      meter,
      stableSeed(seed, "final"),
      prompt("final", {
        question: problem.question,
        history: JSON.stringify(history),
      }),
      record,
      ability,
      problem.question,
    );
  });
}
