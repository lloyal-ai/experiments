import test from 'node:test';
import assert from 'node:assert/strict';
import { ContextPressure } from '@lloyal-labs/lloyal-agents';
import type { Agent } from '@lloyal-labs/lloyal-agents';
import { AttemptMeter, LimitedPolicy, BUDGETS, LIMITS } from '../src/budgets.js';

test('spent tokens include every branch and recovery; repeated observations and prune do not refund', () => {
  const meter = new AttemptMeter();
  const a = { tokenCount: 12 }, b = { tokenCount: 9 };
  meter.track(a, 'worker'); meter.track(a, 'worker'); meter.track(b, 'verifier');
  assert.equal(meter.total, 21);
  a.tokenCount = 18;
  assert.equal(meter.total, 27);
  assert.deepEqual(meter.byRole(), { worker: 18, verifier: 9 });
  a.tokenCount = 1;
  assert.throws(() => meter.total, /counter/i);
});

test('per-turn cap applies even during terminal emission, and recovery still counts', () => {
  const meter = new AttemptMeter();
  const policy = new LimitedPolicy('worker', meter, 'finish');
  const pressure = new ContextPressure({ nCtx: 262144, cellsUsed: 100000, remaining: 162144, nBatch: 512 });
  const counter = { tokenCount: 32768, turnTokens: 32768, extracting: false } as Agent;
  assert.equal(policy.shouldExit(counter, pressure), true);
  assert.equal(policy.wasCapped(counter), true);
  assert.equal(meter.total, 32768);
});

test('whole-attempt limit refuses a cohort before it overspends the final tokens', () => {
  const meter = new AttemptMeter(10);
  const counter = { tokenCount: 9 };
  meter.track(counter, 'worker');
  meter.beginTick();
  meter.reserveToken();
  assert.throws(() => meter.reserveToken(), /attempt.*token/i);
  assert.equal(meter.total, 9);
});

test('budget reserves are remaining cells and synthesis gets its declared reserved space', () => {
  assert.equal(BUDGETS.worker.context.hardLimit, 24576);
  assert.equal(BUDGETS.synthesis.context.hardLimit, 4096);
  assert.equal(LIMITS.generatedTokens, 196608);
  assert.equal(LIMITS.windDownTokens + LIMITS.finalTokens, LIMITS.generatedTokens);
});

test('recovery below the context reserve cannot bypass the whole-attempt token cap', () => {
  const meter = new AttemptMeter(10);
  const policy = new LimitedPolicy('worker', meter, 'finish');
  const pressure = new ContextPressure({ nCtx: 262144, cellsUsed: 260000, remaining: 2144, nBatch: 512 }, BUDGETS.worker.context);
  const recovering = { tokenCount: 10, turnTokens: 8, extracting: true } as Agent;
  assert.throws(() => policy.shouldExit(recovering, pressure), /attempt.*token/i);
});
