type Event = { type: string; [key: string]: any };
/** Offline attribution by public agent identities; no solver or grader inputs are changed. */
export function analyzeTrace(events: Event[], trace: Event[]) {
  const agents = new Set<number>(
    events.flatMap((e) => (e.data?.outcomes ?? []).map((o: any) => o.agentId)),
  );
  const pools = new Set(
    trace
      .filter((e) => e.type === "agent:spawn" && agents.has(e.agentId))
      .map((e) => e.parentTraceId),
  );
  const tools: Record<
    string,
    { calls: number; admittedCells: number; cumulativeMs: number }
  > = {};
  let admittedToolCells = 0,
    cumulativeToolMs = 0,
    maxConcurrentAgents = 0;
  for (const e of trace) {
    if (e.type === "pool:tick" && pools.has(e.parentTraceId))
      maxConcurrentAgents = Math.max(maxConcurrentAgents, e.activeAgents ?? 0);
    if (
      !agents.has(e.agentId) ||
      !["tool:dispatch", "tool:result"].includes(e.type)
    )
      continue;
    const entry = (tools[e.tool] ??= {
      calls: 0,
      admittedCells: 0,
      cumulativeMs: 0,
    });
    if (e.type === "tool:dispatch") entry.calls++;
    else {
      entry.admittedCells += e.cells ?? 0;
      entry.cumulativeMs += e.durationMs ?? 0;
      admittedToolCells += e.cells ?? 0;
      cumulativeToolMs += e.durationMs ?? 0;
    }
  }
  const fastForwards: Record<string, number> = {};
  for (const e of events)
    if (e.type === "fast-forward")
      fastForwards[e.data.kind] = (fastForwards[e.data.kind] ?? 0) + 1;
  return {
    agents: agents.size,
    maxConcurrentAgents,
    tools,
    admittedToolCells,
    cumulativeToolMs,
    fastForwards,
    decisions: events
      .filter((e) => e.type === "decision")
      .map((e) => ({
        action: e.data.decision.action,
        topology: e.data.decision.topology,
        tasks: e.data.decision.tasks.length,
      })),
    rejectedFindings: events.filter((e) => e.type === "finding-rejected")
      .length,
  };
}
