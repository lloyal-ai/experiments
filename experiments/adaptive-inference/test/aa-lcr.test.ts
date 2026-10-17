import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseQuestions, loadProblem, renderPrompt, validateCapacity } from '../src/aa-lcr.js';

const csv = 'question_id,document_category,document_set_id,question,answer,data_source_filenames,input_tokens,private_notes\n' +
  '7,Academia,set1,"Which value, and why?",SECRET_KEY,b.txt;a.txt,123,DO_NOT_LEAK\n';

test('CSV projection preserves quoted question and document order without key leakage', () => {
  const questions = parseQuestions(csv);
  assert.equal(questions.length, 1);
  assert.deepEqual(questions[0], {
    id: '7', category: 'Academia', setId: 'set1',
    question: 'Which value, and why?', filenames: ['b.txt', 'a.txt'], publishedInputTokens: 123,
  });
  assert.doesNotMatch(JSON.stringify(questions), /SECRET_KEY|DO_NOT_LEAK|answer|private_notes/);
  assert.throws(() => parseQuestions(csv + csv.split('\n')[1] + '\n'), /duplicate/i);
});

test('official prompt contains every source byte in supplied order', () => {
  const root = mkdtempSync(join(tmpdir(), 'aa-lcr-'));
  try {
    mkdirSync(join(root, 'Academia', 'set1'), { recursive: true });
    writeFileSync(join(root, 'Academia', 'set1', 'b.txt'), 'Beta\nwith a second line\n');
    writeFileSync(join(root, 'Academia', 'set1', 'a.txt'), 'Alpha');
    const problem = loadProblem(parseQuestions(csv)[0], root);
    assert.equal(problem.documents[0].text, 'Beta\nwith a second line\n');
    assert.equal(problem.prompt, 'BEGIN INPUT DOCUMENTS\n\nBEGIN DOCUMENT 1:\nBeta\nwith a second line\n\nEND DOCUMENT 1\n\nBEGIN DOCUMENT 2:\nAlpha\nEND DOCUMENT 2\n\nEND INPUT DOCUMENTS\n\nAnswer the following question using the input documents provided above.\n\nSTART QUESTION\n\nWhich value, and why?\n\nEND QUESTION\n');
    assert.equal(problem.prompt, renderPrompt(problem.question, problem.documents));
    assert.match(problem.promptSha256, /^[a-f0-9]{64}$/);
    assert.notEqual(problem.documents[0].sha256, problem.documents[1].sha256);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('missing documents and paths escaping the corpus fail, including symlinks', () => {
  const root = mkdtempSync(join(tmpdir(), 'aa-path-'));
  try {
    const question = parseQuestions(csv)[0];
    assert.throws(() => loadProblem(question, root));
    assert.throws(() => parseQuestions(csv.replace('b.txt;a.txt', '../key.txt')), /path/i);
    mkdirSync(join(root, 'Academia', 'set1'), { recursive: true });
    writeFileSync(join(root, 'secret.txt'), 'outside document set');
    symlinkSync(join(root, 'secret.txt'), join(root, 'Academia', 'set1', 'b.txt'));
    assert.throws(() => loadProblem(question, root), /outside|escape/i);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('capacity uses actual rendered tokens and rejects overflow without truncation', () => {
  assert.doesNotThrow(() => validateCapacity(150000, 262144, 49152));
  assert.throws(() => validateCapacity(220000, 262144, 49152), /capacity/i);
  assert.throws(() => validateCapacity(0, 262144, 49152));
  assert.doesNotThrow(() => validateCapacity(262144 - 49152, 262144, 49152));
});
