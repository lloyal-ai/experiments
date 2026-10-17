import test from "node:test";
import assert from "node:assert/strict";
import { analyzeTrace } from "../src/trace-analysis.js";
test("trace costs count only the attempt's agents and distinguish cumulative tool time from wall time", () => {
  const result = analyzeTrace(
    [
      { type: "work", data: { outcomes: [{ agentId: 5 }, { agentId: 6 }] } },
      { type: "fast-forward", data: { kind: "stage-commit" } },
    ],
    [
      { type: "agent:spawn", agentId: 5, parentTraceId: 10 },
      { type: "agent:spawn", agentId: 6, parentTraceId: 10 },
      { type: "pool:tick", parentTraceId: 10, activeAgents: 2 },
      { type: "tool:dispatch", agentId: 5, tool: "search" },
      {
        type: "tool:result",
        agentId: 5,
        tool: "search",
        cells: 100,
        durationMs: 20,
      },
      {
        type: "tool:result",
        agentId: 6,
        tool: "read_file",
        cells: 60,
        durationMs: 15,
      },
      {
        type: "tool:result",
        agentId: 99,
        tool: "search",
        cells: 900,
        durationMs: 900,
      },
    ],
  );
  assert.equal(result.admittedToolCells, 160);
  assert.equal(result.cumulativeToolMs, 35);
  assert.equal(result.maxConcurrentAgents, 2);
  assert.equal(result.fastForwards["stage-commit"], 1);
  assert.equal(result.tools.search?.calls, 1);
});
