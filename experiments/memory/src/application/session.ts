import { stat } from 'node:fs/promises';
import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { render } from '../prompts.js';
import { loadResources } from '../content/files.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Descriptor } from '@lloyal-labs/media';
import { Evidence } from '../evidence.js';
import type { Ranker } from '../reranker.js';
import type { Config, Emit } from '../types.js';
import { BUDGETS } from '../prompts.js';
import { ROOT } from '../util.js';
import { ResearchWorkflow } from '../graph/workflow.js';
import type { Ask, Model, Plan, Wire } from '../graph/contracts.js';
import { Library, type SavedThread } from './library.js';

type Active={id:string;ask:Ask;workflow:ResearchWorkflow;pending?:Plan;revision:number;job?:Promise<void>;roots:Set<string>};
export class FieldnoteSession {
 readonly id=randomUUID();readonly library:Library;
 evidence:Evidence;active?:Active;activeDocId:string|null=null;
 private nextAgentId=1;private revision=0;private coverage=new Map<string,string>();private closed=false;
 private excluded=new Set<string>(['web']);private corpusPath:string;
 private config:any;
 private commandTail:Promise<void>=Promise.resolve();
 constructor(private backend:Config,readonly dir:string,private model:Model,private ranker:Ranker,private emit:Emit,private wire:Wire,corpusPath=''){
  this.library=new Library(resolve(dir,'reports'));this.corpusPath=corpusPath;
  this.evidence=new Evidence(corpusPath,emit,ranker,dir);
  this.config={model:{llm:{id:'qwen3.5-4b',path:backend.model,context:backend.context},vision:{path:backend.projector},reranker:{path:backend.reranker}},sources:{outputDir:this.library.root},defaults:{effort:'low',reasoningMode:'flat',guards:{query_dedup:{scope:'cohort'},url_dedup:{scope:'cohort'}}},abilities:{corpus:corpusPath?{corpusPath}: {},documents:{},web:{}}};
 }
 private send(e:any){if(!this.closed)this.wire(e);}
 private publicConfig(){return {...this.config,abilities:{corpus:this.corpusPath?{corpusPath:true}:{},documents:{},web:{}}};}
 async initialize(){await this.evidence.initialize();this.send({type:'config:loaded',config:this.publicConfig(),origin:{},dev:true});this.abilities();this.send({type:'participation:toggled',name:'web',included:false});this.send({type:'corpus:indexed',corpusPath:this.corpusPath,fileCount:this.evidence.resources.length,chunkCount:this.evidence.chunks.length});await this.list();this.send({type:'bench:capabilities',backend:'LangGraph + llama-server',continuation:'Transcript resent over HTTP; KV reuse is server-managed and unconfirmed until measured',nativeTelemetry:false});this.send({type:'weights:done'});}
 private abilities(){this.send({type:'abilities:state',abilities:['corpus','documents','web'].map(name=>{const manifest=name==='web'?{protocol:{tools:[],useWhen:'Live web research is outside the initial local-source benchmark.'},hints:{},configSchema:{type:'object',properties:{}}}:JSON.parse(readFileSync(resolve(ROOT,`reference/abilities/${name}/ability.json`),'utf8'));return {name,title:name,description:manifest.protocol.useWhen,tools:manifest.protocol.tools,entitlements:[],configSchema:manifest.configSchema,config:name==='corpus'&&this.corpusPath?{corpusPath:true}:{},enabled:name==='documents'||name==='corpus'&&!!this.corpusPath};})});}
 async list(){this.send({type:'library:list',entries:await this.library.list()});}
 dispatch(command:unknown){if(command&&typeof command==='object'&&['stop','pause','resume','wrap_up','cancel_agent'].includes((command as any).type))return this.command(command).catch(e=>this.send({type:'ui:error',message:String(e)}));const next=this.commandTail.then(()=>this.command(command));this.commandTail=next.catch(e=>this.send({type:'ui:error',message:e instanceof Error?e.message:String(e)}));return this.commandTail;}
 private requireReview(revision:any){const run=this.active;if(!run?.pending||revision!==run.revision)throw new Error('That plan revision is no longer current.');return run;}
 private describe(thread:SavedThread){const r=thread.record;this.send({type:'doc',docId:thread.docId,title:r.query,answer:r.answer,mode:r.mode,effort:r.effort,direct:r.direct,attachments:r.attachments.map(d=>this.evidence.descriptor(d)),exchanges:thread.exchanges.map(e=>({question:e.query,body:e.answer,attachments:e.attachments}))});}
 private runEvent(run:Active,event:any){if(this.active!==run||this.closed)return;if(event.type==='agent:http_images')for(const d of event.attachments)run.roots.add(d.digest);this.send(event);}
 private drive(run:Active,work:()=>Promise<any>){
  const job=(async()=>{try{const result=await work();if(this.active!==run)return;
    if(result.pending){run.pending=result.pending;run.revision=++this.revision;this.send({type:run.pending?.intent==='clarify'?'ui:clarify':'ui:plan_review',revision:run.revision});return;}
    if(result.answer){await this.library.save(run.ask,result.answer,result.findings??[],[...run.roots],result.wallTimeMs,run.workflow.control.abort.signal);if(this.active!==run)return;}
    this.send({type:'answer',text:result.answer});this.send({type:'complete',data:{intent:result.plan?.intent,wallTimeMs:result.wallTimeMs,agentCount:result.findings?.length,totalToolCalls:result.findings?.reduce((s:number,f:any)=>s+f.toolCalls,0)}});
    this.emit('journey.settled',{docId:run.id,findings:result.findings,quality:'unreviewed',comparisonEligible:false});
    this.active=undefined;await this.library.release(run.id);await this.list();
    // The next take observes updated report files if the corpus points at the library.
    await this.evidence.initialize();this.send({type:'corpus:indexed',corpusPath:this.corpusPath,fileCount:this.evidence.resources.length,chunkCount:this.evidence.chunks.length});
   }catch(error){if(this.active===run){this.send({type:'ui:error',message:String(error)});this.send({type:'run:aborted'});this.active=undefined;await this.library.release(run.id);}this.emit('journey.failure',{docId:run.id,error:String(error)});}
  })();run.job=job;return job;
 }
 private async start(c:any){
  if(typeof c.query!=='string'||!c.query.trim())throw new Error('A question is required');if(!['flat','deep'].includes(c.mode))throw new Error('Invalid mode');
  const roots=c.attachments??[];if(!Array.isArray(roots))throw new Error('Attachments must be descriptors');
  this.evidence.snapshot(roots,[]); // Validate all roots before replacing any running document.
  const direct=!!c.skipPlanner;const thread=direct&&this.activeDocId?await this.library.read(this.activeDocId):null;
  const all=[...this.library.roots(thread).map(d=>this.evidence.descriptor(d)),...roots];const unique=[...new Map(all.map(d=>[d.digest,d])).values()];
  const snapshot=this.evidence.snapshot(unique,[...this.excluded]);
  const id=thread?.docId??await this.library.reserve();await this.stop();
  const ask:Ask={docId:id,text:c.query.trim(),mode:c.mode,effort:this.config.defaults.effort,direct,followup:!!thread,roots:unique,history:this.library.history(thread),sources:snapshot.sources()};
  const run={} as Active;const workflow=new ResearchWorkflow(ask,snapshot,this.model,e=>this.runEvent(run,e),this.coverage,()=>this.nextAgentId++);
  Object.assign(run,{id,ask,workflow,revision:0,roots:new Set(unique.map(d=>d.digest))});this.active=run;this.activeDocId=id;
  this.send({type:'query',docId:id,query:ask.text,warm:!!thread,direct,effort:ask.effort,attachments:roots});
  this.drive(run,()=>workflow.start());
 }
 async stop(){const run=this.active;if(!run)return;this.active=undefined;run.workflow.control.stop();await run.job;this.send({type:'run:aborted'});await this.library.release(run.id);}
 private async command(value:unknown){
  if(!value||typeof value!=='object'||typeof (value as any).type!=='string')throw new Error('Invalid command');const c=value as any;this.emit('browser.command',c);
  switch(c.type){
   case 'submit_query':return this.start(c);
   case 'stop':case 'cancel_plan':case 'edit_plan':return this.stop();
   case 'new_run':await this.stop();this.activeDocId=null;this.send({type:'doc:active',docId:null});return;
   case 'open_doc':{if(c.docId===null){this.activeDocId=null;this.send({type:'doc:active',docId:null});return;}if(typeof c.docId!=='string')throw new Error('Invalid document');if(this.active?.id!==c.docId){const t=await this.library.read(c.docId);if(!t)throw new Error('No such brief');this.describe(t);}this.activeDocId=c.docId;this.send({type:'doc:active',docId:c.docId});return;}
   case 'accept_plan':{const run=this.requireReview(c.revision);if(run.pending!.intent!=='research'||!run.pending!.tasks.length||run.pending!.tasks.some(t=>!t.description.trim()))throw new Error('The plan needs nonempty research tasks');const plan=structuredClone(run.pending!);run.pending=undefined;this.drive(run,()=>run.workflow.resume(plan));return;}
   case 'submit_clarification':{const run=this.requireReview(c.revision);if(run.pending!.intent!=='clarify'||typeof c.answer!=='string'||!c.answer.trim())throw new Error('A clarification answer is required');const plan=run.pending!;run.pending=undefined;run.ask={...run.ask,history:[...run.ask.history,new HumanMessage(run.ask.text),new AIMessage(render('clarify',{questions:plan.clarifyQuestions})),new HumanMessage(c.answer)]};this.send({type:'query',docId:run.id,query:run.ask.text,warm:false,direct:false,effort:run.ask.effort,attachments:run.ask.roots});this.drive(run,()=>run.workflow.resume(plan,c.answer));return;}
   case 'change_mode':{if(!['flat','deep'].includes(c.mode))throw new Error('Invalid mode');if(this.active?.pending){const r=this.active;r.workflow.control.stop();await r.job;const ask={...r.ask,mode:c.mode};const next={} as Active;const workflow=new ResearchWorkflow(ask,r.workflow.evidence,this.model,e=>this.runEvent(next,e),this.coverage,()=>this.nextAgentId++);Object.assign(next,{id:r.id,ask,workflow,revision:0,roots:r.roots});this.active=next;this.send({type:'query',docId:next.id,query:ask.text,warm:false,direct:false,effort:ask.effort,attachments:ask.roots});this.drive(next,()=>workflow.start());return;}this.config.defaults.reasoningMode=c.mode;return this.updated();}
   case 'update_task_description':case 'add_task':case 'delete_task':case 'move_task':{
    const run=this.requireReview(c.revision),plan=run.pending!;if(plan.intent!=='research')throw new Error('No research plan to edit');const tasks=[...plan.tasks];const idx=(i:any)=>{if(!Number.isInteger(i)||i<0||i>=tasks.length)throw new Error('Invalid task index');return i;};
    if(c.type==='update_task_description'){const i=idx(c.index);if(typeof c.description!=='string')throw new Error('Invalid description');tasks[i]={...tasks[i],description:c.description};}
    if(c.type==='add_task'){if(c.afterIndex!==-1)idx(c.afterIndex);tasks.splice(c.afterIndex+1,0,{description:''});}
    if(c.type==='delete_task'){if(tasks.length<=1)throw new Error('Keep at least one research task');tasks.splice(idx(c.index),1);}
    if(c.type==='move_task'){const from=idx(c.from),to=idx(c.to);const [t]=tasks.splice(from,1);tasks.splice(to,0,t);}
    run.pending={...plan,tasks};this.send({type:'plan',...run.pending});return;
   }
   case 'pause':{if(!this.active||this.active.pending)throw new Error('No active writing to hold');this.active.workflow.control.pause();this.send({type:'run:paused'});this.emit('control.hold',{boundary:'between asynchronous operations',inFlightHTTP:'may continue'});return;}
   case 'resume':{if(this.active){const pausedMs=this.active.workflow.control.resume();this.send({type:'run:resumed',pausedMs});}return;}
   case 'wrap_up':if(!this.active||this.active.pending)throw new Error('No active writing to close');this.active.workflow.control.close();this.send({type:'run:windingDown'});return;
   case 'cancel_agent':if(!this.active)throw new Error('No active run');this.active.workflow.control.cancel(c.agentId);return;
   case 'toggle_participation':if(!['corpus','documents'].includes(c.name))throw new Error('Live web is outside this implementation; it remains disabled');if(this.excluded.has(c.name))this.excluded.delete(c.name);else this.excluded.add(c.name);this.send({type:'participation:toggled',name:c.name,included:!this.excluded.has(c.name)});return;
   case 'set_ability_config':{
    if(c.name==='documents'){if(!c.values||Object.keys(c.values).length)throw new Error('Documents has no configurable settings');return this.abilities();}
    if(c.name!=='corpus')throw new Error('Live web is not implemented');
    const path=c.values?.corpusPath;if(path!==undefined&&(typeof path!=='string'||!path.trim()))throw new Error('corpusPath must be a directory');
    const full=path?resolve(path.replace(/^~(?=\/)/,process.env.HOME??'')):'';if(full)loadResources(full);
    // Build a new source snapshot; an already-running ask retains its own source configuration.
    const next=new Evidence(full,this.emit,this.ranker,this.dir);await next.initialize();this.corpusPath=full;this.evidence=next;this.config.abilities.corpus=full?{corpusPath:full}:{};this.coverage.clear();this.abilities();this.updated();this.send({type:'corpus:indexed',corpusPath:full,fileCount:next.resources.length,chunkCount:next.chunks.length});return;
   }
   case 'set_config':{
    const patch=c.patch;if(!patch||typeof patch!=='object')throw new Error('Invalid settings');
    if(Object.keys(patch).some(k=>k!=='defaults'))throw new Error('This served session permits runtime effort and mode settings; model and storage settings are launch options');
    const d=patch.defaults??{};if(Object.keys(d).some(k=>!['effort','reasoningMode'].includes(k)))throw new Error('Unsupported live setting');
    if(d.effort!==undefined&&!['low','medium','high','ultra'].includes(d.effort))throw new Error('Invalid effort');if(d.reasoningMode!==undefined&&!['flat','deep'].includes(d.reasoningMode))throw new Error('Invalid mode');this.config.defaults={...this.config.defaults,...d};this.updated();return;
   }
   case 'reload_runtime':throw new Error('Model residency settings require stopping this stack and starting it with the requested launch configuration.');
   case 'library_list':return this.list();
   case 'library_search':{if(this.active)return;if(typeof c.query!=='string')throw new Error('Invalid library query');const entries=await this.library.list();let ranked:string[]=[];if(c.query.trim()){const contents=await Promise.all(entries.map(async e=>{const t=await this.library.read(e.docId);return e.title+'\n\n'+t!.record.answer.slice(0,400);}));const scores=await this.ranker.score(c.query,contents);ranked=entries.map((e,i)=>({path:e.path,score:scores[i]})).sort((a,b)=>b.score-a.score).map(e=>e.path);}this.send({type:'library:search',query:c.query,ranked});return;}
   case 'library_delete':{if(this.active)throw new Error('Stop the active run before deleting a brief');const id=await this.library.delete(c.path);if(id===this.activeDocId){this.activeDocId=null;this.send({type:'doc:active',docId:null});}await this.list();return;}
   case 'quit':return this.close();
   default:throw new Error('Unsupported command: '+c.type);
  }
 }
 private updated(){this.send({type:'config:updated',config:this.publicConfig(),origin:{},savedTo:null,gitignored:false,skipped:[]});}
 async close(){await this.stop();this.closed=true;}
}
