import { parallel, chain, fanout, dag } from "@lloyal-labs/lloyal-agents";
import type {
  Agent,
  Orchestrator,
  PoolContext,
  SpawnSpec,
} from "@lloyal-labs/lloyal-agents";
import { assertWorkDecision, type Decision, type WorkTask, type Finding } from "./decisions.js";

export class DependencyRejected extends Error {}
/** Acceptance surrounds the public factories; admission, batching and waits remain the pool's. */
export function guardedShape(
  decision: Decision,
  specFor: (t: WorkTask) => SpawnSpec,
  findings: Map<string, Finding>,
  accept: (agent: Agent) => Finding | null,
): Orchestrator {
  assertWorkDecision(decision);
  return function* (ctx) {
    const keys = new Map<number, string>(),
      inherited = new Set<string>();
    const guarded: PoolContext = {
      spine: ctx.spine,
      canFit: (n) => ctx.canFit(n),
      *spawn(spec) {
        const task = decision.tasks.find((t) => t.id === spec.key)!;
        if (task.dependsOn.some((id) => !inherited.has(id)))
          throw new DependencyRejected(
            `Task ${task.id} has no accepted, admitted prerequisite`,
          );
        const agent = yield* ctx.spawn(spec);
        keys.set(agent.id, task.id);
        return agent;
      },
      *waitFor(agent) {
        const final = yield* ctx.waitFor(agent),
          id = keys.get(agent.id)!;
        const finding = accept(final);
        if (finding) findings.set(id, finding);
        else if (!["parallel", "speculate"].includes(decision.topology))
          throw new DependencyRejected(`Task ${id} has no accepted finding`);
        return final;
      },
      *extendSpine(id) {
        const finding = findings.get(id);
        if (!finding)
          throw new DependencyRejected(`No accepted finding for ${id}`);
        const n = yield* ctx.extendSpine(id, JSON.stringify(finding));
        inherited.add(id);
        return n;
      },
    };
    let shape: Orchestrator;
    switch (decision.topology) {
      case "parallel":
      case "speculate":
        shape = parallel(decision.tasks.map(specFor));
        break;
      case "chain":
        shape = chain(decision.tasks, (t) => ({
          task: specFor(t),
          userContent: t.id,
        }));
        break;
      case "fanout":
        shape = fanout(
          {
            task: specFor(decision.tasks[0]!),
            userContent: decision.tasks[0]!.id,
          },
          decision.tasks.slice(1).map(specFor),
        );
        break;
      case "dag":
        shape = dag(
          decision.tasks.map((t) => ({
            id: t.id,
            task: specFor(t),
            dependsOn: t.dependsOn,
            userContent: t.id,
          })),
        );
        break;
    }
    yield* shape(guarded);
    if (decision.topology === "speculate") return; // The retained winner, rather than sibling text, becomes the trunk.
    for (const [id, finding] of findings)
      if (!inherited.has(id))
        yield* ctx.extendSpine(id, JSON.stringify(finding));
  };
}
