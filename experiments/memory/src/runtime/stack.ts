import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { assertPortFree, stopChild } from '../server.js';
import { acquireModelLease } from '../model-lease.js';
import { ROOT, sleep } from '../util.js';
import type { Config, Emit } from '../types.js';

export type StackName='fieldnote'|'langgraph';
export async function assertNoExternalModels(){
 const {stdout}=await promisify(execFile)('ps',['-axo','pid=,command=']);
 const conflicts=stdout.split('\n').filter(line=>/\bllama-server\b/.test(line)&&!line.includes('ps -axo')||/Fieldnote.app\/Contents\/MacOS\//i.test(line)||/\bnode\b.*\/(bin\/serve\.js|dist\/targets\/web\/serve\.mjs)/.test(line));
 if(conflicts.length)throw new Error('An inference process may already be resident. Stop it before launching another stack:\n'+conflicts.join('\n'));
}
export class ModelStack {
 private children:ChildProcess[]=[];private release?:()=>Promise<void>;
 readonly rankerPort:number;readonly nativePort:number;
 constructor(readonly name:StackName,private config:Config,readonly dir:string,private emit:Emit,private dataPath=resolve(dir,'data')){this.rankerPort=config.rerankerPort??8095;this.nativePort=config.fieldnotePort??8096;}
 pids(){return this.children.flatMap(c=>c.pid?[c.pid]:[]);}
 private async launch(label:string,args:string[],port:number,signal:AbortSignal,opts:{binary?:string;cwd?:string;env?:NodeJS.ProcessEnv}={}){
  await assertPortFree(port);signal.throwIfAborted();
  const log=createWriteStream(resolve(this.dir,label+'.log'));
  const child=spawn(opts.binary??this.config.serverBinary,args,{cwd:opts.cwd,env:{...(opts.env??process.env),...(this.config.memoryInstrumentation?{LLAMA_BENCH_MEMORY_LOG:resolve(this.dir,label+'.memory.jsonl')}:{})},stdio:['ignore','pipe','pipe']});this.children.push(child);
  child.stdout!.pipe(log);child.stderr!.pipe(log);child.once('close',()=>log.end());
  let error:Error|undefined;child.once('error',e=>error=e);
  this.emit('backend.start',{name:this.name,label,pid:child.pid,args,binary:opts.binary??this.config.serverBinary});
  for(let i=0;i<360;i++){
   signal.throwIfAborted();if(error)throw error;if(child.exitCode!==null||child.signalCode)throw new Error(`${label} exited (${child.exitCode??child.signalCode}); see ${this.dir}/${label}.log`);
   try{const response=await fetch(`http://127.0.0.1:${port}/health`,{signal:AbortSignal.timeout(500)});if(response.ok||this.name==='fieldnote'){this.emit('backend.ready',{label,pid:child.pid});return;}}catch{}
   await sleep(500);
  }throw new Error(label+' startup timed out');
 }
 async start(signal:AbortSignal,corpusPath:string,origin:string){
  if(this.config.cpuDiagnostic)throw new Error('The compatible UI requires GPU on both stacks');
  await mkdir(this.dir,{recursive:true});
  await assertNoExternalModels();
  this.release=await acquireModelLease(ROOT,this.name+'-'+Date.now(),[this.nativePort,this.config.port,this.rankerPort]);
  try{
   if(this.name==='langgraph'){
    await this.launch('reranker',['--model',this.config.reranker,'--host','127.0.0.1','--port',String(this.rankerPort),'--rerank','--pooling','rank','--ctx-size','16384','--parallel','1','--n-gpu-layers','99','--metrics','--no-ui','--fit','off'],this.rankerPort,signal);
    await this.launch('llama-server',['--model',this.config.model,'--mmproj',this.config.projector,'--host','127.0.0.1','--port',String(this.config.port),'--ctx-size',String(this.config.context),'--parallel',String(this.config.parallel),'--n-gpu-layers','99','--jinja','--kv-unified','--cache-ram','1024','--cache-type-k','q4_0','--cache-type-v','q4_0','--metrics','--slots','--no-ui','--fit','off'],this.config.port,signal);
    for(const [label,port] of [['reranker',this.rankerPort],['llama-server',this.config.port]] as const){const response=await fetch(`http://127.0.0.1:${port}/props`,{signal});if(!response.ok)throw new Error('Cannot record resolved server properties');await writeFile(resolve(this.dir,label+'.props.json'),await response.text());}
   }else{
    const data=this.dataPath;await mkdir(data,{recursive:true});
    const harnessPath=resolve(ROOT,'work/fieldnote-app/harness.yml');
    const harnessSource=await readFile(harnessPath,'utf8');
    // Use the native app's pinned YAML parser only on the native launch path.
    const {parse}=createRequire(resolve(this.config.fieldnoteRoot,'package.json'))('yaml');
    const branches=this.config.reasoning?.nativeBranches??parse(harnessSource)?.model?.llm?.branches;
    if(!Number.isSafeInteger(branches)||branches<1)throw new Error(harnessPath+': model.llm.branches must be a positive integer');
    const effective={model:{llm:{id:'qwen3.5-4b',path:this.config.model,context:this.config.context,branches},reranker:{id:'qwen3-reranker-0.6b-q8',path:this.config.reranker},vision:{path:this.config.projector}},sources:{outputDir:resolve(data,'reports')},defaults:{effort:'low',guards:{url_dedup:{scope:'cohort'},query_dedup:{scope:'cohort'}}},abilities:{corpus:corpusPath?{corpusPath}:{}}};
    await writeFile(resolve(this.dir,'native-harness.source.yml'),harnessSource);
    await writeFile(resolve(this.dir,'native-harness.resolved.json'),JSON.stringify(effective,null,2)+'\n');
    await writeFile(resolve(data,'harness.yml'),JSON.stringify(effective,null,2)+'\n');
    this.emit('backend.config',{name:this.name,source:harnessPath,sourceSha256:createHash('sha256').update(harnessSource).digest('hex'),context:this.config.context,branches});
    await this.launch('fieldnote',[resolve(this.config.fieldnoteRoot,'bin/serve.js')],this.nativePort,signal,{binary:process.execPath,cwd:this.config.fieldnoteRoot,env:{...process.env,...(this.config.memoryInstrumentation?{LLOYAL_LOCAL:'1',LLOYAL_NO_FALLBACK:'1',LLOYAL_BENCH_IDENTITY_LOG:resolve(this.dir,'native-loaded-identity.jsonl')} : {}),...(this.config.reasoning?{LLOYAL_REASONING_SAMPLING:JSON.stringify(this.config.reasoning),LLOYAL_REASONING_SAMPLER_LOG:resolve(this.dir,'native-sampling.jsonl')}:{}),LLOYAL_PROJECT_ROOT:data,LLOYAL_DEV:'1',HOST:'127.0.0.1',PORT:String(this.nativePort),MAX_SESSIONS:'1',ALLOWED_ORIGIN:origin}});
   }
  }catch(error){await this.stop();throw error;}
 }
 async stop(){for(const child of this.children.toReversed())await stopChild(child);this.children=[];await this.release?.();this.release=undefined;this.emit('backend.stopped',{name:this.name});}
}
