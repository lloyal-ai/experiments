import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptedText, extractCode, publicProblem } from '../src/contracts.js';

test('failed, truncated and empty outcomes never become accepted submissions', () => {
  for (const outcome of [
    { result: 'code', failed: 'decode failed' },
    { result: 'code', exitReason: 'maxTurns' },
    { result: '  ' }, { result: null },
  ]) assert.throws(() => acceptedText(outcome));
  assert.equal(acceptedText({ result: 'answer', failed: null }), 'answer');
});

test('public problem projection cannot carry private tests or reference solutions', () => {
  const row = {
    question_id: '42', question_title: 'Example', question_content: 'Add numbers',
    starter_code: '', public_test_cases: '[{"input":"1 2","output":"3","testtype":"stdin"}]',
    private_test_cases: 'SECRET_TEST', reference_solution: 'SECRET_ANSWER',
    metadata: '{"func_name":null,"secret":"SECRET_METADATA"}', difficulty: 'easy',
    contest_date: '2025-04-01T00:00:00', platform: 'atcoder',
  };
  const projected = publicProblem(row);
  assert.equal(projected.id, '42');
  assert.equal(projected.examples.length, 1);
  assert.ok(!JSON.stringify(projected).includes('SECRET'));
});

test('code extraction uses a complete final code fence and rejects prose', () => {
  assert.equal(extractCode('Analysis\n```python\nprint(1)\n```'), 'print(1)');
  assert.equal(extractCode('```python\nprint(1)\n```\nFinal\n```python\nprint(2)\n```'), 'print(2)');
  assert.throws(() => extractCode('I would write a loop.'));
  assert.throws(() => extractCode('```python\nprint('));
});
