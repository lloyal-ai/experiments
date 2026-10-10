import { mkdir, readFile, writeFile, access, readdir, cp } from 'node:fs/promises';
import { createWriteStream, createReadStream } from 'node:fs';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { fixture } from './fixture.mjs';
import { analyze } from './metrics.mjs';
import { systemSnapshot, gpuSnapshot, processMemory } from './platform.mjs';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const exec=promisify(execFile);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const get=(args,name,fallback)=>{const i=args.indexOf('--'+name);return i<0?fallback:args[i+1];};
async function hash(path){const h=createHash('sha256');for await(const chunk of createReadStream(path))h.update(chunk);return h.digest('hex');}
export async function receipt(config){
 const paths={model:config.model,addon:resolve(root,'instrumentation/lloyal-node/build/Release/lloyal.node'),server:config.serverBinary};
 const files={};for(const [name,path] of Object.entries(paths)){await access(path);files[name]={path,sha256:await hash(path)};}
 const sources={};for(const name of ['lloyal-node','lloyal-node/liblloyal','lloyal-node/llama.cpp']){
  const cwd=resolve(root,'instrumentation',name);const {stdout:head}=await exec('git',['rev-parse','HEAD'],{cwd});const {stdout:diff}=await exec('git',['diff','--binary'],{cwd,maxBuffer:20*1024*1024});
  const {stdout:untracked}=await exec('git',['ls-files','--others','--exclude-standard'],{cwd});
  const additions={};for(const f of untracked.trim().split('\n').filter(Boolean)){if(f.startsWith('src/'))additions[f]=await hash(resolve(cwd,f));}
  sources[name]={head:head.trim(),diffSha256:createHash('sha256').update(diff).digest('hex'),untrackedSourceHashes:additions};
 }
 const workload={};for(const f of await readdir(resolve(root,'src/experiments/memory')))if(f.endsWith('.mjs'))workload[f]=await hash(resolve(root,'src/experiments/memory',f));
 return {files,sources,workload,node:process.version,platform:process.platform,arch:process.arch};
}
function launch(command,args,dir,label,env){
 const log=createWriteStream(resolve(dir,label+'.log'));const child=spawn(command,args,{cwd:root,env,stdio:['ignore','pipe','pipe']});
 child.stdout.pipe(log);child.stderr.pipe(log);
 const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>{log.end();resolve({code,signal});});});
 return {child,done};
}
async function stop(process){
 if(!process||process.child.exitCode!==null||process.child.signalCode!==null)return;
 process.child.kill('SIGTERM');const timer=setTimeout(()=>process.child.kill('SIGKILL'),10000);
 try{await process.done;}finally{clearTimeout(timer);}
}
export async function trial(config,dir,backend,count,context,records,telemetry,rounds,scopeRounds,signal,overrides={}){
 await mkdir(dir,{recursive:true});
 const job={dir,backend,count,context,rounds,scopeRounds,model:config.model,appRoot:resolve(root,'work/fieldnote-instrumented'),sequences:16,port:config.port,timeoutMs:300000,fixture:fixture(count,records),...overrides};
 await writeFile(resolve(dir,'job.json'),JSON.stringify(job,null,2));
 await writeFile(resolve(dir,'system.before.json'),JSON.stringify(await systemSnapshot(),null,2));
 const env={...process.env,LLOYAL_LOCAL:'1',LLOYAL_NO_FALLBACK:'1',LLOYAL_BENCH_IDENTITY_LOG:resolve(dir,'native-identity.jsonl')};
 if(telemetry)env.LLAMA_BENCH_MEMORY_LOG=resolve(dir,'engine-memory.jsonl');else delete env.LLAMA_BENCH_MEMORY_LOG;
 let server,worker,resourceTimer,deadline;const started=Date.now();let statsBusy=false;const samples=[];
 const sample=async()=>{
  if(statsBusy)return;statsBusy=true;const sampleStarted=performance.now();
  try{
   const pids=[server?.child.pid,worker?.child.pid].filter(Boolean);
   if(pids.length){
    const [{stdout},gpu,hostMemory,slots]=await Promise.all([
     exec('ps',['-p',pids.join(','),'-o','pid=,rss=,%cpu=']),gpuSnapshot(),Promise.all(pids.map(async pid=>({pid,memory:await processMemory(pid)}))),
     server?fetch(`http://127.0.0.1:${config.port}/slots`,{signal:AbortSignal.timeout(500)}).then(r=>r.json()).catch(()=>null):null]);
    samples.push({unixMs:Date.now(),slots,gpu,hostMemory,collectionMs:performance.now()-sampleStarted,source:'ps.per-process',processes:stdout.trim().split('\n').filter(Boolean).map(l=>{const [pid,kib,cpuPct]=l.trim().split(/\s+/).map(Number);return {pid,rssBytes:kib*1024,cpuPct};})});
   }
  }catch(e){samples.push({unixMs:Date.now(),error:String(e)});}finally{statsBusy=false;}
 };
 const aborted=()=>{worker?.child.kill('SIGTERM');server?.child.kill('SIGTERM');};signal.addEventListener('abort',aborted);
 let status={status:'failed'};
 try{
  signal.throwIfAborted();
  resourceTimer=setInterval(()=>void sample(),1000);
  if(backend==='langgraph'){
   const args=['--model',config.model,'--ctx-size',String(context),'--parallel',String(job.sequences),'--host','127.0.0.1','--port',String(config.port),'--n-gpu-layers','99','--jinja',job.httpKvUnified===false?'--no-kv-unified':'--kv-unified','--cache-ram','1024','--cache-type-k','q4_0','--cache-type-v','q4_0','--batch-size','512','--ubatch-size','512','--metrics','--slots','--no-ui','--fit','off'];
   await writeFile(resolve(dir,'server-launch.json'),JSON.stringify({binary:config.serverBinary,args},null,2));
   server=launch(config.serverBinary,args,dir,'server',env);
   let ready=false;for(let i=0;i<180;i++){
    signal.throwIfAborted();if(server.child.exitCode!==null||server.child.signalCode)throw new Error('Server exited before readiness');
    try{if((await fetch(`http://127.0.0.1:${config.port}/health`,{signal:AbortSignal.timeout(500)})).ok){ready=true;break;}}catch{}
    await sleep(500);
   }if(!ready)throw new Error('Server readiness timeout');
   const props=await fetch(`http://127.0.0.1:${config.port}/props`);await writeFile(resolve(dir,'server.props.json'),await props.text());
  }
  worker=launch(process.execPath,[resolve(root,'src/experiments/memory',backend==='lloyal'?'native.mjs':'http.mjs'),resolve(dir,'job.json')],dir,'worker',env);
  await sample();
  let timedOut=false;deadline=setTimeout(()=>{timedOut=true;worker.child.kill('SIGTERM');},job.timeoutMs*(job.rounds??1)+120000);
  const result=await worker.done;status={status:timedOut?'timeout':result.code===0?'complete':'failed',...result};
 }catch(e){status={status:'failed',error:String(e)};}
 finally{
  clearTimeout(deadline);clearInterval(resourceTimer);signal.removeEventListener('abort',aborted);await stop(worker);await stop(server);
  await sample();while(statsBusy)await sleep(10);
  await writeFile(resolve(dir,'resources.json'),JSON.stringify({meaning:'Per-process RSS; do not sum as unique physical or GPU bytes',samples},null,2));
  await writeFile(resolve(dir,'system.after.json'),JSON.stringify(await systemSnapshot(),null,2));
  await writeFile(resolve(dir,'status.json'),JSON.stringify({...status,...(signal.aborted?{status:'interrupted'}:{}),backend,count,context,telemetry,startedAt:started,endedAt:Date.now()},null,2));
 }
 return status;
}
export async function memoryCommand(args,baseConfig){
 const mode=args[0]??'doctor';
 if(mode==='capacity'){return (await import('./capacity.mjs')).capacityCommand(args,baseConfig);}
 if(mode==='composed'){const {composedCommand}=await import('./composed.mjs');return composedCommand(args,baseConfig);}const config={...baseConfig,serverBinary:resolve(root,'instrumentation/llama-server-build/bin/llama-server')};
 if(mode==='analyze'){const dir=resolve(get(args,'experiment',''));const protocol=JSON.parse(await readFile(resolve(dir,'protocol.json'),'utf8'));const result=protocol.kind==='composed-Fieldnote-UI'?await (await import('./composed-metrics.mjs')).analyzeComposed(dir):await analyze(dir);console.log(JSON.stringify(result,null,2));return;}
 if(args.includes('--protocol')){const spec=JSON.parse(await readFile(resolve(get(args,'protocol','')),'utf8'));for(const key of ['counts','repeats','rounds','contexts','records','backend'])if(spec[key]!==undefined&&!args.includes('--'+key)&&!(key==='contexts'&&args.includes('--context')))args.push('--'+key,String(spec[key]));}
 const identity=await receipt(config);
 if(mode==='doctor'){console.log(JSON.stringify({ready:true,identity,appRoot:resolve(root,'work/fieldnote-instrumented'),nativeAPI:'agentPool + parallel + withSpine',httpAPI:'StateGraph + Send + ChatOpenAI',diagnosticArms:2,reason:'Normal shared-system message layout and shared-prefix HTTP control coincide for this diagnostic'},null,2));return;}
 if(mode!=='run')throw new Error('memory doctor | run | analyze');
 const counts=get(args,'counts','1,2,4,8').split(',').map(Number),repeats=Number(get(args,'repeats','3')),context=Number(get(args,'context','32768')),records=Number(get(args,'records','96')),rounds=Number(get(args,'rounds','1')); 
 if(![1,2].includes(rounds))throw new Error('Rounds must be 1 or 2');
 if(counts.some(n=>![1,2,4,8].includes(n))||!Number.isSafeInteger(repeats)||repeats<1||repeats>10||context<4096||records<16)throw new Error('Invalid protocol parameters');
 const contexts=get(args,'contexts',String(context)).split(',').map(Number);if(contexts.some(c=>!Number.isInteger(c)||c<4096||c>65536))throw new Error('Invalid context ladder');
 const overhead=args.includes('--overhead-check'),scopeRounds=args.includes('--scope-rounds');
 const only=get(args,'backend','both');if(!['both','lloyal','langgraph'].includes(only))throw new Error('Invalid backend');
 const dir=resolve(get(args,'output',resolve(root,'comparisons','memory-'+new Date().toISOString().replaceAll(':','-'))));
 const protocol={version:4,nativeRoundScope:scopeRounds?'effection.scoped':'outer-withSpine',nativePruneOnReturn:true,selectedBackend:only,overheadCheck:overhead,contexts,timeoutMs:300000,sampling:'greedy; same public JSON schema; no thinking',kind:'public-api-text-diagnostic',counts,repeats,context,records,rounds,telemetry:!args.includes('--no-telemetry'),identity,arms:['lloyal','langgraph-shared-prefix'],httpControlCoincides:true,fieldnoteComparison:false};
 let existing;try{existing=JSON.parse(await readFile(resolve(dir,'protocol.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 if(existing){
  if(!args.includes('--resume'))throw new Error('Output already contains an experiment; use a new directory or --resume');
  for(const key of ['version','nativeRoundScope','nativePruneOnReturn','overheadCheck','contexts','counts','repeats','records','rounds','telemetry'])if(JSON.stringify(existing[key])!==JSON.stringify(protocol[key]))throw new Error('Resume protocol mismatch: '+key);
  for(const key of ['model','addon','server'])if(existing.identity.files[key].sha256!==identity.files[key].sha256)throw new Error('Resume binary mismatch: '+key);
  for(const key of ['fixture.mjs','native.mjs','http.mjs'])if(existing.identity.workload[key]!==identity.workload[key])throw new Error('Resume workload mismatch: '+key);
  await writeFile(resolve(dir,'resume-'+Date.now()+'.json'),JSON.stringify({unixMs:Date.now(),identity},null,2));
 }else{await mkdir(dir,{recursive:true});await writeFile(resolve(dir,'protocol.json'),JSON.stringify(protocol,null,2));}
 if(!existing){await cp(resolve(root,'src'),resolve(dir,'execution-source/src'),{recursive:true});await cp(resolve(root,'instrumentation/patches'),resolve(dir,'execution-source/patches'),{recursive:true});await cp(resolve(root,'package-lock.json'),resolve(dir,'execution-source/package-lock.json'));}
 const {assertNoExternalModels}=await import('../../runtime/stack.ts');const {acquireModelLease}=await import('../../model-lease.ts');
 await assertNoExternalModels();const release=await acquireModelLease(root,'memory-'+Date.now(),[config.port]);
 const abort=new AbortController();const onSignal=()=>abort.abort(new Error('Interrupted'));process.once('SIGINT',onSignal);process.once('SIGTERM',onSignal);
 try{
  for(let repeat=0;repeat<repeats;repeat++)for(const context of contexts)for(const count of counts){
   const arms=only==='both'?(repeat%2?['langgraph','lloyal']:['lloyal','langgraph']):[only];
   for(const backend of arms)for(const telemetry of overhead?(repeat%2?[false,true]:[true,false]):[!args.includes('--no-telemetry')]){abort.signal.throwIfAborted();let name=`r${repeat+1}-n${count}${contexts.length>1?'-c'+context:''}-${backend}${overhead?(telemetry?'-on':'-off'):''}`;
    const prior=(await readdir(dir)).filter(x=>x===name||x.startsWith(name+'-attempt')).sort();let completed=false;
    for(const entry of prior){try{const old=JSON.parse(await readFile(resolve(dir,entry,'status.json'),'utf8'));if(old.status!=='interrupted')completed=true;}catch(e){if(e.code!=='ENOENT')throw e;}}
    if(existing&&completed){console.log('Retained completed outcome '+name);continue;}
    if(prior.length)name+='-attempt'+(prior.length+1);
    console.log('Starting '+name);
    const status=await trial(config,resolve(dir,name),backend,count,context,records,telemetry,rounds,scopeRounds,abort.signal);console.log(name+': '+JSON.stringify(status));
    if(status.status!=='complete'&&!args.includes('--continue-on-failure'))throw new Error('Validation failed; inspect '+resolve(dir,name));
   }
  }
 }finally{process.removeListener('SIGINT',onSignal);process.removeListener('SIGTERM',onSignal);await release();await analyze(dir);}
 console.log('Evidence: '+dir);
}
