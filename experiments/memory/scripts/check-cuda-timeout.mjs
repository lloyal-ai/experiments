// Reproduce one header-timeout failure per prefix length, changing only client deadlines.
import { mkdir, writeFile, readFile, cp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadConfig, ROOT } from '../src/util.ts';
import { receipt, trial } from '../src/experiments/memory/controller.mjs';
import { analyzeCapacity } from '../src/experiments/memory/capacity.mjs';
import { acquireModelLease } from '../src/model-lease.ts';
import { assertNoExternalModels } from '../src/runtime/stack.ts';
const source=resolve(ROOT,'comparisons/cuda-capacity-default-2026-10-10');
const dir=resolve(ROOT,'comparisons/cuda-timeout-repair-2026-10-10');
const config={...await loadConfig(),serverBinary:resolve(ROOT,'instrumentation/llama-server-build/bin/llama-server')};
const original=JSON.parse(await readFile(resolve(source,'protocol.json'),'utf8'));
const names=['sweep-p256-n128-langgraph-r1','sweep-p768-n64-langgraph-r1'];
await mkdir(dir,{recursive:false});
const identity=await receipt(config);
for(const key of ['model','addon','server'])if(identity.files[key].sha256!==original.identity.files[key].sha256)throw new Error('Changed binary: '+key);
const protocol={...original,version:5,createdAt:new Date().toISOString(),identity,
 parentExperiment:source,selectedTrials:names,kind:'cuda-capacity-v1',
 amendment:'The v4 worker used Node fetch with a 300-second response-header timeout despite an 1800-second AbortSignal. Use matching undici fetch and Agent headers/body limits plus explicit ChatOpenAI timeout of 1800 seconds. No retries. Inference payload, model/server settings and workload are unchanged.',
 boundaryRule:'Two diagnostic repetitions, one representative transport-censored width per prefix length. Not a new complete frontier search. Original allocation failures and all native trials remain in the parent experiment.'};
await writeFile(resolve(dir,'protocol.json'),JSON.stringify(protocol,null,2));
await cp(resolve(source,'calibration.json'),resolve(dir,'calibration.json'));
await cp(resolve(ROOT,'src'),resolve(dir,'execution-source/src'),{recursive:true});
await cp(resolve(ROOT,'package-lock.json'),resolve(dir,'execution-source/package-lock.json'));
await cp(resolve(ROOT,'scripts/check-cuda-timeout.mjs'),resolve(dir,'execution-source/driver.mjs'));
await assertNoExternalModels();const release=await acquireModelLease(ROOT,'timeout-repair-'+Date.now(),[config.port]);
const abort=new AbortController(),stop=()=>abort.abort();process.once('SIGTERM',stop);process.once('SIGINT',stop);
try{
 for(const name of names){
  const old=JSON.parse(await readFile(resolve(source,name,'job.json'),'utf8'));
  const {dir:oldDir,...overrides}=old;
  console.log(new Date().toISOString(),'Starting',name);
  const status=await trial(config,resolve(dir,name),'langgraph',old.count,old.context,old.records,true,old.rounds,true,abort.signal,{...overrides,matchHttpDeadline:true});
  console.log(new Date().toISOString(),name,JSON.stringify(status));await analyzeCapacity(dir);abort.signal.throwIfAborted();
 }
 await writeFile(resolve(dir,'collection-complete.json'),JSON.stringify({completedAt:new Date().toISOString(),meaning:'Two transport correction checks finished; these do not locate the physical capacity boundary.'},null,2));
}finally{process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);await release();await analyzeCapacity(dir);}
