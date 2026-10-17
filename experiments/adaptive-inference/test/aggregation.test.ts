import test from "node:test";
import assert from "node:assert/strict";
import { aggregate } from "../src/aggregation.js";
test("scores fixed repeats, counts solver failures, refuses missing and duplicate grades", () => {
  const planned = [
    { questionId: "1", repeat: 0 },
    { questionId: "2", repeat: 0 },
    { questionId: "1", repeat: 1 },
    { questionId: "2", repeat: 1 },
  ];
  const graded = planned.map((p, i) => ({
    ...p,
    verdict: i === 0 ? ("CORRECT" as const) : ("INCORRECT" as const),
    status: i === 3 ? ("failed" as const) : ("completed" as const),
  }));
  const score = aggregate(planned, graded);
  assert.equal(score.percent, 25);
  assert.equal(score.solverFailures, 1);
  assert.deepEqual(
    score.repeats.map((r) => r.percent),
    [50, 0],
  );
  assert.throws(() => aggregate(planned, graded.slice(1)), /Missing/);
  assert.throws(() => aggregate(planned, [...graded, graded[0]!]), /Duplicate/);
  assert.throws(
    () =>
      aggregate(planned, [
        ...graded,
        { questionId: "3", repeat: 0, verdict: "CORRECT", status: "completed" },
      ]),
    /Unplanned/,
  );
});
