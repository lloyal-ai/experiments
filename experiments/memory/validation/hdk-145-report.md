## Observed failure

A real Fieldnote research run completed all four inquiries, then failed to allocate its synthesis agent:

```text
useAgent: the agent was not seated (no_sequence)
```

The last two completed inquiry branches were pruned only after the run aborted. This suggests that the non-shared warm-parent `agentPool()` path retains pool-owned resources beyond its return, into the caller's next operation. The failure and trace ordering are confirmed; the cleanup-scope explanation is a hypothesis pending a focused regression.

## Environment

- `@lloyal-labs/lloyal-agents` 6.0.0; source inspected at `b9cf6d87c3523208dc38964845ed19d115b19a65`.
- macOS arm64, Metal, Node 26.10.0; Qwen3.5 4B with multimodal projector and Qwen3 reranker.
- Fieldnote `harness.yml`: `model.llm.context: 32768`, `model.llm.branches: 5`. This limit matches the original app configuration.
- Survey / Standard effort; documents and Markdown corpus; four reviewed inquiries. All four returned findings: 4,145 reported agent tokens and 24 tool calls over approximately 285 seconds of research.
- No SDK or native implementation changes were made for this run.

## Operation shape

The application uses an outer `withSpine()`, awaits `agentPool({ parent: spine, ... })` without a shared `systemPrompt`, and then invokes settlement using `useAgent({ parent: spine, ... })` in the same enclosing scope.

Conceptual sequence (not a standalone reproduction):

```ts
yield* withSpine(options, function* (spine) {
  const findings = yield* agentPool({ parent: spine, /* inquiries, tools, terminal, budget */ });
  return yield* settleUsingUseAgent(spine, findings);
});
```

## Trace evidence

These are observation sequence numbers from the recorded native event stream:

```text
36170 agent:done
36173 pool:close
36174 branch:prune        handle=327685 position=0 (inner separator spine)
36175 research:done       totalTokens=4145 totalToolCalls=24
36176 synthesize:start
36177 scope:open          useAgent
36179 scope:open          pool
36180 pool:open
36181 pool:spawnRefused   reason=no_sequence
36182 pool:close
36183 scope:close         pool
36184 scope:close         useAgent
36185 branch:prune        handle=524291 position=0 (outer spine)
36186 run:aborted
36187 ui:error            useAgent: the agent was not seated (no_sequence)
36188 branch:prune        handle=524292 position=-1
36189 branch:prune        handle=458754 position=-1
36190 scope:close         pool (research pool)
36191 scope:close         withSpine
36192 scope:close         withSpine
```

The final two inquiry branch handles are `524292` and `458754`. Earlier completed inquiries were pruned while the research pool continued ticking. The refusal is sequence allocation, not evidence of exhausting all KV cells or host RAM.

## Suspected ownership boundary

- [`agentPool()`](https://github.com/lloyal-ai/hdk/blob/b9cf6d87c3523208dc38964845ed19d115b19a65/packages/agents/src/create-agent-pool.ts#L130-L227) documents returning with branches pruned. In non-shared warm mode it passes `warmParent` to `useAgentPool()`; the inner spine is a separate fork. The wrapper drains the subscription and returns without an explicit scope boundary around that resource.
- [`useAgentPool()` cleanup](https://github.com/lloyal-ai/hdk/blob/b9cf6d87c3523208dc38964845ed19d115b19a65/packages/agents/src/agent-pool.ts#L217) registers `releaseUnadmitted()` and `pruneAll()` through the resource's `ensure`. The final trace cleanup occurs when the enclosing caller unwinds.
- [`withSpine()`](https://github.com/lloyal-ai/hdk/blob/b9cf6d87c3523208dc38964845ed19d115b19a65/packages/agents/src/spine.ts#L314-L327) prunes its own subtree. Warm-parent inquiry branches are siblings of the wrapper's inner spine, so that cleanup does not reclaim them.
- [`useAgent()`](https://github.com/lloyal-ai/hdk/blob/b9cf6d87c3523208dc38964845ed19d115b19a65/packages/agents/src/use-agent.ts#L105-L183) forks its root and then seats an agent beneath it. Retained inquiry branches can therefore matter at the five-sequence limit even though the research pool has returned.

## Expected behavior / regression to add

For the default branch-pruning contract, returning from the high-level `agentPool()` operation should release pool-owned completed inquiry resources, while preserving the caller's spine, accepted spine extensions, and durable findings. A subsequent agent should be allocatable using the capacity released by the completed pool.

Add a focused warm-parent pool → synthesis test with constrained sequence capacity. Assert cleanup before the next operation, caller-spine survival, and no `no_sequence` refusal. Cover the shared and cold paths, cancellation/error teardown, and the explicit `pruneOnReturn: false` resource contract before choosing a fix. A scope change has not yet been validated.

## Follow-up experiment

The next diagnostic will increase `branches` in the benchmark's native launch configuration and rerun the same UI journey. Its configuration and result will be recorded separately. Success with more capacity would be a workaround observation, not proof of this precise diagnosis or an SDK fix.
