import test from "node:test";
import assert from "node:assert/strict";
import { run, createChannel } from "effection";
import type { Agent, PoolContext } from "@lloyal-labs/lloyal-agents";
import {
  decisionSchema,
  findingSchema,
  acceptedFinding,
  stableSeed,
} from "../src/decisions.js";
import { guardedShape } from "../src/composition.js";

const task = (id: string, dependsOn: string[] = []) => ({
  id,
  instruction: `Check ${id}`,
  reason: "Required by question",
  dependsOn,
});
const compose = (topology: string, tasks: unknown[]) => ({
  action: "compose",
  reason: "Resolve distinct facts",
  topology,
  tasks,
});
const sources = [{ text: "Revenue rose from 10 in 2024 to 12 in 2025." }];
const report = {
  finding: "Revenue rose by 20%.",
  evidence: [{ document: 1, quote: "10 in 2024 to 12 in 2025" }],
  uncertainty: "",
};

test("evidence quotes must occur in the declared source, preserving normalized whitespace", () => {
  const schema = findingSchema(sources);
  assert.ok(schema.safeParse(report).success);
  assert.ok(
    schema.safeParse({
      ...report,
      evidence: [{ document: 1, quote: "10 in 2024\n to 12 in 2025" }],
    }).success,
  );
  assert.equal(
    schema.safeParse({
      ...report,
      evidence: [{ document: 1, quote: "99 in 2025" }],
    }).success,
    false,
  );
  assert.equal(
    schema.safeParse({
      ...report,
      evidence: [{ document: 2, quote: report.evidence[0].quote }],
    }).success,
    false,
  );
});

test("protocol fragments and capped findings cannot become accepted evidence", () => {
  const schema = findingSchema(sources);
  assert.equal(
    schema.safeParse({ ...report, finding: "<parameter=finding>Revenue" })
      .success,
    false,
  );
  assert.equal(
    acceptedFinding(
      { result: JSON.stringify(report), failed: null, exitReason: "maxTurns" },
      schema,
      false,
    ),
    null,
  );
  assert.equal(
    acceptedFinding(
      { result: JSON.stringify(report), failed: null },
      schema,
      true,
    ),
    null,
  );
  assert.deepEqual(
    acceptedFinding(
      { result: JSON.stringify(report), failed: null },
      schema,
      false,
    ),
    report,
  );
});

test("typed decisions reject cycles, unknown prerequisites, and inconsistent topologies", () => {
  assert.ok(
    decisionSchema.safeParse(compose("dag", [task("a"), task("b", ["a"])]))
      .success,
  );
  assert.equal(
    decisionSchema.safeParse(
      compose("dag", [task("a", ["b"]), task("b", ["a"])]),
    ).success,
    false,
  );
  assert.equal(
    decisionSchema.safeParse(compose("dag", [task("a", ["missing"])])).success,
    false,
  );
  assert.equal(
    decisionSchema.safeParse(compose("parallel", [task("a"), task("b", ["a"])]))
      .success,
    false,
  );
  assert.equal(
    decisionSchema.safeParse(compose("speculate", [task("a"), task("a")]))
      .success,
    false,
  );
  assert.equal(
    decisionSchema.safeParse(compose("chain", [task("a"), task("b")])).success,
    false,
  );
});

test("failed prerequisites never spawn dependants; accepted findings extend before dependent spawn", async () => {
  for (const valid of [false, true]) {
    const events: string[] = [],
      byId = new Map<number, string>();
    let next = 1;
    const ctx = {
      spine: {},
      canFit: () => true,
      *spawn(spec: { key?: string }) {
        const id = next++;
        byId.set(id, spec.key!);
        events.push("spawn:" + spec.key);
        return { id } as Agent;
      },
      *waitFor(a: Agent) {
        return {
          ...a,
          result: valid ? JSON.stringify(report) : null,
          failed: valid ? null : "failure",
        } as Agent;
      },
      *extendSpine(user: string) {
        events.push("extend:" + user);
        return 1;
      },
    } as unknown as PoolContext;
    const plan = decisionSchema.parse(
      compose("dag", [task("a"), task("b", ["a"])]),
    );
    const accepted = new Map();
    const op = guardedShape(
      plan,
      (t) => ({ key: t.id, content: t.instruction, systemPrompt: "" }),
      accepted,
      (a) => acceptedFinding(a, findingSchema(sources), false),
    );
    if (valid) {
      await run(() => op(ctx));
      assert.deepEqual(events, ["spawn:a", "extend:a", "spawn:b", "extend:b"]);
    } else {
      await assert.rejects(
        run(() => op(ctx)),
        /accepted/,
      );
      assert.deepEqual(events, ["spawn:a"]);
    }
  }
});

test("seeds are reproducible and distinguish repeat, stage and task", () => {
  assert.equal(stableSeed(42, "5", 0, "a"), stableSeed(42, "5", 0, "a"));
  assert.notEqual(stableSeed(42, "5", 0, "a"), stableSeed(42, "5", 1, "a"));
  assert.notEqual(stableSeed(42, "5", 0, "a"), stableSeed(42, "5", 0, "b"));
});

test("a discovery step accepts any valid singleton topology", () => {
  for (const topology of ["parallel", "chain", "dag"]) {
    assert.ok(
      decisionSchema.safeParse({
        action: "discover",
        reason: "Identify candidates first",
        topology,
        tasks: [task("survey")],
      }).success,
      topology,
    );
  }
});


test("independent discovery tasks can run together before their findings inform later work", { timeout: 1000 }, async () => {
  const plan = decisionSchema.parse({
    action: "discover",
    reason: "Identify candidates in two supplied document groups",
    topology: "parallel",
    tasks: [task("survey_north"), task("survey_south")],
  });
  const events: string[] = [];
  let next = 1;
  const ready = createChannel<void>();
  const ctx = {
    spine: {},
    canFit: () => true,
    *spawn(spec: { key: string }) {
      events.push("spawn:" + spec.key);
      const agent = { id: next++, result: JSON.stringify(report), failed: null } as Agent;
      if (next === 3) yield* ready.send();
      return agent;
    },
    *waitFor(a: Agent) {
      const subscription = yield* ready;
      if (next < 3) yield* subscription.next();
      events.push("complete:" + a.id);
      return a;
    },
    *extendSpine(id: string) {
      events.push("extend:" + id);
      return 1;
    },
  } as unknown as PoolContext;
  const findings = new Map();
  await run(() => guardedShape(
    plan,
    (t) => ({ key: t.id, content: t.instruction, systemPrompt: "" }),
    findings,
    (a) => acceptedFinding(a, findingSchema(sources), false),
  )(ctx));
  assert.deepEqual(events.slice(0, 2), ["spawn:survey_north", "spawn:survey_south"]);
  assert.equal(findings.size, 2);
  assert.ok(events.indexOf("extend:survey_north") > events.indexOf("complete:2"));
});

test("answer decisions need only an action and reason; execution fields belong to work", () => {
  assert.deepEqual(decisionSchema.parse({ action: "answer", reason: "The requested facts are established." }), { action: "answer", reason: "The requested facts are established." });
  assert.equal(decisionSchema.safeParse({ action: "compose", reason: "More work." }).success, false);
  assert.equal(decisionSchema.safeParse({ action: "answer", reason: "Done.", topology: "parallel", tasks: [task("unused")] }).success, false);
});
