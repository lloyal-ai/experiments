import {readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {summarizeSession} from './lib/session-report.mjs';

const path = process.argv[2];
if (!path) throw new Error('Usage: node scripts/summarize-session.mjs SESSION_DIR [--write]');
const dir = resolve(path), source = await readFile(resolve(dir,'observations.jsonl'),'utf8');
// A running append-only journal can have one unfinished final line. Never discard malformed completed lines.
const lines = source.split('\n');lines.pop();
const rows = lines.filter(Boolean).map(line => JSON.parse(line));
const manifest = JSON.parse(await readFile(resolve(dir,'manifest.json'),'utf8'));
const report = summarizeSession(rows,manifest);
if (process.argv.includes('--write')) await writeFile(resolve(dir,'diagnostic-summary.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...report,attempts:report.attempts.map(({answer,findings,toolCalls,errors,...rest}) => ({...rest,answerChars:answer?.length ?? 0,findings:findings.length,toolCalls:toolCalls.length,errors}))},null,2));
