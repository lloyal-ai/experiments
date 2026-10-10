import { readFile, writeFile, mkdir, cp, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { receipt, trial } from './controller.mjs';
import { capacityFixture } from './fixture.mjs';
import { analyze, parseJsonl } from './metrics.mjs';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const get=(args,key,fallback)=>{const i=args.indexOf('--'+key);return i<0?fallback:args[i+1];};
const read=async p=>JSON.parse(await readFile(p,'utf8'));
const optional=async p=>{try{return await readFile(p,'utf8');}catch(e){if(e.code==='ENOENT')return '';throw e;}};
const save=(p,x)=>writeFile(p,JSON.stringify(x,null,2)+'\n');
const round256=n=>Math.ceil(n/256)*256;

export function capacityBudget(backend,count,prefixBound,httpKvUnified=true){
 if(!['lloyal','langgraph'].includes(backend)||!Number.isInteger(count)||count<1||count>254||!Number.isInteger(prefixBound)||prefixBound<1)throw new Error('Invalid capacity budget');
 if(backend==='langgraph'&&!httpKvUnified)return {sequences:count,context:count*round256(prefixBound+256+2048/count)};
 return {sequences:count+2,context:round256((backend==='lloyal'?prefixBound:count*prefixBound)+count*256+2048)};
}
export function failureCategory(row,log=''){
 // Successful work is not a failure merely because llama-server reports that
 // the unified pool is larger than the model's per-sequence training context.
 if(row.valid)return row.realizedActive<row.count?'concurrency-not-demonstrated':'pass';
 if(/out of memory|cudaMalloc.*failed|failed to allocate.*CUDA|CUDA.*allocation.*fail/i.test(log))return 'gpu-allocation';
 if(/n_seq_max.*LLAMA_MAX_SEQ|no_sequence|sequence.*limit/i.test(log))return 'sequence-limit';
 if(row.status==='timeout'||!row.gates.withinDeadline&&row.status==='complete'||/TimeoutError|timed out|readiness timeout/i.test(log))return 'deadline';
 if(/pressure_critical|pressure_init|could not find.*slot.*KV|KV.*full|context.*exceed/i.test(log))return 'context-or-pressure';
 if(row.status!=='complete'&&row.validResults<row.gates.expectedResults&&/"valid":false|"valid": false/.test(log))return 'answer-check';
 if(!row.valid)return 'incomplete-or-invalid-evidence';
 return 'pass';
}
export async function analyzeCapacity(dir){
 const summary=await analyze(dir),protocol=await read(resolve(dir,'protocol.json'));
 for(const row of summary.rows){
  const base=resolve(dir,row.trial),job=await read(resolve(base,'job.json'));
  const log=(await optional(resolve(base,'worker.log')))+'\n'+(await optional(resolve(base,'server.log')))+'\n'+(await optional(resolve(base,'result.json')));
  row.records=job.records;row.phase=job.phase;row.sequences=job.sequences;row.prefixBound=job.prefixBound??null;
  row.realizedActive=row.backend==='lloyal'?row.peakActiveAgents:row.peakHttpProcessing;
  row.gates.withinDeadline=(row.rounds?.length===job.rounds)&&row.rounds.every(r=>r.workMs<=job.timeoutMs);
  row.valid=row.status==='complete'&&row.validResults===row.gates.expectedResults&&row.gates.withinDeadline&&row.gates.gpuObserved&&row.gates.contextReleased&&row.gates.parseErrors.length===0&&row.gates.census.errors.length===0;
  row.category=failureCategory(row,log);row.capacityPass=row.category==='pass';
  const raw=JSON.parse(await optional(resolve(base,'result.json'))||'null');
  row.completedGenerations=raw?.outcomes?.filter(o=>typeof o.result==='string'&&!o.failed).length??0;
  row.allocationFit=row.gates.gpuObserved&&row.gates.contextReleased&&row.realizedActive>=row.count&&row.rounds.length===job.rounds&&row.completedGenerations===row.gates.expectedResults&&row.category!=='gpu-allocation'&&row.gates.parseErrors.length===0&&row.gates.census.errors.length===0;
  row.boundMeaning=row.count===254&&row.capacityPass?(row.backend==='lloyal'?'At least 254 productive agents; engine sequence ceiling reached, not physical maximum':'At least 254 productive agents; sweep ceiling reached, not physical maximum'):null;
 }
 const result={...summary,analysisVersion:2,analysisSourceSha256:createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex'),kind:'cuda-capacity-v1',protocol,rows:summary.rows};
 await save(resolve(dir,'capacity-summary.json'),result);return result;
}

export async function capacityCommand(args,base){
 const dir=resolve(get(args,'output',resolve(root,'comparisons/cuda-capacity-2026-10-10')));
 if(args.includes('--analyze')){console.log(JSON.stringify(await analyzeCapacity(dir),null,2));return;}
 const config={...base,serverBinary:resolve(root,'instrumentation/llama-server-build/bin/llama-server')};
 const httpKvUnified=!args.includes('--http-default-layout');
 const identity=await receipt(config);
 let protocol;try{protocol=await read(resolve(dir,'protocol.json'));}catch(e){if(e.code!=='ENOENT')throw e;}
 if(protocol){
  if(!args.includes('--resume'))throw new Error('Existing capacity experiment; use --resume');
  if((protocol.httpKvUnified??true)!==httpKvUnified)throw new Error('HTTP layout differs from frozen protocol');
  for(const name of ['model','addon','server'])if(protocol.identity.files[name].sha256!==identity.files[name].sha256)throw new Error('Binary changed: '+name);
  const changed=Object.entries(protocol.identity.workload).filter(([name,hash])=>identity.workload[name]!==hash).map(([name])=>name);
  if(changed.length){
   if(!args.includes('--analysis-amendment')||changed.some(n=>n!=='capacity.mjs'))throw new Error('Workload changed: '+changed.join(','));
   // Explicitly retained analysis repair. Inference workers, fixture, context
   // budget formula and trial controller must still match the frozen protocol.
   const path=resolve(dir,'analysis-amendment-'+Date.now()+'.json');
   await save(path,{createdAt:new Date().toISOString(),reason:'Classify successful trials ahead of benign server context warnings; distinguish request timeouts from wrong answers; require every generation to finish before claiming allocation fit.',previousHash:protocol.identity.workload['capacity.mjs'],currentHash:identity.workload['capacity.mjs'],inferenceWorkloadUnchanged:true});
   await cp(resolve(root,'src/experiments/memory/capacity.mjs'),path.replace('.json','.mjs'));
  }
 }else{
  await mkdir(dir,{recursive:true});
  protocol={kind:'cuda-capacity-v1',version:5,createdAt:new Date().toISOString(),identity,httpKvUnified,httpDeadlineMatched:true,
   httpTransport:'Matching undici fetch/Agent header/body timeouts and ChatOpenAI SDK timeout equal the declared job deadline; retries disabled',
   records:[256,768],counts:[8,32,64,128,192,254],rounds:2,timeoutMs:1800000,privateReserveCells:256,globalReserveCells:2048,
   sequenceRule:httpKvUnified?'n + 2 on both arms; 256 engine ceiling':'Native n+2 (two administrative branches); HTTP n slots; 256 engine ceiling; common sweep maximum 254',
   contextRule:httpKvUnified?'ceil256(prefixBound * (native:1, HTTP:n) + n*256 + 2048)':'Native ceil256(prefixBound+n*256+2048); HTTP n*ceil256(prefixBound+256+2048/n), so each fixed slot can hold the full workload',
   prefixCalibration:'n=8, context=262144; max(actual HTTP prompt tokens, native shared text tokens + 128); frozen before capacity collection. Requires completed rounds and valid allocation evidence; answer errors remain failures of useful capacity but do not invalidate tokenizer lengths.',
   revisionReason:'Initial calibration retained at cuda-capacity-2026-10-10: HTTP returned one incorrect lookup. Preserve the strict answer gate; separate completed allocation from exact correctness when calibrating lengths and locating allocation boundaries. v2 interrupted before capacity collection: calibration context raised from 131072 to 262144 so eight copies of the longer ledger fit; both arms use this same calibration context.',
   fixtureHashes:Object.fromEntries([256,768].map(n=>[n,createHash('sha256').update(JSON.stringify(capacityFixture(254,n))).digest('hex')])),
   servingLayoutControl:httpKvUnified?null:'cuda-layout-control-2026-10-10 tests separate/default and explicit unified layouts at identical context/sequence ceilings. Keep prior unified data as a separate condition; do not attribute its slowdown to HTTP alone.',
   cache:`HTTP cache_prompt=true, cache-ram=1024 MiB, ${httpKvUnified?'kv-unified':'no-kv-unified (stock default with explicit slots)'}, one exact-checked prefix-priming lookup then two parallel rounds; all overhead retained`,
   correctness:'All distinct exact lookup answers in both rounds; no retries',concurrency:'Peak native pool active agents versus sampled server is_processing slots; submitted promises and resident completed sequences do not qualify',
   boundaryRule:'Coarse sweep; after first GPU-allocation failure skip larger widths for that arm. Bisect GPU fit bracket to <=8 workers. Repeat last fit and first failure three times including existing observations. Repeat 254 three times if no GPU allocation failure. Other failures are retained and never renamed OOM.',
   timing:'1800 seconds per round is an experimental deadline, not a user latency SLO. Timing exploratory until observer overhead is checked.',
   fieldnoteComparison:false};
  await save(resolve(dir,'protocol.json'),protocol);
  await cp(resolve(root,'src'),resolve(dir,'execution-source/src'),{recursive:true});
  await cp(resolve(root,'instrumentation/patches'),resolve(dir,'execution-source/patches'),{recursive:true});
  await cp(resolve(root,'package-lock.json'),resolve(dir,'execution-source/package-lock.json'));
 }
 const {assertNoExternalModels}=await import('../../runtime/stack.ts');
 const {acquireModelLease}=await import('../../model-lease.ts');
 await assertNoExternalModels();const release=await acquireModelLease(root,'cuda-capacity-'+Date.now(),[config.port]);
 const abort=new AbortController(),stop=()=>abort.abort(new Error('Interrupted'));
 process.once('SIGINT',stop);process.once('SIGTERM',stop);
 let serial=0;
 const run=async(phase,records,count,backend,repeat,prefixBound)=>{
  const stem=`${phase}-p${records}-n${count}-${backend}-r${repeat}`;
  const entries=(await readdir(dir)).filter(n=>n===stem||n.startsWith(stem+'-attempt')).sort();
  for(const name of entries){const s=await optional(resolve(dir,name,'status.json'));if(s&&JSON.parse(s).status!=='interrupted')return name;}
  const name=entries.length?stem+'-attempt'+(entries.length+1):stem;
  const budget=phase==='calibration'?{sequences:backend==='langgraph'&&!httpKvUnified?count:count+2,context:262144}:capacityBudget(backend,count,prefixBound,httpKvUnified);
  console.log('Starting '+name+' '+JSON.stringify(budget));
  abort.signal.throwIfAborted();
  const status=await trial(config,resolve(dir,name),backend,count,budget.context,records,true,2,true,abort.signal,
   {...budget,phase,records,prefixBound,timeoutMs:protocol.timeoutMs,fixture:capacityFixture(count,records),primeHttpPrefix:true,httpKvUnified,matchHttpDeadline:protocol.httpDeadlineMatched??false});
  console.log(name+': '+JSON.stringify(status));await analyzeCapacity(dir);abort.signal.throwIfAborted();return name;
 };
 try{
  let calibration;try{calibration=await read(resolve(dir,'calibration.json'));}catch(e){if(e.code!=='ENOENT')throw e;}
  if(!calibration){
   calibration={createdAt:new Date().toISOString(),conditions:{}};
   for(const records of protocol.records){
    const native=await run('calibration',records,8,'lloyal',1),http=await run('calibration',records,8,'langgraph',1);
    const summary=await analyzeCapacity(dir);
    if([native,http].some(n=>!summary.rows.find(r=>r.trial===n)?.allocationFit))throw new Error('Calibration allocation did not pass; investigate retained evidence before continuing');
    const traces=parseJsonl(await optional(resolve(dir,native,'workload.jsonl'))).rows;
    const nativeTokens=traces.find(e=>e.event==='model.ready').sharedTextTokens;
    const hp=await read(resolve(dir,http,'http-prefix.json'));const maxHttpTokens=Math.max(...hp.rows.map(r=>r.tokens.length));
    calibration.conditions[records]={nativeTokens,maxHttpTokens,commonHttpPrefixTokens:hp.commonPrefixTokens,prefixBound:Math.max(nativeTokens+128,maxHttpTokens),native,http,quality:summary.rows.filter(r=>[native,http].includes(r.trial)).map(r=>({trial:r.trial,validResults:r.validResults,expected:r.gates.expectedResults,category:r.category}))};
   }
   await save(resolve(dir,'calibration.json'),calibration);
  }
  if(args.includes('--calibrate-only'))return;
  for(const records of protocol.records){
   const prefixBound=calibration.conditions[records].prefixBound,blocked=new Set();
   for(const count of protocol.counts){
    const arms=(serial++%2)?['langgraph','lloyal']:['lloyal','langgraph'];
    for(const backend of arms){
     if(blocked.has(backend))continue;
     const name=await run('sweep',records,count,backend,1,prefixBound);
     const row=(await analyzeCapacity(dir)).rows.find(r=>r.trial===name);if(row.category==='gpu-allocation')blocked.add(backend);
    }
   }
   for(const backend of ['lloyal','langgraph']){
    let rows=(await analyzeCapacity(dir)).rows.filter(r=>r.records===records&&r.phase!=='calibration'&&r.backend===backend);
    let high=Math.min(...rows.filter(r=>r.category==='gpu-allocation').map(r=>r.count));
    let low=Math.max(0,...rows.filter(r=>r.allocationFit&&r.count<high).map(r=>r.count));
    if(Number.isFinite(high)){
     while(low&&high-low>8){
      const count=Math.floor((low+high)/16)*8;
      const name=await run('refine',records,count,backend,1,prefixBound);
      const row=(await analyzeCapacity(dir)).rows.find(r=>r.trial===name);
      if(row.category==='gpu-allocation')high=count;else if(row.allocationFit)low=count;else break;
     }
    }else low=254;
    for(const count of [...new Set([low,high].filter(n=>n>0&&Number.isFinite(n)))]){
     rows=(await analyzeCapacity(dir)).rows.filter(r=>r.records===records&&r.phase!=='calibration'&&r.backend===backend&&r.count===count&&r.status!=='interrupted');
     for(let repeat=rows.length+1;repeat<=3;repeat++)await run('boundary',records,count,backend,repeat,prefixBound);
    }
   }
  }
 }finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);await release();await analyzeCapacity(dir);}
 await save(resolve(dir,'collection-complete.json'),{completedAt:new Date().toISOString(),meaning:'Declared sweep and boundary repetitions finished; failed outcomes retained. This does not imply all quality or capacity gates passed.'});
 console.log('Capacity evidence: '+dir);
}
