import { readFileSync, mkdirSync } from 'node:fs';
import { main } from 'effection';
import { readJudgePrompts } from './grading.js';
import { privateKey, requestVerdict } from './judge-api.js';
import { writeJson } from './artifacts.js';
main(function* () {
  const [keyPath, outputPath] = process.argv.slice(2);
  if (!keyPath || !outputPath) throw new Error('Usage: judge-smoke <private-key-file> <new-output-dir>');
  mkdirSync(outputPath);
  const prompts = readJudgePrompts(readFileSync('work/datasets/aa-lcr/README.md', 'utf8'));
  const key = privateKey(keyPath);
  for (const [name, answer, expected] of [['correct', '4', 'CORRECT'], ['incorrect', '5', 'INCORRECT']] as const) {
    const result = yield* requestVerdict(prompts, 'What is 2 + 2? Return one integer.', ['4'], answer, key);
    writeJson(outputPath + '/' + name + '.json', result, true);
    if (result.verdict !== expected) throw new Error('Judge fixture failed');
    console.log(JSON.stringify({ fixture: name, verdict: result.verdict, elapsedMs: result.elapsedMs }));
  }
});
