import test from 'node:test';
import assert from 'node:assert/strict';
import { judgeRequest, verdictFromResponse, readJudgePrompts } from '../src/grading.js';
import { freezeSubmission, readSubmission } from '../src/submission.js';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('judge receives exactly question, official criteria, frozen answer; never document corpus', () => {
  const prompts = { system: 'Judge', user: '{question}|{official_answer}|{candidate_answer}' };
  const request = judgeRequest(prompts, 'Question', ['criterion 1', 'criterion 2'], 'Candidate');
  assert.deepEqual(request.reasoning, { effort: 'medium' });
  assert.equal(request.model, 'gpt-5.6-luna');
  assert.equal(request.store, false);
  assert.equal(request.input[1].content, 'Question|["criterion 1","criterion 2"]|Candidate');
  assert.equal(JSON.stringify(request).includes('documents'), false);
});

test('judge parses only a completed JSON verdict; refusal, truncation and prose are infrastructure failures', () => {
  const response = (text: string, status = 'completed') => ({ status, output: [
    { type: 'message', content: [{ type: 'output_text', text }] },
  ] });
  assert.equal(verdictFromResponse(response('{"verdict":"CORRECT"}')), 'CORRECT');
  assert.equal(verdictFromResponse(response('{"verdict":"INCORRECT"}')), 'INCORRECT');
  for (const value of [response('CORRECT'), response('{"verdict":"correct"}'),
    response('{"verdict":"CORRECT"}', 'incomplete'),
    { status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'No' }] }] }])
    assert.throws(() => verdictFromResponse(value));
});

test('frozen submission refuses overwrite and verifies immutable payload hash', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'submission-')), 'answer.json');
  const value = { attemptId: 'dev-1', questionId: '5', repeat: 0, seed: 42,
    datasetRevision: '9a77ef56b717057ade24ceab4d273712a0b4f19e',
    promptSha256: 'a'.repeat(64), recipeSha256: 'b'.repeat(64),
    status: 'completed' as const, answer: '42', failure: null };
  freezeSubmission(file, value);
  assert.equal(readSubmission(file).answer, '42');
  assert.throws(() => freezeSubmission(file, value), /exist/i);
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  raw.answer = '43'; writeFileSync(file, JSON.stringify(raw));
  assert.throws(() => readSubmission(file), /hash/i);
});

test('official prompt extraction excludes the legacy version', () => {
  const readme = '## Scoring Approach\nSystem prompt:\n\n\x60\x60\x60\nSYSTEM\n\x60\x60\x60\nUser prompt:\n\n\x60\x60\x60\n{question} {official_answer} {candidate_answer}\n\x60\x60\x60\n<details>LEGACY</details>';
  assert.deepEqual(readJudgePrompts(readme), { system: 'SYSTEM', user: '{question} {official_answer} {candidate_answer}' });
});
