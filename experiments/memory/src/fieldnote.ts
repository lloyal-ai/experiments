import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { assertPortFree, stopChild } from './server.js';
import { digest, sleep, withTimeout } from './util.js';
import type { Adapter, Config, Fixture, JourneyName, Receipt, Task, Emit } from './types.js';

export class FieldnoteAdapter implements Adapter {
  name = 'fieldnote' as const;
  receipts = new Map<string, Receipt>();
  private child?: ChildProcess;
  private nativeRoot: string;
  private roots: any[] = [];
  private client?: {send(command:any):void;close():void};
  private hostUrl: string;
  private imageLoads = new Set<Promise<void>>();
  private imageUrls = new Map<string,string>();
  private state: any;
  private reduce: any;
  private sections: any;
  private selectAsk: any;
  private selectSettling: any;
  private revision = 0;
  private plan: any[] = [];
  private inquiryByAgent = new Map<number,string>();
  private agentByInquiry = new Map<string,number>();
  private lastDraft = new Map<string,string>();
  private pending = new Map<number,Receipt[]>();
  private readyResolve?: () => void;
  private readyReject?: (e:Error) => void;
  private sourcesResolve?: () => void;
  private sourcesReject?: (e:Error) => void;
  private webExcluded = false;
  private toolByAgent = new Map<number,string>();
  private raw: ReturnType<typeof createWriteStream>;
  private stopped = false;
  constructor(private config: Config, private fixture: Fixture, private dir: string, private emit: Emit) {
    this.nativeRoot=resolve(dir,'fieldnote'); this.hostUrl=`http://127.0.0.1:${config.fieldnotePort??8096}`; this.raw=createWriteStream(resolve(dir,'fieldnote-events.jsonl'));
  }
  async start() {
    await assertPortFree(this.config.fieldnotePort??8096);
    await mkdir(this.nativeRoot,{recursive:true});
    const require = createRequire(resolve(this.config.fieldnoteRoot,'package.json'));
    const { connectWss } = require('@lloyal-labs/binding/web');
    // The existing application and installed dependencies run unchanged, with a separate writable data root.
    await writeFile(resolve(this.nativeRoot,'harness.yml'), JSON.stringify({
      model: { llm: { id:'qwen3.5-4b',path:this.config.model,context:this.config.context,branches:5 }, reranker:{id:'qwen3-reranker-0.6b-q8',path:this.config.reranker}, vision:{path:this.config.projector} },
      sources:{outputDir:resolve(this.nativeRoot,'reports')}, defaults:{effort:'medium',guards:{url_dedup:{scope:'cohort'},query_dedup:{scope:'cohort'}}},
      abilities:{corpus:{corpusPath:resolve(this.fixture.root,'corpus')}}
    },null,2));
    const uiRoot=resolve(this.config.fieldnoteRoot,'src/ui');
    const stateModule=await import(pathToFileURL(resolve(uiRoot,'state.ts')).href);
    this.state=stateModule.initialState; this.reduce=stateModule.reduce;
    this.sections=(await import(pathToFileURL(resolve(uiRoot,'select/write.ts')).href)).selectSections;
    this.selectSettling=(await import(pathToFileURL(resolve(uiRoot,'select/write.ts')).href)).selectSettling;
    this.selectAsk=(await import(pathToFileURL(resolve(uiRoot,'select/settle.ts')).href)).selectAsk;
    const log=createWriteStream(resolve(this.dir,'fieldnote.log'));
    const ready=new Promise<void>((res,rej)=>{this.readyResolve=res;this.readyReject=rej;});
    void ready.catch(()=>{}); // The awaited startup below owns the error, including failures during ingress.
    this.child=spawn(process.execPath,[resolve(this.config.fieldnoteRoot,'bin/serve.js')],{
      cwd:this.config.fieldnoteRoot,
      env:{...process.env,LLOYAL_DEV:'1',LLOYAL_PROJECT_ROOT:this.nativeRoot,PORT:String(this.config.fieldnotePort??8096),HOST:'127.0.0.1',MAX_SESSIONS:'1'},
      stdio:['ignore','pipe','pipe']
    });
    this.child.stdout!.pipe(log);this.child.stderr!.pipe(log);this.child.once('close',()=>log.end());
    this.child.once('error',e=>{this.readyReject?.(e);this.emit('run.error',{message:e.message});});
    this.child.once('exit',(code,signal)=>{
      this.raw.end();
      if(!this.stopped) {const e=new Error(`Fieldnote exited (${code ?? signal}); see ${this.dir}/fieldnote.log`);this.readyReject?.(e);this.emit('run.error',{message:e.message});}
    });
    this.emit('backend.start',{pid:this.child.pid,entry:resolve(this.config.fieldnoteRoot,'bin/serve.js'),transport:'@lloyal-labs/host + binding wss',url:this.hostUrl,dataRoot:this.nativeRoot,sourceUnmodified:true});
    // The host listens before materializing a native session. Exercise its real HTTP ingress.
    let listening=false;
    for(let attempt=0;attempt<120;attempt++) {
      if(this.stopped)throw new Error('Fieldnote startup stopped');
      if(this.child.exitCode!==null||this.child.signalCode)throw new Error('Fieldnote host exited before listening');
      try{await fetch(this.hostUrl,{signal:AbortSignal.timeout(500)});listening=true;break;}catch{}
      await sleep(250);
    }
    if(!listening)throw new Error('Fieldnote host did not listen within 30 seconds');
    this.emit('attachment.ingest_start',{transport:'HTTP /v1/media/ingress'});
    for(const path of [this.fixture.pdf,this.fixture.image]) {
      const response=await fetch(this.hostUrl+'/v1/media/ingress',{method:'POST',headers:{'content-type':'application/octet-stream'},body:await readFile(path),signal:AbortSignal.timeout(60000)});
      if(!response.ok)throw new Error(`Fieldnote ingress ${response.status}: ${await response.text()}`);
      this.roots.push(await response.json());
    }
    this.emit('attachment.ingest_end',{roots:this.roots});
    this.client=connectWss(this.hostUrl.replace('http:','ws:'),{
      onEvent:(event:any)=>{this.raw.write(JSON.stringify(event)+'\n');try{this.event(event);}catch(e){this.emit('run.error',{message:`Fieldnote observer: ${e}`});}},
      onSession:(session:any)=>{this.emit('native.session',session);if(session.phase==='died'){const error=new Error('Fieldnote host session died; see fieldnote.log');this.readyReject?.(error);this.emit('run.error',{message:error.message});}},
      onClose:()=>{if(!this.stopped){const error=new Error('Fieldnote host WebSocket closed');this.readyReject?.(error);this.emit('run.error',{message:error.message});}},
    });
    await withTimeout(ready,180000,'Fieldnote startup');
    // Same source chip a Fieldnote user switches off. Wait for its acknowledgement before asking.
    const sourcesConfigured=new Promise<void>((res,rej)=>{this.sourcesResolve=res;this.sourcesReject=rej;});
    this.send({type:'toggle_participation',name:'web'});
    await withTimeout(sourcesConfigured,10000,'Fieldnote local-source configuration');
    this.emit('ready');
    this.emit('capabilities',{runtime:'existing Fieldnote web target',transport:'@lloyal-labs/host / @lloyal-labs/binding connectWss',sourceUnmodified:true,fullInspector:false,inspector:'Shared diagnostic viewer exposes a subset of Fieldnote inspection; native trace is retained separately.',trace:'existing LLOYAL_DEV trace over WebSocket',physicalMemory:'existing host:resources self-reported RSS; no device allocation inferred'});
  }
  private send(command:any) {
    if(!this.client)throw new Error('Fieldnote host session is not connected');
    this.client.send(command);
  }
  private event(e:any) {
    this.state=this.reduce(this.state,e);
    if(e.type==='host:resources')this.emit('resource.sample',{source:'native-process-self',memory:{rss:e.rssMb*1048576},cpuPct:e.cpuPct,hostEvent:e});
    const inquiry=this.inquiryByAgent.get(e.agentId);
    if(e.type==='weights:done') {this.readyResolve?.();this.readyResolve=undefined;this.readyReject=undefined;}
    if(e.type==='participation:toggled') {
      this.emit('sources.participation',e);
      if(e.name==='web') {
        this.webExcluded=e.included===false;
        if(this.webExcluded)this.sourcesResolve?.();
        else this.sourcesReject?.(new Error('Live web participation must be off for the fixed-evidence fixture'));
      }
    }
    if(e.type==='query') {this.lastDraft.clear();this.emit('query',{question:e.query,followup:e.warm,docId:e.docId});}
    if(e.type==='preflight:start')this.emit('preflight.start',{abilityCount:e.abilityCount});
    if(e.type==='preflight:done')this.emit('preflight.complete',e);
    if(e.type==='plan') this.plan=e.tasks;
    if(e.type==='ui:plan_review') {this.revision=e.revision;this.emit('plan.review',{tasks:this.plan,revision:e.revision});}
    if(e.type==='ui:clarify') this.emit('run.error',{message:'Fieldnote requested clarification; fixture requires an unambiguous research question',revision:e.revision});
    if(e.type==='agent:spawn') {
      const key=e.key;
      if(typeof key==='string' && key.startsWith('task:')) {this.inquiryByAgent.set(e.agentId,key);this.agentByInquiry.set(key,e.agentId);this.emit('inquiry.status',{status:'running',agentId:e.agentId},key);}
    }
    if(e.type==='agent:produce' && (e.entropy!==undefined || e.surprisal!==undefined)) this.emit('diagnostic.sample',{agentId:e.agentId,entropyNats:e.entropy,surprisalNats:e.surprisal,producedTokenCount:e.tokenCount,stage:'produced-before-commit'},inquiry);
    if(e.type==='agent:tick') this.emit('context.sample',{used:e.cellsUsed,total:e.nCtx,unit:'native-cells'});
    if(e.type==='agent:tool_call') {
      this.toolByAgent.set(e.agentId,e.tool);this.emit('tool.start',{name:e.tool,args:e.args,agentId:e.agentId},inquiry);
      if(['web_search','fetch_page'].includes(e.tool))this.emit('run.error',{message:'Fixed-evidence contract violated: Fieldnote invoked a live web tool'});
    }
    if(e.type==='agent:tool_result') {
      this.emit('tool.end',{name:e.tool,chars:e.result.length,agentId:e.agentId},inquiry);
      const r:Receipt={id:`native/${e.agentId}/${this.receipts.size}`,inquiry:inquiry??`agent:${e.agentId}`,source:e.tool,text:e.result,digest:digest(e.result),kind:'text',status:'selected'};
      this.receipts.set(r.id,r);this.pending.set(e.agentId,[...(this.pending.get(e.agentId)??[]),r]);
    }
    if(e.type==='agent:prefilled' && e.role!=='probe') {
      for(const r of this.pending.get(e.agentId)??[]) {r.status='prefilled';this.emit('evidence.receipt',r,r.inquiry);}
      this.pending.delete(e.agentId);
      for(const root of e.attachments??[]) {const load=this.recordImages(root,inquiry??`agent:${e.agentId}`);this.imageLoads.add(load);void load.catch(err=>this.emit('run.error',{message:String(err)})).finally(()=>this.imageLoads.delete(load));}
    }
    if(['agent:return','agent:recovered','agent:failed'].includes(e.type) && inquiry) this.emit('inquiry.status',{status:e.type==='agent:failed'?(e.reason==='user_cancel'?'canceled':'failed'):'completed',agentId:e.agentId},inquiry);
    if(e.type==='run:paused') this.emit('control.held',{implementation:'native pool hold',inferenceQuiescent:true});
    if(e.type==='run:resumed') this.emit('control.resumed',{pausedMs:e.pausedMs});
    if(e.type==='run:windingDown') this.emit('control.closing');
    if(e.type==='answer') this.emit('answer',{text:e.text});
    if(e.type==='complete') {this.emit('document.saved',{source:'Fieldnote library completion contract'});this.emit('complete',e.data);}
    if(e.type==='ui:error') this.emit('backend.warning',{message:e.message});
    if(e.type==='agent:trace') {
      const t=e.event;
      if(t.type==='entailment:content:exploit'||t.type==='rerank:end') this.emit('retrieval.ranking',{...t,method:'native reranker'},inquiry);
      if(t.type==='branch:prune') this.emit('native.branch_released',t,this.inquiryByAgent.get(t.branchHandle));
      if(t.type==='agent:turn') this.emit('native.turn',{agentId:t.agentId,turn:t.turn},inquiry);
      if(t.type==='warmDelta') this.emit('native.warm_delta',t,inquiry);
    }
    // These are the very selectors that drive Fieldnote's live sections, not decoded reasoning text.
    for(const section of this.sections(this.state)) {
      const key=`task:${section.index}`;
      if(section.inquiry) {this.inquiryByAgent.set(section.inquiry.id,key);this.agentByInquiry.set(key,section.inquiry.id);}
      if(section.prose && section.prose!==this.lastDraft.get(key)) {this.lastDraft.set(key,section.prose);this.emit('section.update',{text:section.prose,streaming:section.streaming},key);}
    }
    const ask=this.selectAsk(this.state);
    if(ask?.body && ask.body!==this.lastDraft.get('followup')) {this.lastDraft.set('followup',ask.body);this.emit('section.update',{text:ask.body},'followup');}
    const settling=this.selectSettling(this.state);
    if(settling?.body && settling.body!==this.lastDraft.get('synthesis')) {this.lastDraft.set('synthesis',settling.body);this.emit('section.update',{text:settling.body},'synthesis');}
  }
  private async recordImages(root:any,inquiry:string) {
    const response=await fetch(`${this.hostUrl}/v1/media/${root.digest}`,{signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw new Error(`Missing admitted root ${root.digest}`);
    const manifest:any=await response.json();
    const require=createRequire(resolve(this.config.fieldnoteRoot,'package.json'));
    const {representationsOf}=require('@lloyal-labs/media');
    const representations=representationsOf(manifest);
    for(let i=0;i<representations.length;i++) {
      const layer=representations[i];if(!layer.mediaType.startsWith('image/'))continue;
      const id=`native-image/${inquiry}/${layer.digest}`;if(this.receipts.has(id))continue;
      this.imageUrls.set(id,`${this.hostUrl}/v1/media/${root.digest}/representations/${i}`);
      const path=resolve(this.dir,'observed-images',layer.digest.slice(7)+'.png');
      const r:Receipt={id,inquiry,source:root.digest,path,digest:layer.digest,kind:'image',status:'prefilled'};
      this.receipts.set(id,r);this.emit('evidence.receipt',r,inquiry);
    }
  }
  async ask(question:string,journey:JourneyName,followup=false) {
    if(!this.webExcluded)throw new Error('Fieldnote local-source configuration has not been acknowledged');
    this.send({type:'set_config',patch:{defaults:{effort:journey==='J2'?'low':'medium'}}});
    this.send({type:'submit_query',query:question,mode:journey==='J1-investigate'?'deep':'flat',skipPlanner:journey==='J2'||followup,attachments:followup?[]:journey==='J2'?[this.roots[0]]:this.roots});
  }
  async accept(tasks:Task[]) {
    // Sequential command messages preserve the app's revision semantics; every edit emits a fresh plan.
    let n=this.plan.length;
    while(n>tasks.length){this.send({type:'delete_task',revision:this.revision,index:--n});}
    while(n<tasks.length){this.send({type:'add_task',revision:this.revision,afterIndex:n-1});n++;}
    for(let i=0;i<tasks.length;i++)this.send({type:'update_task_description',revision:this.revision,index:i,description:tasks[i].description});
    this.emit('plan.accepted',{tasks,revision:this.revision});this.send({type:'accept_plan',revision:this.revision});
  }
  async hold(){this.send({type:'pause'});}
  async resume(){this.send({type:'resume'});}
  async cancel(inquiry:string){const agentId=this.agentByInquiry.get(inquiry);if(agentId===undefined)throw new Error(`No active Fieldnote agent for ${inquiry}`);this.send({type:'cancel_agent',agentId});this.emit('control.cancel_requested',{agentId},inquiry);}
  async closeBrief(){this.send({type:'wrap_up'});}
  async inspect(id:string) {
    const r=this.receipts.get(id);if(!r)throw new Error(`Unknown receipt ${id}`);
    let bytes:Buffer;
    if(r.kind==='text')bytes=Buffer.from(r.text!);
    else if(this.stopped)bytes=await readFile(r.path!);
    else {const response=await fetch(this.imageUrls.get(id)!,{signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error(`Representation HTTP ${response.status}`);bytes=Buffer.from(await response.arrayBuffer());}
    if(digest(bytes)!==r.digest)throw new Error(`Receipt digest mismatch: ${id}`);
    if(r.kind==='image'){const meta=await sharp(bytes).metadata();r.width=meta.width;r.height=meta.height;await mkdir(resolve(this.dir,'observed-images'),{recursive:true});await writeFile(r.path!,bytes);}
    this.emit('inspection.resolved',{...r,verified:true},r.inquiry);return r;
  }
  pids(){return this.child?.pid?[this.child.pid]:[];}
  async stop(){
    // Archive content while the host is available. Browsing a saved result must not reload a model.
    await Promise.allSettled(this.imageLoads);
    await mkdir(resolve(this.dir,'observed-images'),{recursive:true});
    for(const r of this.receipts.values())if(r.kind==='image') {
      try {
        let bytes:Buffer;try{bytes=await readFile(r.path!);}catch{
          const response=await fetch(this.imageUrls.get(r.id)!,{signal:AbortSignal.timeout(10000)});
          if(!response.ok)throw new Error(`Representation HTTP ${response.status}`);bytes=Buffer.from(await response.arrayBuffer());
        }
        if(digest(bytes)!==r.digest)throw new Error('Image archive digest mismatch');await writeFile(r.path!,bytes);
      }catch(error){this.emit('coverage.gap',{feature:'saved image inspection',reason:String(error)});}
    }
    this.stopped=true;this.readyReject?.(new Error('Fieldnote startup stopped'));this.sourcesReject?.(new Error('Fieldnote startup stopped'));this.client?.close();await sleep(100);if(this.child)await stopChild(this.child);this.raw.end();
  }
}
