import { access, readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildFixtures, loadFixture } from './fixtures.js';
import { loadConfig, ROOT, jsonFile } from './util.js';

import type { AdapterName, JourneyName } from './types.js';

const args=process.argv.slice(2),command=args.shift()??'serve';
const option=(name:string,fallback:string)=>{const i=args.indexOf('--'+name);return i<0?fallback:args[i+1];};
try {
  const config=await loadConfig();
  if(args.includes('--instrumented')){config.memoryInstrumentation=true;config.fieldnoteRoot=resolve(ROOT,'work/fieldnote-instrumented');config.serverBinary=resolve(ROOT,'instrumentation/llama-server-build/bin/llama-server');}
  if(args.includes('--cpu-diagnostic'))config.cpuDiagnostic=true;
  if(command==='fixtures')console.log(JSON.stringify(await buildFixtures(),null,2));
  else if(command==='memory') {
    const modulePath='./experiments/memory/controller.mjs';
    const {memoryCommand}=await import(modulePath);
    await memoryCommand(args,config);
  }
  else if(command==='doctor') {
    const checks=[];
    for(const [name,path] of Object.entries({model:config.model,projector:config.projector,reranker:config.reranker,server:config.serverBinary,fieldnote:resolve(config.fieldnoteRoot,'bin/run.js')})) {
      try{await access(path);checks.push({name,path,ok:true,bytes:(await stat(path)).size});}catch{checks.push({name,path,ok:false});}
    }
    console.log(JSON.stringify({node:process.version,standaloneLangGraph:true,pythonRequired:false,checks},null,2));
    if(checks.some(c=>!c.ok))process.exitCode=1;
  } else if(command==='serve') {
    if(config.cpuDiagnostic)throw new Error('CPU diagnostics are headless only. The web benchmark requires GPU on both backends.');
    const backend=option('backend','langgraph');if(!['langgraph','fieldnote'].includes(backend))throw new Error('Use --backend langgraph or fieldnote');
    const {serveFieldnote}=await import('./host/server.js');
    const host=await serveFieldnote(config,{backend:backend as 'langgraph'|'fieldnote',port:Number(option('port','8098')),corpusPath:option('corpus',''),...(args.includes('--data')?{dataPath:resolve(option('data',''))}: {})});
    console.log('Fieldnote: '+host.url+'\nRecords: '+host.dir+'\nThese interactive sessions remain unreviewed benchmark evidence.');
    let closing=false;for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{if(closing)return;closing=true;void host.close().then(()=>process.exit(0),e=>{console.error(e);process.exit(1);});});
  } else if(command==='run') {
    const adapter=option('adapter','langgraph') as AdapterName,journey=option('journey','J2') as JourneyName;
    if(!['fieldnote','langgraph'].includes(adapter)||!['J1','J1-investigate','J2'].includes(journey))throw new Error('Invalid adapter or journey');
    const {BenchRun}=await import('./runner.js');
    const run=new BenchRun(config,await loadFixture(),{adapter,journey,control:option('control','interactive')==='uninterrupted'?'uninterrupted':'interactive',automatic:true,browser:false});
    run.log.on(e=>{if(['ready','plan.review','plan.accepted','control.held','control.resumed','control.closing','inquiry.status','complete','run.error'].includes(e.type))console.log(`[${(e.t_ms/1000).toFixed(1)}s] ${e.type} ${e.inquiry??''} ${JSON.stringify(e.data).slice(0,260)}`);});
    process.once('SIGINT',()=>void run.stop());
    console.log(`Run: ${run.dir}`);await run.start();console.log(JSON.stringify(run.result,null,2));if(run.error)process.exitCode=1;
  } else if(command==='analyze') {
    const id=args[0];if(!id||!/^[-\w]+$/.test(id))throw new Error('Usage: npm run bench -- analyze RUN_ID');
    const dir=resolve(ROOT,'runs',id),manifest=JSON.parse(await readFile(resolve(dir,'manifest.json'),'utf8'));
    const events=(await readFile(resolve(dir,'events.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));
    const {summarize,reportHtml}=await import('./results.js');
    const result=await summarize(events,manifest.options,events.findLast(e=>e.type==='run.end')?.data.error??undefined);
    await jsonFile(resolve(dir,'summary.json'),result);await writeFile(resolve(dir,'report.html'),reportHtml(id,result));console.log('Rebuilt derived report; raw events unchanged: '+dir);
  } else if(command==='replay') {
    const id=args[0];if(!id||!/^[-\w]+$/.test(id))throw new Error('Usage: npm run bench -- replay RUN_ID');
    console.log(await readFile(resolve(ROOT,'runs',id,'summary.json'),'utf8'));
  } else throw new Error('Commands: serve, doctor, fixtures, run, replay, analyze');
}catch(error){console.error(error);process.exitCode=1;}
