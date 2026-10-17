/** Standalone grading entry point. Never imported by the GPU solver. */
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { main, sleep } from 'effection';
import { parse } from 'csv-parse/sync';
import { readSubmission } from './submission.js';
import { readJudgePrompts, JUDGE } from './grading.js';
import { privateKey, requestVerdict, JudgeHttpError } from './judge-api.js';
import { digest, writeJson } from './artifacts.js';
import { DATASET } from './aa-lcr.js';

main(function* () {
  const [submissionPath, datasetPath, keyPath, outputPath] = process.argv.slice(2);
  if (!submissionPath || !datasetPath || !keyPath || !outputPath)
    throw new Error('Usage: grade-aa-lcr <submission.json> <pinned-dataset-dir> <private-key-file> <new-output-dir>');
  const submission = readSubmission(submissionPath);
  if (submission.datasetRevision !== DATASET.revision) throw new Error('Submission dataset revision does not match grader');
  const out = resolve(outputPath);
  mkdirSync(out); // Every grading attempt gets an append-only directory.
  const csv = readFileSync(resolve(datasetPath, 'AA-LCR_Dataset.csv'), 'utf8');
  const readme = readFileSync(resolve(datasetPath, 'README.md'), 'utf8');
  const rows = parse(csv, { columns: true, bom: true }) as Record<string, string>[];
  const matches = rows.filter(row => row.question_id === submission.questionId);
  if (matches.length !== 1) throw new Error('Question missing or duplicated in official keys');
  const row = matches[0]!;
  const prompts = readJudgePrompts(readme);
  writeJson(out + '/manifest.json', { submissionSha256: digest(readFileSync(submissionPath)), dataset: DATASET,
    csvSha256: digest(csv), readmeSha256: digest(readme), promptsSha256: digest(JSON.stringify(prompts)),
    judge: JUDGE, criteriaSerialization: 'JSON array in original semicolon order',
    responseFormat: 'strict JSON schema: verdict only', startedAt: new Date().toISOString() }, true);
  if (submission.status === 'failed') {
    writeJson(out + '/grade.json', { verdict: 'INCORRECT', source: 'solver_failure', apiCalls: 0 }, true);
    return;
  }
  const key = privateKey(keyPath);
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const judged = yield* requestVerdict(prompts, row.question!, row.answer!.split(';'), submission.answer!, key);
      writeJson(out + '/response-' + attempt + '.json', judged, true);
      writeJson(out + '/grade.json', { verdict: judged.verdict, source: 'equality_checker', apiCalls: attempt }, true);
      console.log(JSON.stringify({ questionId: submission.questionId, verdict: judged.verdict, apiCalls: attempt }));
      return;
    } catch (error) {
      const http = error instanceof JudgeHttpError ? error.status : null;
      writeJson(out + '/error-' + attempt + '.json', { type: http ? 'http' : 'invalid_or_incomplete_response',
        httpStatus: http, attempt }, true);
      if (attempt === 3 || http === 401 || http === 403) throw new Error('Judge infrastructure failure; submission remains frozen and ungraded');
      yield* sleep(attempt * 2000);
    }
  }
});
