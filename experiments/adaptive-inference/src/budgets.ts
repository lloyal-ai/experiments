import {
  DefaultAgentPolicy,
  budgetPolicyOpts,
} from "@lloyal-labs/lloyal-agents";
import type {
  Agent,
  Budget,
  ContextPressure,
  PolicyConfig,
  ProduceAction,
} from "@lloyal-labs/lloyal-agents";

export const LIMITS = {
  turnTokens: 32768,
  generatedTokens: 196608,
  windDownTokens: 163840,
  finalTokens: 32768,
  rounds: 6,
  workerSpawns: 16,
  capacity: 4,
  gpuHeadroomMiB: 4096,
} as const;

const recovery = {
  minTokens: 0,
  minToolCalls: 0,
  prompt: ({ budget }: { budget: number }) => ({
    systemPrompt:
      "Preserve only supported findings. Submit the terminal tool with the evidence, uncertainties, and explicit missing information. Do not invent an answer.",
    content: `Conclude from the work already completed. Keep the report within ${Math.min(1200, Math.floor(budget * 0.7))} words.`,
  }),
};
export const BUDGETS = {
  controller: {
    maxTurns: 8,
    context: { softLimit: 49152, hardLimit: 24576 },
    recoveryBudget: 4096,
  },
  worker: {
    maxTurns: 32,
    context: { softLimit: 49152, hardLimit: 24576 },
    recoveryBudget: 8192,
  },
  verifier: {
    maxTurns: 16,
    context: { softLimit: 49152, hardLimit: 24576 },
    recoveryBudget: 8192,
  },
  synthesis: {
    maxTurns: 8,
    context: { softLimit: 12288, hardLimit: 4096 },
    recoveryBudget: 8192,
  },
} as const satisfies Record<string, Budget>;
export type Role = keyof typeof BUDGETS;
type Counter = { readonly tokenCount: number };

export class AttemptLimit extends Error {}
export class WindDown extends Error {}
/** Counts sampled work, independently of whether its KV is still live. */
export class AttemptMeter {
  private readonly counters = new Map<
    Counter,
    { role: Role; observed: number }
  >();
  private reserved = 0;
  peakCells = 0;
  constructor(readonly limit: number = LIMITS.generatedTokens) {}
  track(counter: Counter, role: Role): void {
    if (!this.counters.has(counter))
      this.counters.set(counter, { role, observed: 0 });
    this.refresh();
  }
  private refresh(): void {
    for (const [counter, entry] of this.counters) {
      if (counter.tokenCount < entry.observed)
        throw new Error("Agent token counter regressed");
      entry.observed = counter.tokenCount;
    }
  }
  get total(): number {
    this.refresh();
    return [...this.counters.values()].reduce(
      (sum, entry) => sum + entry.observed,
      0,
    );
  }
  byRole(): Partial<Record<Role, number>> {
    this.refresh();
    const counts: Partial<Record<Role, number>> = {};
    for (const entry of this.counters.values())
      counts[entry.role] = (counts[entry.role] ?? 0) + entry.observed;
    return counts;
  }
  beginTick(): void {
    this.reserved = 0;
  }
  reserveToken(): void {
    if (this.total + this.reserved >= this.limit)
      throw new AttemptLimit("Whole-attempt generated-token limit reached");
    this.reserved++;
  }
}

/** Adds generated-token limits at the framework's public policy seam. */
export class LimitedPolicy extends DefaultAgentPolicy {
  private readonly capped = new WeakSet<Agent>();
  constructor(
    readonly role: Role,
    readonly meter: AttemptMeter,
    terminal: string,
  ) {
    super(
      budgetPolicyOpts(
        {
          ...BUDGETS[role],
          recovery,
          recoveryShape: "parallel",
          nudge: ({ terminal: tool, words }) =>
            `Conclude with ${tool} now; preserve supported evidence within ${words} words.`,
        },
        { terminalToolName: terminal },
      ),
    );
  }
  override resetTick(): void {
    super.resetTick();
    this.meter.beginTick();
  }
  override shouldExit(agent: Agent, pressure: ContextPressure): boolean {
    this.meter.track(agent, this.role);
    this.meter.peakCells = Math.max(this.meter.peakCells, pressure.cellsUsed);
    if (!agent.extracting && agent.turnTokens >= LIMITS.turnTokens) {
      this.capped.add(agent);
      return true;
    }
    // The scheduler ignores exit booleans during recovery, so those tokens still need admission.
    if (!agent.extracting && super.shouldExit(agent, pressure)) return true;
    if (this.role !== "synthesis" && this.meter.total >= LIMITS.windDownTokens)
      throw new WindDown("Exploration wind-down threshold reached");
    this.meter.reserveToken();
    return false;
  }
  override onProduced(
    agent: Agent,
    parsed: Parameters<DefaultAgentPolicy["onProduced"]>[1],
    pressure: ContextPressure,
    config: PolicyConfig,
  ): ProduceAction {
    this.meter.track(agent, this.role);
    if (this.meter.total > this.meter.limit)
      throw new AttemptLimit("Whole-attempt generated-token limit exceeded");
    return super.onProduced(agent, parsed, pressure, config);
  }
  wasCapped(agent: Agent): boolean {
    return this.capped.has(agent);
  }
}
