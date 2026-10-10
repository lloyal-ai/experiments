import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const optional=async p=>{try{return await readFile(p,'utf8');}catch(e){if(e.code==='ENOENT')return null;throw e;}};
const json=async p=>{const s=await optional(p);return s===null?null:JSON.parse(s);};
const maximum=a=>a.length?Math.max(...a):null;
const sum=a=>a.reduce((x,y)=>x+y,0);
export function environmentMetrics(before,after){
 if(before?.platform==='linux'||after?.platform==='linux'){
  const field=(s,key)=>{const m=typeof s?.vmstat==='string'?s.vmstat.match(new RegExp('^'+key+' (\\d+)$','m')):null;return m?Number(m[1]):null;};
  const deltas=Object.fromEntries(['pgpgout','pswpin','pswpout'].map(key=>{const b=field(before,key),a=field(after,key);return [key,b===null||a===null?null:a-b];}));
  const swapped=s=>{const m=typeof s?.memory==='string'?Object.fromEntries([...s.memory.matchAll(/^(SwapTotal|SwapFree):\s+(\d+) kB$/gm)].map(m=>[m[1],Number(m[2])])):{};return m.SwapTotal===undefined||m.SwapFree===undefined?null:(m.SwapTotal-m.SwapFree)*1024;};
  const values=[deltas.pswpin,deltas.pswpout];
  return {systemPagingDeltas:deltas,systemPagingObserved:values.some(n=>n!==null&&n>0)?true:values.every(n=>n!==null)?false:null,systemSwapBytesBefore:swapped(before),systemSwapBytesAfter:swapped(after),gpuBefore:before?.gpu??null,gpuAfter:after?.gpu??null,meaning:'Linux system-wide counters. pgpgout includes ordinary file writes; only pswpin/pswpout establish swap activity. GPU device totals and per-process allocation are separate measurements.'};
 }
 const field=(snapshot,name)=>{const m=typeof snapshot?.memory==='string'?snapshot.memory.match(new RegExp(name+':\\s*(\\d+)')):null;return m?Number(m[1]):null;};
 const deltas=Object.fromEntries(['Pageouts','Swapins','Swapouts'].map(name=>{const b=field(before,name),a=field(after,name);return [name,b===null||a===null?null:a-b];}));
 const swap=s=>{const m=typeof s?.swap==='string'?s.swap.match(/used\s*=\s*([\d.]+)M/):null;return m?Number(m[1])*2**20:null;};
 return {systemPagingDeltas:deltas,systemPagingObserved:Object.values(deltas).some(v=>v!==null&&v>0)?true:Object.values(deltas).every(v=>v!==null)?false:null,systemSwapBytesBefore:swap(before),systemSwapBytesAfter:swap(after),powerBefore:before?.power??null,powerAfter:after?.power??null,meaning:'System-wide activity, not attributable to the benchmark process. Paging limits timing and OS-footprint interpretation; it does not alter direct engine cell/allocation counts.'};
}
export function gpuEvidence(events,log=''){
 const observed=pattern=>events.some(e=>e.allocation?.some(b=>pattern.test(b.bufferType)&&b.modelBytes>0)&&e.allocation?.some(b=>pattern.test(b.bufferType)&&b.contextBytes>0));
 const metalObserved=observed(/Metal|MTL/i)&&/Metal|MTL/i.test(log);
 const cudaObserved=observed(/^CUDA\d+(?:_Split)?$/)&&/CUDA|ggml_cuda/i.test(log);
 return {metalObserved,cudaObserved,gpuObserved:metalObserved||cudaObserved};
}
export function gpuResourceMetrics(resources){
 const samples=resources?.samples??[];
 const device=s=>Array.isArray(s.gpu?.devices)?s.gpu.devices.filter(d=>d.usedMiB!==null).map(d=>d.usedMiB*2**20):[];
 const owned=s=>Array.isArray(s.gpu?.processes)?s.gpu.processes.filter(p=>s.processes?.some(owned=>owned.pid===p.pid)&&p.usedMiB!==null).map(p=>p.usedMiB*2**20):[];
 return {peakDeviceUsedBytes:maximum(samples.flatMap(device)),peakOwnedGpuProcessBytes:maximum(samples.filter(s=>owned(s).length).map(s=>sum(owned(s)))),
  peakHostPssSumBytes:maximum(samples.filter(s=>s.hostMemory?.length&&s.hostMemory.every(p=>typeof p.memory?.pssBytes==='number')).map(s=>sum(s.hostMemory.map(p=>p.memory.pssBytes)))),
  gpuSamples:samples.filter(s=>Array.isArray(s.gpu?.devices)&&Array.isArray(s.gpu?.processes)).length,
  maxResourceCollectionMs:maximum(samples.filter(s=>typeof s.collectionMs==='number').map(s=>s.collectionMs)),
  resourceMeaning:'Device VRAM includes all processes and driver usage. Owned GPU memory sums NVML rows for the measured model/worker PIDs only. PSS is host RAM proportional accounting. Never add these to engine allocations.'};
}
export function parseJsonl(raw){const rows=[],errors=[];for(const [index,line] of (raw??'').split('\n').entries()){if(!line.trim())continue;try{rows.push(JSON.parse(line));}catch{errors.push({line:index+1,reason:'Invalid JSON; partial/corrupt evidence retained'});}}return {rows,errors};}
export const cellTotals=e=>e.attention?.streams?.reduce((r,c)=>({used:r.used+c.occupiedCells,shared:r.shared+c.sharedCells,references:r.references+c.sequenceReferences,sequences:Math.max(r.sequences,c.residentSequences)}),{used:0,shared:0,references:0,sequences:0});
export function memoryMetrics(events){
 const samples=events.filter(e=>e.allocation),occupied=samples.filter(e=>e.attention).map(cellTotals);
 return {samples:samples.length,peakAttentionCells:maximum(occupied.map(e=>e.used)),peakSharedAttentionCells:maximum(occupied.map(e=>e.shared)),peakSequenceReferences:maximum(occupied.map(e=>e.references)),peakResidentSequences:maximum(occupied.map(e=>e.sequences)),
  peakContextAllocatedBytes:maximum(samples.map(e=>sum(e.allocation.map(b=>b.contextBytes)))),
  peakEngineAllocatedBytes:maximum(samples.map(e=>sum(e.allocation.map(b=>b.modelBytes+b.contextBytes+b.computeBytes)))),
  peakAttentionAllocatedBytes:maximum(samples.filter(e=>e.attention).map(e=>sum(e.attention.allocation.map(b=>b.bytes)))),
  peakRecurrentAllocatedBytes:maximum(samples.filter(e=>e.recurrent).map(e=>sum(e.recurrent.allocation.map(b=>b.bytes)))),
  peakRecurrentRows:maximum(samples.filter(e=>e.recurrent).map(e=>e.recurrent.occupiedStateRows)),
  peakProcessFootprintBytes:maximum(samples.filter(e=>e.processMemory?.physicalFootprintBytes!==undefined).map(e=>e.processMemory.physicalFootprintBytes)),
  peakProcessResidentBytes:maximum(samples.filter(e=>e.processMemory?.residentBytes!==undefined).map(e=>e.processMemory.residentBytes)),
  peakProcessCompressedBytes:maximum(samples.filter(e=>e.processMemory?.compressedBytes!==undefined).map(e=>e.processMemory.compressedBytes)),
  peakSavedCacheBytes:maximum(events.filter(e=>e.cacheBytes!==undefined).map(e=>e.cacheBytes)),
  cacheEvictions:events.filter(e=>e.event==='cache.evicted').length,
  maxCollectionMs:maximum(samples.map(e=>e.collectionNs/1e6)),
  observerTotalMs:maximum(events.filter(e=>e.observerTotalNs!==undefined).map(e=>e.observerTotalNs/1e6)),
  scopesDestroyed:events.filter(e=>e.event==='context.destroy').length,
  note:'Sampled maxima per context/model process in the text diagnostic; allocation is not physical residency. Not whole Fieldnote stack totals.'};
}
export function validateCensus(events){
 const errors=[];let copies=0,sharedCopies=0;
 for(const [i,e] of events.entries()){
  if(e.allocation){
   const owned=sum(e.allocation.map(b=>b.contextBytes));
   const classified=sum([...(e.attention?.allocation??[]),...(e.recurrent?.allocation??[])].map(b=>b.bytes));
   if(e.occupancySupported&&owned!==classified)errors.push('Context allocation does not equal attention plus recurrent allocation');
   for(const c of e.attention?.streams??[])if(c.occupiedCells>c.capacityCells||c.sharedCells>c.occupiedCells||c.sequenceReferences<c.occupiedCells)errors.push('Invalid physical cell census');
  }
  if(e.event==='memory.seq_cp'&&events[i-1]?.event==='memory.before_seq_cp'){
   const before=cellTotals(events[i-1]),after=cellTotals(e);if(!before||!after)continue;copies++;
   if(before.used!==after.used)errors.push('Sequence copy changed occupied attention cells');
   if(after.references>before.references)sharedCopies++;
  }
 }
 return {errors:[...new Set(errors)],copyPairsChecked:copies,sharedCopies};
}
export async function analyze(dir){
 const rows=[];
 for(const entry of await readdir(dir,{withFileTypes:true})){
  if(!entry.isDirectory())continue;const base=resolve(dir,entry.name),status=await json(resolve(base,'status.json'));if(!status)continue;
  const job=await json(resolve(base,'job.json')),parsed=parseJsonl(await optional(resolve(base,'engine-memory.jsonl'))),events=parsed.rows;
  const result=await json(resolve(base,'result.json')),trace=parseJsonl(await optional(resolve(base,'agents.jsonl'))).rows;
  const work=parseJsonl(await optional(resolve(base,'workload.jsonl'))).rows;
  const rounds=[];
  for(const r of result?.rounds??[]){
   const start=work.find(e=>e.event==='round.start'&&e.round===r.round)?.unixMs,end=work.find(e=>e.event==='round.done'&&e.round===r.round)?.unixMs;
   const receipts=[];for(const f of await readdir(base))if(f.startsWith(`round-${r.round}-`)&&f.endsWith('.response.json'))receipts.push(await json(resolve(base,f)));
   const timing=receipts.filter(r=>r?.timings);
   rounds.push({round:r.round,workMs:r.workMs,validResults:r.outcomes.filter(o=>o.valid).length,generatedTokens:r.totalTokens??sum(receipts.map(r=>r?.usage?.completion_tokens??0)),promptTokens:receipts.length?sum(receipts.map(r=>r?.usage?.prompt_tokens??0)):null,cachedTokens:timing.length?sum(timing.map(r=>r.timings.cache_n)):null,processedTokens:timing.length?sum(timing.map(r=>r.timings.prompt_n)):null,...memoryMetrics(events.filter(e=>e.unixMs>=start&&e.unixMs<=end))});
  }
  const resources=await json(resolve(base,'resources.json'));
  const environment=environmentMetrics(await json(resolve(base,'system.before.json')),await json(resolve(base,'system.after.json')));
  const peakHttpProcessing=maximum((resources?.samples??[]).filter(s=>Array.isArray(s.slots)).map(s=>s.slots.filter(slot=>slot.is_processing).length));
  const log=await optional(resolve(base,status.backend==='lloyal'?'worker.log':'server.log'));
  const nativeIdentity=await optional(resolve(base,'native-identity.jsonl'));
  const gates={census:validateCensus(events),parseErrors:parsed.errors,...gpuEvidence(events,log??''),nativeLoadedIdentity:status.backend==='lloyal'?!!nativeIdentity:null,contextReleased:events.some(e=>e.event==='context.destroy'),expectedResults:job.count*(job.rounds??1),actualResults:result?.outcomes?.length??0,withinDeadline:typeof result?.workMs==='number'&&result.workMs<=job.timeoutMs};
  const validResults=result?.outcomes?.filter(o=>o.valid).length??0;
  rows.push({trial:entry.name,...status,environment,roundCount:job.rounds??1,validResults,peakHttpProcessing,workMs:result?.workMs??null,failure:result?.failure??null,rounds,gates,peakActiveAgents:maximum(trace.filter(e=>e.type==='pool:tick').map(e=>e.activeAgents)),peakRuntimeCells:maximum(trace.filter(e=>e.type==='pool:tick').map(e=>e.pressure.cellsUsed)),spawnRefused:trace.filter(e=>e.type==='pool:spawnRefused').length,httpPrefix:(await json(resolve(base,'http-prefix.json')))?.commonPrefixTokens??null,...memoryMetrics(events),...gpuResourceMetrics(resources),valid:status.status==='complete'&&validResults===gates.expectedResults&&gates.withinDeadline&&(!status.telemetry||(events.length>0&&gates.census.errors.length===0&&parsed.errors.length===0&&gates.gpuObserved&&gates.contextReleased))});
 }
 const output={analysisVersion:3,kind:'diagnostic',fieldnoteComparison:false,rows};await writeFile(resolve(dir,'summary.json'),JSON.stringify(output,null,2)+'\n');return output;
}
