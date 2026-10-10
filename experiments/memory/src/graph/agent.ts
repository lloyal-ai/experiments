import { Annotation, StateGraph, START, END } from '@langchain/langgraph';
import { AIMessage, HumanMessage, SystemMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import { tool } from '@langchain/core/tools';
import { parse } from 'partial-json';
import type { Evidence, ToolResult } from '../evidence.js';
import type { Receipt } from '../types.js';
import { weaveSourcesIntoResult } from '../../reference/portable/weave-sources.cjs';
import { BUDGETS, prompt } from '../prompts.js';
import { citedSchema, reportTool } from './schemas.js';
import type { Finding, Model, Wire } from './contracts.js';
import { RunControl } from './control.js';
import type { Message } from '../http-model.js';

export function evidenceHistory(messages:BaseMessage[]):Message[] {
  return messages.map(m=>({role:m.type==='ai'?'assistant':m.type==='human'?'user':m.type as any,content:m.content as any,
    ...(m instanceof AIMessage?{tool_calls:m.tool_calls?.map(c=>({id:c.id!,type:'function' as const,function:{name:c.name,arguments:JSON.stringify(c.args)}}))}:{}),
    ...(m instanceof ToolMessage?{tool_call_id:m.tool_call_id}:{})}));
}
export interface AgentInput { agentId:number; key:string; index:number; task:string; system:string; messages:BaseMessage[]; probe?:boolean; direct?:boolean; maxTurns:number; softMs?:number; hardMs?:number; seed:number; writesTheAnswer:boolean }
const State=Annotation.Root({messages:Annotation<BaseMessage[]>({reducer:(a,b)=>a.concat(b),default:()=>[]}),turns:Annotation<number>({default:()=>0,reducer:(_,b)=>b}),tokens:Annotation<number>({default:()=>0,reducer:(a,b)=>a+b}),calls:Annotation<number>({default:()=>0,reducer:(a,b)=>a+b}),body:Annotation<string>(),finished:Annotation<boolean>(),recover:Annotation<boolean>(),rejected:Annotation<boolean>()});

/** A normal model/tool StateGraph. Parallel tool promises and AbortSignals are application code. */
export async function runAgent(input:AgentInput,model:Model,evidence:Evidence,control:RunControl,wire:Wire,queryGuard:Set<string>):Promise<Finding> {
  const cancel=new AbortController();control.agents.set(input.agentId,cancel);
  const signal=AbortSignal.any([control.abort.signal,cancel.signal]);
  const started=control.elapsed();let reportRejected=false;const pendingImages:Receipt[]=[];
  wire({type:'agent:spawn',agentId:input.agentId,parentAgentId:0,key:input.key});

  let currentTokens=0;
  const send=(event:any)=>{if(!signal.aborted)wire({agentId:input.agentId,...event});};
  const invoke=async(messages:BaseMessage[],recovery=false)=>{
    await control.boundary(signal);
    const requestAbort=new AbortController();
    const close=()=>requestAbort.abort(new Error('Close requested'));
    if(!recovery)control.changes.once('close',close);
    let clearDeadline:(()=>void)|undefined;
    if(!recovery && input.hardMs!==undefined)clearDeadline=control.deadline(input.hardMs,started,()=>requestAbort.abort(new Error('Inquiry time limit')));
    let aggregate:any;let streamed='';
    try {
      return await model.chat(messages,{signal:AbortSignal.any([signal,requestAbort.signal]),agentId:input.agentId,tools:[...evidence.schemas(),reportTool(input.probe)],seed:input.seed,thinking:true,...(recovery?{toolChoice:'report'}:{}),
        onReasoning:text=>send({type:'agent:reasoning_delta',text}),
        onRequest:id=>{if(pendingImages.length){evidence.submit(pendingImages,id);send({type:'agent:http_images',attachments:pendingImages.flatMap(r=>r.attachment?[r.attachment]:[]),requestId:id,evidence:'submitted'});pendingImages.length=0;}},
        onChunk:chunk=>{
          aggregate=aggregate?aggregate.concat(chunk):chunk;
          // Presentation adapter: parsed LangChain argument chunks become an explicit report delta.
          // Raw arguments and response bytes remain in the request log; no native token/KV events are fabricated.
          const part=aggregate.tool_call_chunks?.find((c:any)=>c.name==='report');
          if(part?.args){try{const result=parse(part.args)?.result;if(typeof result==='string'&&result!==streamed){streamed=result;send({type:'agent:report_delta',text:result});}}catch{}}
          if(typeof chunk.content==='string' && chunk.content)send({type:'agent:text_delta',text:chunk.content});
        }
      });
    }finally{clearDeadline?.();control.changes.off('close',close);}
  };
  const tools=evidence.schemas().map(schema=>tool(async(args:any,cfg:any)=>{
    const name=schema.function.name;
    return evidence.execute(name,args,input.key,cfg.configurable.history,cfg.signal ?? signal);
  },{name:schema.function.name,description:schema.function.description,schema:schema.function.parameters as any}));
  const modelNode=async(s:typeof State.State)=>{
    const elapsed=control.elapsed()-started;
    if(control.closing||s.turns>=input.maxTurns||(input.softMs!==undefined&&elapsed>=input.softMs))return {recover:true};
    let ai:AIMessage;
    try{ai=await invoke(s.messages);}catch(e){if(signal.aborted)throw e;if(control.closing||(input.hardMs!==undefined&&control.elapsed()-started>=input.hardMs))return {recover:true};throw e;}
    await control.boundary(signal);
    const tokens=ai.usage_metadata?.output_tokens??0;currentTokens+=tokens;
    if(ai.invalid_tool_calls?.length)throw new Error('Model emitted malformed tool calls');
    const reports=ai.tool_calls?.filter(c=>c.name==='report')??[];
    if(reports.length){
      const report=reports[0];const parsed=input.probe?{success:typeof report.args.result==='string',data:report.args,error:null}:citedSchema.safeParse(report.args);
      let rejection:string|undefined;
      if(!parsed.success)rejection='Your report call did not match its schema. Call report again with every field as specified.';
      else if(s.calls<BUDGETS.evidence&&evidence.sources().length&&!reportRejected){reportRejected=true;rejection='You must use tools before submitting results.';}
      if(rejection){send({type:'agent:report_delta',text:''});return {messages:[ai,...(ai.tool_calls??[]).map(c=>new ToolMessage({tool_call_id:c.id!,content:rejection!}))],turns:s.turns+1,tokens};}
      const data=parsed.data as any;const body=input.probe?data.result:weaveSourcesIntoResult(data.result,data.sources);
      return {messages:[ai],body,finished:true,turns:s.turns+1,tokens};
    }
    if(!ai.tool_calls?.length){
      const text=typeof ai.content==='string'?ai.content:'';
      if(input.direct && text.trim())return {messages:[ai],body:text,finished:true,tokens,turns:s.turns+1};
      return {messages:[ai,new HumanMessage('Continue using the available tools, then submit your findings with report.')],turns:s.turns+1,tokens};
    }
    return {messages:[ai],turns:s.turns+1,tokens};
  };
  const toolNode=async(s:typeof State.State)=>{
    const ai=s.messages.at(-1) as AIMessage;
    const batchAbort=new AbortController();const closing=()=>batchAbort.abort(new Error('Close requested during tools'));control.changes.once('close',closing);if(control.closing)closing();
    let results:{message:ToolMessage;images:Receipt[]}[];try{results=await Promise.all((ai.tool_calls??[]).map(async call=>{
      await control.boundary(signal);send({type:'agent:tool_call',callId:call.id,tool:call.name,args:JSON.stringify(call.args)});
      let result:ToolResult;
      try{const t=tools.find(t=>t.name===call.name);if(!t)throw new Error('Unknown tool '+call.name);
        result=await t.invoke(call.args,{signal:AbortSignal.any([signal,batchAbort.signal]),configurable:{history:evidenceHistory(s.messages)}}) as ToolResult;
      }catch(e){if(signal.aborted)throw e;result={text:JSON.stringify({error:String(e)}),images:[],attachments:[],receipts:[]};}
      await control.boundary(signal);if(result.ranking)send({type:'agent:ranking',callId:call.id,tool:call.name,ranking:result.ranking});send({type:'agent:tool_result',callId:call.id,tool:call.name,result:result.text});
      pendingImages.push(...result.images);
      return {message:new ToolMessage({tool_call_id:call.id!,name:call.name,content:result.text}),images:result.images};
    }));}finally{control.changes.off('close',closing);}
    const pics=await evidence.imageMessages(results.flatMap(r=>r.images));
    return {messages:[...results.map(r=>r.message),...pics.map(m=>new HumanMessage({content:m.content as any}))],calls:results.length};
  };
  const recover=async(s:typeof State.State)=>{
    if(!s.calls&&!input.direct)return {finished:true,body:''};
    const recovery=prompt(input.probe?'preflight-recover':'recovery',{tool:'report',budget:'the available context',writesTheAnswer:input.writesTheAnswer});
    // Native free-KV word estimates are unavailable through this client. Do not invent a shorter report cap.
    recovery.system=recovery.system.replace('About the available context words, 1-3 lines.', 'Keep the coverage report to 1-3 lines.').replace(/IMPORTANT: You have approximately .*?words for your report\. Be concise — if you exceed the budget your report will be cut off\./, 'Deliver the findings supported by the completed evidence, with citations.');
    // Completed message/tool pairs are already in graph state; no replay of fabricated evidence.
    // The stock Qwen template permits a system message only at the beginning.
    // Recovery is an ordinary follow-up instruction, preserving the existing conversation.
    const ai=await invoke([...s.messages,new HumanMessage(recovery.system+'\n\n'+recovery.user)],true);
    const call=ai.tool_calls?.find(c=>c.name==='report');
    if(!call)throw new Error('Recovery did not return report');
    const data=input.probe?{result:String(call.args.result??''),sources:[]}:citedSchema.parse(call.args);
    const body=input.probe?data.result:weaveSourcesIntoResult(data.result,data.sources);
    send({type:'agent:recovered',result:body});return {messages:[ai],body,finished:true,tokens:ai.usage_metadata?.output_tokens??0};
  };
  const graph=new StateGraph(State).addNode('model',modelNode).addNode('tools',toolNode).addNode('recovery',recover)
    .addEdge(START,'model').addConditionalEdges('model',s=>s.finished?END:s.recover?'recovery':((s.messages.at(-1) as AIMessage)?.tool_calls?.length?'tools':'model'))
    .addEdge('tools','model').addEdge('recovery',END).compile();
  try{
    pendingImages.push(...await evidence.inputImages(input.key));
    const images=await evidence.imageMessages(pendingImages);
    const initial:BaseMessage[]=[new SystemMessage(input.system),...input.messages,...images.map(m=>new HumanMessage({content:m.content as any}))];
    const result=await graph.invoke({messages:initial},{signal,recursionLimit:input.maxTurns*3+12});
    signal.throwIfAborted();send({type:'agent:usage',tokenCount:result.tokens});send({type:'agent:return',result:result.body??''});send({type:'agent:done'});
    return {index:input.index,task:input.task,body:result.body??'',tokens:result.tokens,toolCalls:result.calls};
  }catch(error){wire({type:'agent:failed',agentId:input.agentId,reason:cancel.signal.aborted?'user_cancel':String(error)});wire({type:'agent:done',agentId:input.agentId});
    if(control.abort.signal.aborted)throw error;
    return {index:input.index,task:input.task,body:'',tokens:currentTokens,toolCalls:0,failed:String(error)};
  }finally{control.agents.delete(input.agentId);}
}
