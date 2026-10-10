import test from 'node:test';
import assert from 'node:assert/strict';
const fixtureModule='../src/experiments/memory/fixture.mjs';
const metricsModule='../src/experiments/memory/metrics.mjs';
const {fixture,checkAnswer}=await import(fixtureModule);
const {memoryMetrics}=await import(metricsModule);
test('capacity fixture preserves every existing task and provides distinct exact targets at 254',async()=>{
 const {capacityFixture,validateOutcomes}=await import(fixtureModule);
 for(const records of [256,768]){
  const small=capacityFixture(8,records),wide=capacityFixture(254,records);
  assert.equal(small.shared,wide.shared);assert.deepEqual(small.tasks,wide.tasks.slice(0,8));
  assert.equal(new Set(wide.tasks.map((t:any)=>t.expected.id)).size,254);
  const outcomes=small.tasks.toReversed().map((t:any)=>({key:t.id,result:JSON.stringify(t.expected),failed:null}));
  assert.ok(validateOutcomes(outcomes,small.tasks).every((o:any)=>o.valid));
  assert.equal(validateOutcomes([outcomes[0],outcomes[0]],small.tasks)[1].valid,false);
 }
});
test('capacity budgets account separately for shared cells, private cells and recurrent sequence slots',async()=>{
 const path='../src/experiments/memory/capacity.mjs';const {capacityBudget,failureCategory}=await import(path);
 const native=capacityBudget('lloyal',254,26000),http=capacityBudget('langgraph',254,26000);
 assert.equal(native.sequences,256);assert.equal(http.sequences,256);
 assert.ok(native.context>=26000+254*256+2048);assert.ok(http.context>=254*(26000+256)+2048);
 assert.throws(()=>capacityBudget('lloyal',255,26000));
 const separate=capacityBudget('langgraph',128,26000,false);
 assert.equal(separate.sequences,128);assert.ok(separate.context/128>=26000+256+2048/128);
 assert.equal((separate.context/128)%256,0);
 const row={status:'complete',valid:true,validResults:16,count:8,realizedActive:4,gates:{withinDeadline:true,expectedResults:16}};
 assert.equal(failureCategory(row),'concurrency-not-demonstrated');
 assert.equal(failureCategory({...row,status:'failed',valid:false},'CUDA out of memory'),'gpu-allocation');
 assert.equal(failureCategory({...row,realizedActive:8}),'pass');
 assert.equal(failureCategory({...row,realizedActive:8},'slot context (295680) exceeds the training context of the model (262144) - capping'),'pass');
 assert.equal(failureCategory({...row,status:'failed',valid:false},'unknown crash'),'incomplete-or-invalid-evidence');
 assert.equal(failureCategory({...row,status:'failed',valid:false},'TimeoutError: operation timed out'),'deadline');
});
test('memory sweep preserves shared input and existing task identities as width grows',()=>{
 const one=fixture(1),eight=fixture(8);assert.equal(one.shared,eight.shared);assert.deepEqual(one.tasks[0],eight.tasks[0]);
 assert.ok(checkAnswer(JSON.stringify(one.tasks[0].expected),one.tasks[0].expected));
 assert.ok(!checkAnswer(JSON.stringify({...one.tasks[0].expected,capacity:-1}),one.tasks[0].expected));
});
test('memory summary counts occupied storage once and keeps logical references separate',()=>{
 const m=memoryMetrics([{allocation:[{modelBytes:100,contextBytes:50,computeBytes:20}],collectionNs:1000,
  attention:{streams:[{occupiedCells:10,sharedCells:8,sequenceReferences:34}],allocation:[{bytes:30}]},recurrent:{allocation:[{bytes:20}]}}]);
 assert.equal(m.peakAttentionCells,10);assert.equal(m.peakSequenceReferences,34);assert.equal(m.peakEngineAllocatedBytes,170);
 assert.equal(m.peakContextAllocatedBytes,m.peakAttentionAllocatedBytes+m.peakRecurrentAllocatedBytes);
 assert.equal(m.peakProcessFootprintBytes,null);assert.equal(m.peakSavedCacheBytes,null);
});
test('missing memory evidence stays unavailable',()=>{const m=memoryMetrics([]);assert.equal(m.peakAttentionCells,null);assert.equal(m.peakEngineAllocatedBytes,null);});
test('environment audit retains paging and unknowns without attributing system activity to the model',async()=>{
 const {environmentMetrics}=await import(metricsModule);
 const r=environmentMetrics({memory:'Pageouts: 3.\nSwapins: 9.\nSwapouts: 12.',swap:'vm.swapusage: total = 16.00M used = 10.00M free = 6.00M'}, {memory:'Pageouts: 4.\nSwapins: 11.\nSwapouts: 18.'});
 assert.deepEqual(r.systemPagingDeltas,{Pageouts:1,Swapins:2,Swapouts:6});assert.equal(r.systemPagingObserved,true);
 assert.equal(r.systemSwapBytesBefore,10*2**20);assert.equal(r.systemSwapBytesAfter,null);
 assert.deepEqual(environmentMetrics(null,null).systemPagingDeltas,{Pageouts:null,Swapins:null,Swapouts:null});
});
test('partial telemetry retains successful records and explicitly invalidates the parse',async()=>{
 const {parseJsonl}=await import(metricsModule);const p=parseJsonl('{"event":"ok"}\n{"event":');
 assert.equal(p.rows.length,1);assert.equal(p.errors.length,1);
});
test('copy census rejects physical duplication and verifies allocation ownership',async()=>{
 const {validateCensus}=await import(metricsModule);
 const e=(event:string,n:number)=>({event,allocation:[{contextBytes:50}],occupancySupported:true,attention:{streams:[{occupiedCells:n,capacityCells:20,sharedCells:8,sequenceReferences:34}],allocation:[{bytes:30}]},recurrent:{allocation:[{bytes:20}]}});
 assert.equal(validateCensus([e('memory.before_seq_cp',10),e('memory.seq_cp',10)]).errors.length,0);
 assert.ok(validateCensus([e('memory.before_seq_cp',10),e('memory.seq_cp',11)]).errors.length>0);
 const bad=e('decode',10);bad.allocation[0].contextBytes=51;assert.ok(validateCensus([bad]).errors.length>0);
});
test('multi-context engine totals share model allocation but retain private context buffers',async()=>{
 const path='../src/experiments/memory/composed-metrics.mjs';const {aggregateEngine}=await import(path);
 const sample=(contextId:number,seq:number)=>({pid:10,contextId,modelIdentity:7,unixMs:seq,seq,event:'decode',allocation:[{bufferType:'MTL0',modelBytes:100,contextBytes:20,computeBytes:10}]});
 const r=aggregateEngine([sample(1,1),sample(2,2),{pid:10,contextId:1,unixMs:3,seq:3,event:'context.destroy'}]);
 assert.equal(r.peakObservedEngineBytes,160);assert.equal(r.timeline.at(-1).bytes,130);
});

test('CUDA gate requires GPU model and context allocations, not pinned host buffers',async()=>{
 const {gpuEvidence}=await import(metricsModule);
 const e=(bufferType:string)=>[{allocation:[{bufferType,modelBytes:10,contextBytes:20}]}];
 assert.equal(gpuEvidence(e('CUDA_Host'),'CUDA initialized').gpuObserved,false);
 assert.equal(gpuEvidence(e('CUDA0'),'CUDA initialized').cudaObserved,true);
 assert.equal(gpuEvidence(e('MTL0'),'Metal initialized').metalObserved,true);
});
test('NVML and host memory retain missing counters and do not conflate CPU with VRAM',async()=>{
 const path='../src/experiments/memory/platform.mjs';const {parseGpuSnapshot,parseSmaps}=await import(path);
 const gpu=parseGpuSnapshot('GPU-1, 46068, 5000, 50, 42, 120.5, 1500','GPU-1, 10, 4800\nGPU-1, 99, 100');
 assert.equal(gpu.devices[0].usedMiB,5000);
 assert.equal(parseGpuSnapshot('GPU-1, 46068, N/A, 0, 40, N/A, 100','').devices[0].usedMiB,null);
 const {gpuResourceMetrics,environmentMetrics}=await import(metricsModule);
 const m=gpuResourceMetrics({samples:[{gpu,processes:[{pid:10}]}]});
 assert.equal(m.peakOwnedGpuProcessBytes,4800*2**20);assert.equal(m.peakDeviceUsedBytes,5000*2**20);assert.equal(m.peakHostPssSumBytes,null);
 assert.equal(parseSmaps('Rss: 10 kB\nPss: 8 kB\nPrivate_Clean: 2 kB\nPrivate_Dirty: 3 kB\nSwap: 0 kB').privateBytes,5120);
 const s=(out:number)=>({platform:'linux',vmstat:`pgpgout ${out}\npswpin 0\npswpout 0`,memory:'SwapTotal: 0 kB\nSwapFree: 0 kB'});
 assert.equal(environmentMetrics(s(1),s(9999)).systemPagingObserved,false);
});

test('recorded quality reviews update review status without granting quality equivalence',async()=>{
 const {mkdtemp,writeFile,mkdir,rm}=await import('node:fs/promises');
 const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const path='../src/experiments/memory/composed-metrics.mjs';const {analyzeComposed}=await import(path);
 const dir=await mkdtemp(join(tmpdir(),'composed-review-'));
 try{
  for(const backend of ['fieldnote','langgraph']){
   await mkdir(join(dir,backend));await writeFile(join(dir,backend,'quality-review.json'),JSON.stringify({status:'reviewed-with-differences',overallQualityEquivalent:false}));
  }
  const result=await analyzeComposed(dir);
  assert.equal(result.quality,'reviewed-with-differences');assert.equal(result.comparisonEligible,false);
  assert.ok(result.backends.fieldnote.missing.includes('Independent blinded repeated quality evaluation'));
 }finally{await rm(dir,{recursive:true,force:true});}
});
