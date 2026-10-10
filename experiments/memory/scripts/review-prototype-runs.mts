import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ROOT, jsonFile } from '../src/util.js';
import { reportHtml } from '../src/results.js';
import { workloadReview } from '../src/workload-review.js';

// Retain raw events, answers, counters and timing values. Only derived classification
// and presentation change; each run keeps its own review after future code fixes.
const prototypeRuns = [
  '2026-10-08T03-34-04-977Z-3d92cf',
  '2026-10-08T03-37-59-298Z-520ec2',
  '2026-10-08T04-08-33-832Z-5030d4',
  '2026-10-08T04-13-18-559Z-e12c2c',
  '2026-10-08T04-16-21-223Z-b32943',
  '2026-10-08T04-22-24-940Z-cd820c',
  '2026-10-08T04-31-53-445Z-ad4a7c',
];
let count = 0;
for (const id of prototypeRuns) {
  const dir = resolve(ROOT, 'runs', id);
  let summary: any;
  try { summary = JSON.parse(await readFile(resolve(dir, 'summary.json'), 'utf8')); }
  catch (error: any) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') continue; throw error; }
  const reviewed = { ...summary, claimEligible: false, comparison: workloadReview };
  await jsonFile(resolve(dir, 'comparison-review.json'), workloadReview);
  await jsonFile(resolve(dir, 'summary.json'), reviewed);
  await writeFile(resolve(dir, 'report.html'), reportHtml(id, reviewed));
  count++;
}
console.log(`Classified ${count} prototype records as invalid comparisons; raw observations retained.`);
