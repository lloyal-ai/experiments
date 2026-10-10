import { cpSync, readFileSync, writeFileSync, mkdirSync, existsSync, symlinkSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const memory=resolve(root,'../memory');
const source=resolve(memory,'work/fieldnote-instrumented'), target=resolve(root,'work/fieldnote');
mkdirSync(target,{recursive:true});
cpSync(source,target,{recursive:true,filter:path=>!/(^|\/)(node_modules|dist|dist-web|data|reports|media|\.git)(\/|$)/.test(path)});
const deps=resolve(source,'node_modules');
const fallback=resolve(memory,'work/fieldnote-app/node_modules');
if(!existsSync(resolve(target,'node_modules')))symlinkSync(existsSync(deps)?deps:fallback,resolve(target,'node_modules'),'dir');
const path=resolve(target,'src/harness/research.ts');
const original=readFileSync(path,'utf8');let text=original;
const change=(a,b)=>{if(!text.includes(a))throw new Error('Pinned Fieldnote source changed at '+a);text=text.replace(a,b);};
change('import { BUDGETS }', 'import { benchmarkSampling, benchmarkSeed } from "./benchmark-sampling.js";\nimport { BUDGETS }');
change('  const sources = yield* participating(ask.excluded, ask.sources);','  benchmarkSampling(trunk, "preflight", 2000);\n  const sources = yield* participating(ask.excluded, ask.sources);');
change('  const planner = new PlanTool({','  benchmarkSampling(trunk, "planning", 100);\n  const planner = new PlanTool({');
change('  const a = yield* useAgent({','  benchmarkSampling(trunk, "answer", 4000);\n  const a = yield* useAgent({');
change('  const agent = yield* useAgent({','  benchmarkSampling(spine, "synthesis", 3000);\n  const agent = yield* useAgent({');
change('      seed: 1000 + i,','      seed: benchmarkSeed(1000 + i),');
change('    function* (spine) {','    function* (spine) {\n      benchmarkSampling(spine, "inquiry", 1000);');
writeFileSync(path,text);
writeFileSync(resolve(target,'src/harness/benchmark-sampling.ts'),`import { appendFileSync } from 'node:fs';
import type { Branch } from '@lloyal-labs/sdk';
const config = JSON.parse(process.env.LLOYAL_REASONING_SAMPLING ?? 'null');
export const benchmarkSeed = (seed: number) => config ? seed + config.seed : seed;
export function benchmarkSampling(branch: Branch | null, stage: string, offset: number) {
  if (!config) return;
  if (!branch) throw new Error('Reasoning fixture requires its admitted-image trunk before ' + stage);
  const params = { ...config.sampling, temperature: stage === 'planning' ? 0.3 : config.sampling.temperature,
    seed: benchmarkSeed(offset), penalties: {repeat:1, frequency:0, presence:0, lastN:64} };
  // Public Branch API. Only sampler configuration changes; lineage, prompts and policy are unchanged.
  branch.setSamplerParams(params);
  appendFileSync(process.env.LLOYAL_REASONING_SAMPLER_LOG!, JSON.stringify({stage, branch:branch.handle, position:branch.position, params, applied:true, unixMs:Date.now()})+'\\n');
}
`);
const hash=x=>createHash('sha256').update(x).digest('hex');
const receipt={source:resolve(source,'src/harness/research.ts'),sourceSha256:hash(original),patchedSha256:hash(text),helperSha256:hash(readFileSync(resolve(target,'src/harness/benchmark-sampling.ts'))),scope:'Explicit public Branch sampler settings at stage boundaries; inquiry seed offset. No orchestration, evidence, prompt or budget edits. Preflight agent seeds stay 2000+i, as in the pinned coverage API.'};
mkdirSync(resolve(root,'work'),{recursive:true});writeFileSync(resolve(root,'work/native-patch.json'),JSON.stringify(receipt,null,2));
execFileSync(resolve(target,'node_modules/.bin/esbuild'),['targets/web/serve.ts','--bundle','--platform=node','--format=esm','--packages=external','--outfile=dist/targets/web/serve.mjs'],{cwd:target,stdio:'inherit'});
console.log(JSON.stringify({target,...receipt},null,2));
