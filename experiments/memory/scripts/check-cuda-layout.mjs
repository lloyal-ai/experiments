// Serving configuration control, using the unchanged inference workers.
import { mkdir, writeFile, cp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadConfig, ROOT } from '../src/util.ts';
import { receipt, trial } from '../src/experiments/memory/controller.mjs';
import { capacityFixture } from '../src/experiments/memory/fixture.mjs';
import { analyze } from '../src/experiments/memory/metrics.mjs';
import { acquireModelLease } from '../src/model-lease.ts';
import { assertNoExternalModels } from '../src/runtime/stack.ts';
const dir=resolve(ROOT,'comparisons/cuda-layout-control-2026-10-10');
const config={...await loadConfig(),serverBinary:resolve(ROOT,'instrumentation/llama-server-build/bin/llama-server')};
await mkdir(dir,{recursive:false});
const protocol={kind:'HTTP KV layout control',createdAt:new Date().toISOString(),count:32,sequences:34,context:322048,records:256,rounds:2,
 order:['separate-default','unified-explicit'],timeoutMs:1800000,identity:await receipt(config),
 rationale:'Pinned common.h defaults kv_unified=false with explicit parallel slots. Test its impact before attributing the unified-buffer scaling slowdown to the architecture. Both trials use identical total context and sequence ceilings, fixture, priming, cache settings and workers.'};
await writeFile(resolve(dir,'protocol.json'),JSON.stringify(protocol,null,2));
await cp(resolve(ROOT,'src'),resolve(dir,'execution-source/src'),{recursive:true});
await cp(resolve(ROOT,'scripts/check-cuda-layout.mjs'),resolve(dir,'execution-source/driver.mjs'));
await assertNoExternalModels();const release=await acquireModelLease(ROOT,'layout-control-'+Date.now(),[config.port]);
const abort=new AbortController(),stop=()=>abort.abort();process.once('SIGTERM',stop);process.once('SIGINT',stop);
try{
 for(const unified of [false,true]){
  const name=unified?'unified-explicit':'separate-default';console.log('Starting '+name);
  const status=await trial(config,resolve(dir,name),'langgraph',32,322048,256,true,2,true,abort.signal,
   {sequences:34,timeoutMs:1800000,fixture:capacityFixture(32,256),primeHttpPrefix:true,httpKvUnified:unified});
  console.log(name+': '+JSON.stringify(status));await analyze(dir);abort.signal.throwIfAborted();
 }
}finally{process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);await release();await analyze(dir);}
