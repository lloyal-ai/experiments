import { Annotation, StateGraph, START, END, Send, MemorySaver, interrupt, Command } from '@langchain/langgraph';
import { AIMessage, HumanMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages';
import { JsonOutputParser } from '@langchain/core/output_parsers';
import { z } from 'zod';
import type { Evidence } from '../evidence.js';
import { BUDGETS, prompt, render, preamble, sharedCatalog } from '../prompts.js';
import { runAgent } from './agent.js';
import { planSchema } from './schemas.js';
import { RunControl } from './control.js';
import type { Ask, Finding, Model, Plan, ResearchTask, Wire } from './contracts.js';
const State=Annotation.Root({
 ask:Annotation<Ask>(),plan:Annotation<Plan>(),coverage:Annotation<string>(),
 findings:Annotation<Finding[]>({reducer:(a,b)=>a.concat(b),default:()=>[]}),
 answer:Annotation<string|null>(),clarification:Annotation<string>(),
 index:Annotation<number>(),task:Annotation<ResearchTask>(),
});

export class ResearchWorkflow {
 readonly control=new RunControl();
 readonly checkpointer=new MemorySaver();
 private graph; private nextId=1; private queryGuard=new Set<string>();
 private started=performance.now();private researchAt=0;
 private coverageCache:Map<string,string>;
 pending?:Plan;
 constructor(readonly ask:Ask,readonly evidence:Evidence,private model:Model,private wire:Wire,coverageCache=new Map<string,string>(),private allocateAgent=()=>this.nextId++) {
  this.coverageCache=coverageCache;
  model.setRunContext?.(sharedCatalog(ask.sources)+'\n\n# Current brief\n'+ask.text);
  this.graph=new StateGraph(State)
   .addNode('discover',s=>this.discover(s.ask))
   .addNode('planning',s=>this.plan(s.ask))
   .addNode('review',s=>{
     if(s.ask.direct||s.ask.followup||s.plan.intent==='passthrough'||this.control.closing)return {};
     const value=interrupt({plan:s.plan}) as {plan:Plan;clarification?:string};
     return {plan:value.plan,clarification:value.clarification??'',...(value.clarification?{ask:{...s.ask,history:[...s.ask.history,new HumanMessage(s.ask.text),new AIMessage(render('clarify',{questions:s.plan.clarifyQuestions})),new HumanMessage(value.clarification)]}}:{})};
   })
   .addNode('dispatch',s=>{this.queryGuard=new Set();this.researchAt=performance.now();this.wire({type:'research:start',agentCount:s.plan.tasks.length,mode:s.ask.mode,reports:{tool:'report',field:'result'}});return {};})
   .addNode('inquiry',async s=>({findings:[await this.inquiry(s.ask,s.plan,s.task,s.index,[])]}))
   .addNode('chain',async s=>{const findings:Finding[]=[];for(const [i,task] of s.plan.tasks.entries()){if(this.control.closing)break;findings.push(await this.inquiry(s.ask,s.plan,task,i,findings));}return {findings};})
   .addNode('settle',s=>this.settle(s.ask,s.plan,s.findings))
   .addNode('passthrough',s=>this.answer(s.ask,s.plan))
   .addEdge(START,'discover').addEdge('discover','planning').addEdge('planning','review')
   .addConditionalEdges('review',s=>s.clarification?'discover':s.plan.intent==='passthrough'?'passthrough':'dispatch')
   .addConditionalEdges('dispatch',s=>s.ask.mode==='deep'?'chain':s.plan.tasks.map((task,index)=>new Send('inquiry',{ask:s.ask,plan:s.plan,task,index})))
   .addEdge('inquiry','settle').addEdge('chain','settle').addEdge('settle',END).addEdge('passthrough',END)
   .compile({checkpointer:this.checkpointer});
 }
 private settings(){return {configurable:{thread_id:this.ask.docId},signal:this.control.abort.signal,recursionLimit:100};}
 private async drive(input:any){
   const result:any=await this.graph.invoke(input,this.settings());
   if(result.__interrupt__?.length){this.pending=result.__interrupt__[0].value.plan;return {pending:this.pending};}
   this.pending=undefined;
   return {answer:result.answer??null,findings:result.findings??[],plan:result.plan,wallTimeMs:performance.now()-this.started};
 }
 start(){return this.drive({ask:this.ask,findings:[]});}
 resume(plan:Plan,clarification?:string){this.pending=undefined;return this.drive(new Command({resume:{plan,clarification}}));}
 private async discover(ask:Ask){
   this.wire({type:'plan:start',query:ask.text,mode:ask.mode});
   if(ask.direct||ask.followup||ask.sources.length<2)return {coverage:'',clarification:''};
   const key=this.evidence.coverageKey(ask.text);const cached=this.coverageCache.get(key);if(cached!==undefined)return {coverage:cached,clarification:''};
   const at=performance.now();this.wire({type:'preflight:start',query:ask.text,abilityCount:ask.sources.length});
   const reports=await Promise.all(ask.sources.map(async(source,i)=>{
     const told=prompt('preflight',{query:ask.text,ability:{name:source.protocol,useWhen:source.useWhen,tools:source.tools,contents:source.toc}});
     const result=await runAgent({agentId:this.allocateAgent(),key:`source:${source.name}`,index:i,task:source.protocol,system:sharedCatalog(ask.sources)+'\n\n'+told.system,messages:[...ask.history,new HumanMessage(told.user)],probe:true,maxTurns:BUDGETS.recon.maxTurns,softMs:BUDGETS.recon.time.softLimit,hardMs:BUDGETS.recon.time.hardLimit,seed:2000+i,writesTheAnswer:false},this.model,this.evidence,this.control,this.wire,this.queryGuard);
     return result;
   }));
   const coverage=reports.filter(r=>r.body.trim()).map(r=>`### ${r.task}\n${r.body.trim()}`).join('\n\n');
   this.control.abort.signal.throwIfAborted();this.coverageCache.set(key,coverage);
   this.wire({type:'preflight:done',coverage,tokens:reports.reduce((s,r)=>s+r.tokens,0),toolCalls:reports.reduce((s,r)=>s+r.toolCalls,0),timeMs:performance.now()-at});return {coverage,clarification:''};
 }
 private async plan(ask:Ask){
   if(this.control.closing)return {plan:{intent:'passthrough',tasks:[],clarifyQuestions:[],tokenCount:0,timeMs:0} as Plan};
   if(ask.direct||ask.followup){const plan:Plan={intent:'research',tasks:[{description:ask.text}],clarifyQuestions:[],tokenCount:0,timeMs:0};this.wire({type:'plan',...plan});return {plan};}
   const at=performance.now(),id=this.allocateAgent(),max=BUDGETS.effort[ask.effort].maxTasks;
   const protocols=ask.sources.length>=2?ask.sources.map(s=>s.protocol):[];const schema=planSchema(max,protocols);
   const told=prompt(ask.mode==='flat'?'plan-flat':'plan',{query:ask.text,count:max,context:null,routingKey:'ability',date:new Date().toISOString().slice(0,10),sources:ask.sources.map(s=>({name:s.protocol,useWhen:s.useWhen,toc:s.toc})),coverage:this.coverageCache.get(this.evidence.coverageKey(ask.text))??''});
   this.wire({type:'agent:spawn',agentId:id,parentAgentId:0,key:'planner'});
   let aggregate:any;
   const ai=await this.controlled(id,signal=>this.model.chat([new SystemMessage(told.system),...ask.history,new HumanMessage(told.user)],{signal,agentId:id,stage:'planning',temperature:0.3,thinking:false,
     responseSchema:{name:'plan',schema:z.toJSONSchema(schema)},
     onChunk:c=>{aggregate=aggregate?aggregate.concat(c):c;if(typeof aggregate.content==='string'&&!signal.aborted)this.wire({type:'agent:plan_delta',agentId:id,text:aggregate.content});}
   }));
   const parsed=schema.parse(await new JsonOutputParser().parse(String(ai.content)));
   const tasks=parsed.tasks??[];if(parsed.intent==='research'&&!tasks.length)throw new Error('Planner returned research without tasks');if(parsed.intent==='clarify'&&!parsed.clarifyQuestions?.length)throw new Error('Planner returned clarify without questions');
   let plan:Plan={intent:parsed.intent,tasks:tasks.map(t=>({description:t.description,...(typeof t.ability==='string'?{ability:t.ability}:{})})),clarifyQuestions:parsed.clarifyQuestions??[],tokenCount:ai.usage_metadata?.output_tokens??0,timeMs:performance.now()-at};
   if(plan.intent==='passthrough'&&!ask.history.length)plan={...plan,intent:'research',tasks:[{description:ask.text}]};
   this.wire({type:'agent:usage',agentId:id,tokenCount:plan.tokenCount});this.wire({type:'agent:done',agentId:id});this.wire({type:'plan',...plan});return {plan};
 }
 private async inquiry(ask:Ask,plan:Plan,task:ResearchTask,index:number,prior:Finding[]){
   const row=BUDGETS.effort[ask.effort];const source=ask.direct||ask.followup?undefined:ask.sources.find(s=>s.protocol===task.ability)??ask.sources[0];
   const system=sharedCatalog(ask.sources)+'\n\n'+render('inquiry.system',{preamble:source?preamble(source,plan.tasks,index,ask.mode==='flat',row.maxTurns):'',tool:'report',takesSources:!!source,writesTheAnswer:plan.tasks.length===1});
   const history:BaseMessage[]=[...ask.history,...prior.filter(f=>f.body).flatMap(f=>[new HumanMessage('Research task: '+f.task),new AIMessage(f.body)]),new HumanMessage(task.description)];
   return runAgent({agentId:this.allocateAgent(),key:`task:${index}`,index,task:task.description,system,messages:history,direct:ask.direct||ask.followup,maxTurns:row.maxTurns,softMs:row.time.softLimit,hardMs:row.time.hardLimit,seed:1000+index,writesTheAnswer:plan.tasks.length===1},this.model,this.evidence,this.control,this.wire,this.queryGuard);
 }
 private async controlled<T>(id:number,work:(signal:AbortSignal)=>Promise<T>){
   const cancel=new AbortController();this.control.agents.set(id,cancel);const signal=AbortSignal.any([cancel.signal,this.control.abort.signal]);
   try{await this.control.boundary(signal);const result=await work(signal);await this.control.boundary(signal);return result;}
   catch(error){this.wire({type:'agent:failed',agentId:id,reason:cancel.signal.aborted?'user_cancel':String(error)});this.wire({type:'agent:done',agentId:id});throw error;}
   finally{this.control.agents.delete(id);}
 }
 private async textAnswer(messages:BaseMessage[],key:string){
   const id=this.allocateAgent();this.wire({type:'agent:spawn',agentId:id,parentAgentId:0,key});
   const ai=await this.controlled(id,signal=>this.model.chat(messages,{agentId:id,signal,stage:key,onReasoning:text=>{if(!signal.aborted)this.wire({type:'agent:reasoning_delta',agentId:id,text});},onChunk:c=>{if(!signal.aborted&&typeof c.content==='string'&&c.content)this.wire({type:'agent:text_delta',agentId:id,text:c.content});}}));
   const text=typeof ai.content==='string'?ai.content:'';this.wire({type:'agent:usage',agentId:id,tokenCount:ai.usage_metadata?.output_tokens??0});this.wire({type:'agent:return',agentId:id,result:text});this.wire({type:'agent:done',agentId:id});return {id,text,tokens:ai.usage_metadata?.output_tokens??0};
 }
 private async settle(ask:Ask,plan:Plan,findings:Finding[]){
   const ordered=[...findings].sort((a,b)=>a.index-b.index);
   this.wire({type:'research:done',totalTokens:ordered.reduce((s,f)=>s+f.tokens,0),totalToolCalls:ordered.reduce((s,f)=>s+f.toolCalls,0),timeMs:performance.now()-this.researchAt});
   if(plan.tasks.length===1)return {answer:ordered[0]?.body.trim()||null};
   if(!ordered.some(f=>f.body.trim()))return {answer:null};
   const told=prompt('synthesize-flat',{query:ask.text,findings:ordered.map(f=>({task:f.task,body:f.body.trim()}))});
   this.wire({type:'synthesize:start'});const at=performance.now();
   const result=await this.textAnswer([new SystemMessage(told.system),...ask.history,new HumanMessage(told.user)],'synthesis');
   this.wire({type:'synthesize:done',agentId:result.id,tokenCount:result.tokens,toolCallCount:0,timeMs:performance.now()-at});return {answer:result.text.trim()||null};
 }
 private async answer(ask:Ask,plan:Plan){
   if(this.control.closing)return {answer:null};
   this.wire({type:'research:start',agentCount:1,mode:ask.mode,reports:null});
   const result=await this.textAnswer([new SystemMessage(render('answer.system')),...ask.history,new HumanMessage(ask.text)],'task:0');return {answer:result.text.trim()||null};
 }
}
