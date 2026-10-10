import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseJsonl, memoryMetrics, validateCensus, gpuResourceMetrics } from './metrics.mjs';
const optional=async path=>{try{return await readFile(path,'utf8');}catch(e){if(e.code==='ENOENT')return null;throw e;}};
/** Aggregate only observed owned engine buffers, retaining model/context ownership.
 * Projector and browser allocation are unavailable; this is never whole-stack RAM. */
export function aggregateEngine(events){
 const live=new Map();let peak=0;const timeline=[];
 for(const e of [...events].sort((a,b)=>a.unixMs-b.unixMs||a.pid-b.pid||a.seq-b.seq)){
  const key=e.pid+':'+e.contextId;
  if(e.event==='context.destroy')live.delete(key);else if(e.allocation)live.set(key,e);else continue;
  const models=new Map();let owned=0;
  for(const r of live.values())for(const b of r.allocation){
   const id=r.pid+':'+r.modelIdentity+':'+b.bufferType;
   models.set(id,Math.max(models.get(id)??0,b.modelBytes));owned+=b.contextBytes+b.computeBytes;
  }
  const bytes=owned+[...models.values()].reduce((a,b)=>a+b,0);peak=Math.max(peak,bytes);timeline.push({unixMs:e.unixMs,bytes,liveContexts:live.size});
 }
 return {peakObservedEngineBytes:timeline.length?peak:null,timeline,meaning:'Observed context/compute allocations plus model buffers deduplicated by owner. Projector buffers and browser are absent; cross-process mapped-page physical sharing is not resolved.'};
}
export async function analyzeComposed(dir){
 const results={kind:'composed-Fieldnote',comparisonEligible:false,quality:'unreviewed',backends:{}};
 for(const backend of ['fieldnote','langgraph']){
  const base=resolve(dir,backend);let files;try{files=await readdir(base);}catch(e){if(e.code==='ENOENT')continue;throw e;}
  const events=[],parseErrors=[];
  for(const f of files.filter(f=>f.endsWith('.memory.jsonl'))){const parsed=parseJsonl(await optional(resolve(base,f)));events.push(...parsed.rows);parseErrors.push(...parsed.errors.map(e=>({file:f,...e})));}
  const loaded=await optional(resolve(base,'native-loaded-identity.jsonl'));
  const status=await optional(resolve(base,'driver-status.json'));
  const review=await optional(resolve(base,'quality-review.json'));
  const frames=parseJsonl(await optional(resolve(base,'browser.jsonl'))).rows;
  const wire=frames.filter(r=>r.type==='frame.received'&&r.raw?.frame?.t==='event').map(r=>({unixMs:r.unixMs,...r.raw.frame.payload}));
  // Include destruction events, which do not repeat the allocation/census payload.
  const mainContexts=new Set(events.filter(e=>e.recurrent).map(e=>e.pid+':'+e.contextId));
  const main=events.filter(e=>mainContexts.has(e.pid+':'+e.contextId));
  const stages=wire.filter(e=>['preflight:start','preflight:done','research:start','research:done','synthesize:start','synthesize:done','complete','answer','ui:error'].includes(e.type));
  const totals=aggregateEngine(events);
  const resources=parseJsonl(await optional(resolve(base,'observations.jsonl'))).rows.filter(e=>e.type==='resource.sample').map(e=>e.data);
  await writeFile(resolve(base,'engine-timeline.json'),JSON.stringify(totals.timeline));
  results.backends[backend]={status:status?JSON.parse(status):null,qualityReview:review?JSON.parse(review):null,actualNativeIdentity:backend==='fieldnote'?loaded?JSON.parse(loaded.trim().split('\n')[0]):null:null,parseErrors,census:validateCensus(events),observedContexts:[...new Set(events.filter(e=>e.contextId).map(e=>e.pid+':'+e.contextId))],mainModelMemory:memoryMetrics(main),processFootprintScope:backend==='fieldnote'?'Native host process includes main model, reranker and projector.':'Main llama-server process; separate reranker and application processes are excluded. Do not directly compare this with the native host footprint.',externalResources:{...gpuResourceMetrics({samples:resources}),scope:'Application controller plus owned model/reranker hosts; excludes browser and helper descendants. Sampled after model startup.'},peakObservedEngineBytes:totals.peakObservedEngineBytes,allocationMeaning:totals.meaning,stageEvents:stages,missing:['Projector allocation itemization','Unique physical RAM for the whole process tree/browser',...(review?['Independent blinded repeated quality evaluation']:['Independent answer and evidence-coverage quality review'])]};
 }
 if(['fieldnote','langgraph'].every(b=>results.backends[b]?.qualityReview)){results.quality='reviewed-with-differences';results.qualityReviewScope='Manual artifact reviews exist for both arms; comparisonEligible remains false unless a separate quality-equivalence evaluation supports it.';}
 await writeFile(resolve(dir,'memory-summary.json'),JSON.stringify(results,null,2));return results;
}
