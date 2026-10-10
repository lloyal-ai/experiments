import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { hostname, platform, release, arch, totalmem, cpus } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { EventLog, emptyView, reduceView, type ViewState } from './events.js';
import { FieldnoteAdapter } from './fieldnote.js';
import { digest, errorText, jsonFile, ROOT, sleep, withTimeout } from './util.js';
import type { Adapter, AdapterName, Config, Event, Fixture, JourneyName, Receipt, Task } from './types.js';
import { summarize, reportHtml } from './results.js';
import { acquireModelLease } from './model-lease.js';
import { assertPortFree } from './server.js';
import { requireMatchedWorkload } from './workload-review.js';

export interface RunOptions { adapter: AdapterName; journey: JourneyName; control: 'interactive'|'uninterrupted'; automatic: boolean; browser: boolean }
export function usefulDraft(event: Event): boolean {
  return event.type === 'section.update' && event.data.text?.length >= 120 && /\[[^\]]+\]|page\s*2|p\.\s*2/i.test(event.data.text) && /1,?200|900|bypass|18\s*(?:credits|per)|UV chamber/i.test(event.data.text);
}
export async function hashFile(path: string) {
  const hash=createHash('sha256'); for await(const chunk of createReadStream(path)) hash.update(chunk);
  return 'sha256:'+hash.digest('hex');
}
export class BenchRun {
  id = `${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID().slice(0,6)}`;
  dir = resolve(ROOT,'runs',this.id);
  log = new EventLog(); view: ViewState = emptyView(); adapter!: Adapter;
  status: 'starting'|'running'|'finished'|'failed' = 'starting';
  result: any; error?: string; browserConnected = false;
  private finishing?: Promise<void>;
  private initialized = false;
  private stopRequested = false;
  private opened = false;
  private sampled?: ReturnType<typeof setInterval>;
  private metricsBusy = false;
  private lastMetrics = 0;
  private samplingAbort = new AbortController();
  private releaseModel?:()=>Promise<void>;
  constructor(public config:Config, public fixture:Fixture, public options:RunOptions) {
    if(config.cpuDiagnostic)this.dir=resolve(ROOT,'diagnostics',this.id);
    this.log.on(e=>{this.view=reduceView(this.view,e);});
  }
  async start() {
    requireMatchedWorkload();
    try {
      await mkdir(this.dir,{recursive:true});await this.log.open(this.dir);this.opened=true;
      this.log.emit('run.start',{id:this.id,...this.options});
      if(this.config.cpuDiagnostic) {
        if(this.options.adapter!=='langgraph')throw new Error('CPU diagnostic is only supported for the stock server; it is not a baseline comparison');
        this.log.emit('coverage.gap',{feature:'hardware',reason:'Explicit CPU-only diagnostic; exclude from GPU comparison'});
      }
      await jsonFile(resolve(this.dir,'manifest.json'),{
        version:1,id:this.id,createdAt:new Date().toISOString(),options:this.options,config:this.config,
        fixtureHashes:this.fixture.hashes,host:{hostname:hostname(),platform:platform(),release:release(),arch:arch(),memoryBytes:totalmem(),cpu:cpus()[0]?.model,node:process.version},
        dependencies:JSON.parse(await readFile(resolve(ROOT,'package.json'),'utf8')),
        fingerprints:{model:await hashFile(this.config.model),projector:await hashFile(this.config.projector),server:await hashFile(this.config.serverBinary),fieldnoteEntry:await hashFile(resolve(this.config.fieldnoteRoot,'dist/targets/web/serve.mjs')),nativeAddon:await hashFile(resolve(this.config.fieldnoteRoot,'node_modules/@lloyal-labs/lloyal.node-darwin-arm64/bin/lloyal.node')),nativeLlama:await hashFile(resolve(this.config.fieldnoteRoot,'node_modules/@lloyal-labs/lloyal.node-darwin-arm64/bin/libllama.0.dylib')),lockfile:await hashFile(resolve(ROOT,'package-lock.json'))},
        limitations:['Native and stock inference builds differ; engine revision parity is not established.','Stock server whole-process/device memory is unavailable in this sandbox.','BM25 retrieval in the incumbent differs from the baseline neural reranker.','Automatic fact coverage is provisional; blind quality review is required.','All fixtures are small and synthetic; these are pilot measurements.'],
      });
      if(this.stopRequested){await this.finish();return;}
      this.releaseModel=await acquireModelLease(ROOT,this.id,[this.config.fieldnotePort??8096,this.config.port]);
      if(this.options.adapter!=='fieldnote')throw new Error('The prototype LangGraph runner is retired. Use the compatible Fieldnote host.');
      this.adapter=new FieldnoteAdapter(this.config,this.fixture,this.dir,this.log.emit);
      this.sampled=setInterval(()=>void this.sample(),1000);this.sampled.unref();
      await this.adapter.start();this.initialized=true;
      if(this.stopRequested) {await this.finish();return;}
      this.status='running';this.log.stage='brief';
      await this.adapter.ask(this.fixture.journeys[this.options.journey].question,this.options.journey);
      if(this.options.automatic) await withTimeout(this.automatic(),this.config.timeoutMs,'Journey');
    } catch(e) {this.error=errorText(e);if(this.opened)this.log.emit('run.error',{message:this.error});await this.finish();}
  }
  private async sample() {
    if(!this.opened||this.finishing)return;
    this.log.emit('resource.sample',{source:'orchestrator-process-self',pid:process.pid,memory:process.memoryUsage(),resources:process.resourceUsage(),cpu:process.cpuUsage(),includesWebServer:this.options.browser});
    if(this.options.adapter==='langgraph' && this.initialized && !this.metricsBusy && Date.now()-this.lastMetrics>5000) {
      this.metricsBusy=true;this.lastMetrics=Date.now();
      try {const res=await fetch(`http://127.0.0.1:${this.config.port}/metrics`,{signal:AbortSignal.any([this.samplingAbort.signal,AbortSignal.timeout(30000)])});if(res.ok)this.log.emit('server.metrics',{prometheus:await res.text()});}catch{}finally{this.metricsBusy=false;}
    }
  }
  private async renderGate(event:Event) {
    if(!this.options.browser)return;
    await this.log.waitFor(e=>e.type==='ui.rendered'&&e.data.eventSeq>=event.seq&&e.data.visibility==='visible',30000,event.seq);
  }
  async control(action:string,data:any={}) {
    if(this.status!=='running')throw new Error('The run is not ready for controls');
    this.log.emit('user.action',{action,...data});
    switch(action) {
      case 'accept': {
        const tasks:Task[]=data.tasks??this.fixture.journeys[this.options.journey].tasks;
        if(!Array.isArray(tasks)||!tasks.length||tasks.length>8||tasks.some(t=>typeof t.description!=='string'||!t.description.trim()))throw new Error('Supply 1–8 non-empty inquiry descriptions');
        await this.adapter.accept(tasks.map((t,i)=>({id:`task:${i}`,description:t.description})));break;
      }
      case 'hold':await this.adapter.hold();break;
      case 'resume':await this.adapter.resume();break;
      case 'cancel':await this.adapter.cancel(String(data.inquiry));break;
      case 'close':await this.adapter.closeBrief();break;
      case 'followup':
        if(!this.view.completed)throw new Error('Wait until the brief is settled');
        this.log.stage='followup';await this.adapter.ask(data.question??this.fixture.journeys[this.options.journey].followup,this.options.journey,true);break;
      case 'finish':await this.finish();break;
      default:throw new Error(`Unknown control ${action}`);
    }
  }
  async inspect(receipt:Receipt) {
    if(this.options.browser) {
      const event=this.log.emit('ui.inspect_requested',{id:receipt.id});
      await this.log.waitFor(e=>e.type==='ui.inspected'&&e.data.id===receipt.id,30000,event.seq);
    } else await this.adapter.inspect(receipt.id);
  }
  private async inspectAvailable() {
    const all=[...this.adapter.receipts.values()].filter(r=>r.status!=='selected');
    for(const kind of ['text','image']) {
      const item=all.find(r=>r.kind===kind && (kind!=='image'||r.page===2||r.id.includes('native-image')));
      if(item && !this.log.events.some(e=>e.type==='inspection.resolved'&&e.data.id===item.id))await this.inspect(item);
    }
  }
  private async automatic() {
    if(this.options.journey!=='J2') {
      const plan=await this.log.waitFor(e=>e.type==='plan.review',this.config.timeoutMs);await this.renderGate(plan);
      await this.control('accept');
      if(this.options.control==='interactive')await this.interventions();
    }
    const settled=await this.log.waitFor(e=>e.type==='complete'&&e.stage==='brief',this.config.timeoutMs);
    await this.renderGate(settled);await this.inspectAvailable();
    const original=this.log.emit('inspection.original',{path:this.fixture.pdf,digest:digest(await readFile(this.fixture.pdf))});
    if(this.options.browser)await this.log.waitFor(e=>e.type==='ui.original_inspected',30000,original.seq);
    const before=this.log.events.length-1;
    await this.control('followup');
    const followed=await this.log.waitFor(e=>e.type==='complete',this.config.timeoutMs,before);
    await this.renderGate(followed);await this.inspectAvailable();
    await this.finish();
  }
  private async interventions() {
    const gate=await this.log.waitFor(e=>{
      if(e.type==='complete')return true;
      if(!usefulDraft(e))return false;
      return this.options.journey==='J1-investigate' || Object.entries(this.view.tasks).some(([id,t])=>id!==e.inquiry&&t.status==='running');
    },this.config.timeoutMs);
    if(gate.type==='complete'){this.log.emit('coverage.gap',{feature:'hold/cancel/close',reason:'No useful live section with active sibling before completion'});return;}
    await this.renderGate(gate);this.log.emit('milestone.useful',{eventSeq:gate.seq,provisional:true},gate.inquiry);
    const before=this.log.events.length-1;await this.control('hold');
    const held=await this.log.waitFor(e=>e.type==='control.held',30000,before);await this.renderGate(held);
    await this.inspectAvailable();
    if(this.options.journey==='J1') {
      const target=Object.entries(this.view.tasks).find(([id,t])=>id==='task:3'&&id!==gate.inquiry&&t.status==='running');
      if(target)await this.control('cancel',{inquiry:target[0]});
      else this.log.emit('coverage.gap',{feature:'cancel',reason:'No eligible active sibling at hold'});
    }
    await sleep(this.config.holdMs);await this.control('resume');
    const closed=await this.log.waitFor(e=>e.type==='complete'||(e.type==='section.update'&&e.inquiry==='task:2'&&usefulDraft(e)&&/(?:bypass|skip)[\s\S]{0,100}UV|UV[\s\S]{0,100}(?:bypass|skip)/i.test(e.data.text)&&[...this.adapter.receipts.values()].some(r=>r.status!=='selected'&&/18 credits|18.credit/i.test(r.text??''))),this.config.timeoutMs,held.seq);
    if(closed.type==='complete')this.log.emit('coverage.gap',{feature:'close',reason:'Visual evidence gate was not visible before settlement'});
    else {await this.renderGate(closed);await this.control('close');}
  }
  finish():Promise<void> {
    if(this.finishing)return this.finishing;
    this.finishing=(async()=>{
      clearInterval(this.sampled);this.log.stage='teardown';
      this.samplingAbort.abort();
      try{
        await this.adapter?.stop();
        if(this.releaseModel){await assertPortFree(this.config.fieldnotePort??8096);await assertPortFree(this.config.port);await this.releaseModel();this.releaseModel=undefined;}
      }catch(e){this.error??=`Backend cleanup failed; model lease retained: ${errorText(e)}`;}
      if(!this.opened)return;
      await jsonFile(resolve(this.dir,'receipts.json'),[...(this.adapter?.receipts.values()??[])]);
      this.log.emit('run.end',{error:this.error??null});
      this.status=this.error?'failed':'finished';
      this.result=await summarize(this.log.events,this.options,this.error);
      await jsonFile(resolve(this.dir,'summary.json'),this.result);
      await writeFile(resolve(this.dir,'report.html'),reportHtml(this.id,this.result));
      await this.log.close();
    })();return this.finishing;
  }
  async stop(){this.stopRequested=true;this.error??='Stopped by user';await this.finish();}
  acknowledge(type:string,data:any) {
    if(!['ui.rendered','ui.inspected','ui.original_inspected'].includes(type))throw new Error('Unknown browser acknowledgement');
    if(this.status==='finished'||this.status==='failed')return;
    this.log.emit(type,data);
  }
}
export async function savedRuns() {
  const root=resolve(ROOT,'runs');await mkdir(root,{recursive:true});
  return (await Promise.all((await readdir(root)).sort().reverse().map(async id=>{
    try{return {id,...JSON.parse(await readFile(resolve(root,id,'summary.json'),'utf8'))};}catch{return null;}
  }))).filter(Boolean);
}
