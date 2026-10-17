import assert from 'node:assert/strict';
import { main, scoped, ensure } from 'effection';
import { Branch, BranchStore } from '@lloyal-labs/sdk';
import { agent, waitUntilSettled } from '@lloyal-labs/lloyal-agents';
import { gpuRuntime, writeJson } from './runtime.js';
import { acceptedText, extractCode } from './contracts.js';
main(function* () {
  const { ctx, out, trace } = yield* gpuRuntime('smoke');
  const fastForward = yield* scoped(function* () {
    const trunk = Branch.create(ctx, 0, { temperature: 0, seed: 42 });
    yield* ensure(() => { if (!trunk.disposed) trunk.pruneSubtreeSync(); });
    yield* waitUntilSettled(trunk.prefill(ctx.tokenizeSync('The first observation is one.')));
    const handle = trunk.handle;
    const child = trunk.forkSync();
    yield* waitUntilSettled(child.prefill(ctx.tokenizeSync(' The second observation is two.')));
    const position = child.position;
    const store = new BranchStore(ctx);
    const availableSequences = store.available;
    const childLogits = child.getLogits();
    const start = performance.now();
    yield* waitUntilSettled(trunk.fastForward(child));
    const elapsedMs = performance.now() - start;
    assert.equal(trunk.handle, handle);
    assert.equal(trunk.position, position);
    assert.equal(child.disposed, true);
    assert.equal(store.available, availableSequences + 1);
    assert.deepEqual(trunk.getLogits(), childLogits);
    const rejected = trunk.forkSync();
    yield* waitUntilSettled(trunk.prefill(ctx.tokenizeSync(' The parent advanced.')));
    const parentPosition = trunk.position;
    const childPosition = rejected.position;
    let refused = false;
    try { yield* waitUntilSettled(trunk.fastForward(rejected)); } catch { refused = true; }
    assert.ok(refused, 'advanced parent must reject fast-forward');
    assert.equal(trunk.position, parentPosition);
    assert.equal(rejected.position, childPosition);
    assert.equal(rejected.disposed, false);
    return { handlePreserved: true, position, childSequenceReleased: true, logitsPreserved: true, elapsedMs, refusalUntouched: true };
  });
  const started = performance.now();
  const result = yield* agent({
    systemPrompt: 'You write correct Python programs. Put your complete solution in a Python code block.',
    content: 'Read two integers from standard input and print their sum.',
    enableThinking: false, acceptFreeText: true,
    params: { temperature: 0, seed: 42 },
    budget: { maxTurns: 1, time: { hardLimit: 60_000 } },
  });
  const answer = acceptedText(result);
  const code = extractCode(answer);
  trace.flush();
  writeJson(`${out}/smoke.json`, {
    fastForward, agent: { code, tokens: result.tokenCount, ms: performance.now() - started },
    completedAt: new Date().toISOString(),
  });
  console.error(JSON.stringify({ fastForward, code, tokens: result.tokenCount }));
});
