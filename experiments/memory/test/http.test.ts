import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { LocalChatModel } from '../src/graph/model.js';
import { loadConfig } from '../src/util.js';
import { Evidence } from '../src/evidence.js';
import { runAgent } from '../src/graph/agent.js';
import { RunControl } from '../src/graph/control.js';

test('standard LangChain client streams stock chat tool calls and preserves wire/cache evidence',async()=>{
 const requests:any[]=[];const server=createServer(async(req,res)=>{const chunks=[];for await(const c of req)chunks.push(c);requests.push(JSON.parse(Buffer.concat(chunks).toString()));res.writeHead(200,{'content-type':'text/event-stream'});
 const chunk=(delta:any,finish:any=null,usage?:any)=>res.write('data: '+JSON.stringify({id:'chat-test',object:'chat.completion.chunk',created:1,model:'local',choices:[{index:0,delta,finish_reason:finish}],...(usage?{usage}:{})})+'\n\n');
 chunk({role:'assistant',reasoning_content:'Check the evidence.'});chunk({role:'assistant',tool_calls:[{index:0,id:'c1',type:'function',function:{name:'report',arguments:'{"result":"'}}]});chunk({tool_calls:[{index:0,function:{arguments:'A finding","sources":[]}'}}]});chunk({},'tool_calls',{prompt_tokens:100,completion_tokens:12,total_tokens:112,prompt_tokens_details:{cached_tokens:80}});res.end('data: [DONE]\n\n');});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const dir=await mkdtemp(resolve(tmpdir(),'langchain-http-')),config=await loadConfig();config.port=(server.address() as any).port;const observations:any[]=[];
 try{const model=new LocalChatModel(config,dir,((type:any,data:any)=>{observations.push({type,data});return {} as any;}));let streamed=0;let reasoning='';
 const result=await model.chat([new SystemMessage('Research'),new HumanMessage('Question')],{agentId:1,signal:new AbortController().signal,tools:[{type:'function',function:{name:'report',description:'Report',parameters:{type:'object',properties:{result:{type:'string'},sources:{type:'array',items:{type:'string'}}},required:['result','sources']}}}],onReasoning:text=>{reasoning+=text;},onChunk:()=>{streamed++;}});
 assert.equal(reasoning,'Check the evidence.');assert.equal(result.tool_calls?.[0].args.result,'A finding');assert.ok(streamed>=2);assert.equal(result.usage_metadata?.input_token_details?.cache_read,80);assert.equal(requests[0].cache_prompt,true);assert.equal(requests[0].max_tokens,undefined);
 const files=await readdir(resolve(dir,'http'));assert.equal(files.length,2);assert.match(await readFile(resolve(dir,'http',files.find(f=>f.endsWith('.response.txt'))!),'utf8'),/cached_tokens/);assert.ok(observations.some(o=>o.type==='http.response'));
 const report={type:'function',function:{name:'report',description:'Report',parameters:{type:'object',properties:{result:{type:'string'}}}}};
 await model.chat([new HumanMessage('Finish from the acquired evidence')],{agentId:2,signal:new AbortController().signal,tools:[{type:'function',function:{name:'search',description:'Search',parameters:{type:'object',properties:{}}}},report],toolChoice:'report'});
 assert.equal(requests[1].tool_choice,'required');assert.deepEqual(requests[1].tools.map((t:any)=>t.function.name),['report']);
 await assert.rejects(model.chat([new HumanMessage('Invalid choice')],{agentId:3,signal:new AbortController().signal,tools:[report],toolChoice:'missing'}),/not uniquely registered/);
 assert.equal(requests.length,2);
 }finally{await new Promise<void>(r=>server.close(()=>r()));}
});

test('planner JSON schema reaches the stock HTTP API without requiring a tool call',async()=>{
 let request:any;
 const server=createServer(async(req,res)=>{
  const chunks=[];for await(const c of req)chunks.push(c);request=JSON.parse(Buffer.concat(chunks).toString());
  res.writeHead(200,{'content-type':'text/event-stream'});
  res.write('data: '+JSON.stringify({id:'plan-test',object:'chat.completion.chunk',created:1,model:'local',choices:[{index:0,delta:{content:'{"intent":"research","tasks":[]}'},finish_reason:'stop'}]})+'\n\n');res.end('data: [DONE]\n\n');
 });
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const dir=await mkdtemp(resolve(tmpdir(),'schema-http-')),config=await loadConfig();config.port=(server.address() as any).port;
 const schema={type:'object',properties:{intent:{type:'string'},tasks:{type:'array',items:{type:'string'}}},required:['intent']};
 try{
  const model=new LocalChatModel(config,dir,(()=>({})) as any);
  const answer=await model.chat([new HumanMessage('Return the plan as JSON')],{agentId:1,signal:new AbortController().signal,thinking:false,responseSchema:{name:'plan',schema}});
  assert.deepEqual(request.response_format,{type:'json_schema',json_schema:{name:'plan',schema,strict:true}});
  assert.equal(request.tools,undefined);assert.equal(request.tool_choice,undefined);
  assert.equal(request.cache_prompt,true);assert.equal(request.chat_template_kwargs.enable_thinking,false);
  assert.equal(JSON.parse(String(answer.content)).intent,'research');
 }finally{await new Promise<void>(r=>server.close(()=>r()));}
});

test('real LangChain reasoning extension is displayed once through the agent',async()=>{
 const server=createServer(async(req,res)=>{for await(const _ of req){}res.writeHead(200,{'content-type':'text/event-stream'});
 const chunk=(delta:any,finish:any=null)=>res.write('data: '+JSON.stringify({id:'reasoning-test',object:'chat.completion.chunk',created:1,model:'local',choices:[{index:0,delta,finish_reason:finish}]})+'\n\n');
 chunk({role:'assistant',reasoning_content:'Inspect the evidence.'});chunk({content:'The result.'});chunk({},'stop');res.end('data: [DONE]\n\n');});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const dir=await mkdtemp(resolve(tmpdir(),'reasoning-display-')),config=await loadConfig();config.port=(server.address() as any).port;
 const emit:any=()=>({}),events:any[]=[];const model=new LocalChatModel(config,dir,emit);
 const evidence=new Evidence('',emit,{tokenize:async()=>[],score:async()=>[]},dir);
 try{await runAgent({agentId:1,key:'task:0',index:0,task:'Question',system:'Respond to the question.',messages:[new HumanMessage('Question')],direct:true,maxTurns:2,seed:1,writesTheAnswer:true},model,evidence,new RunControl(),e=>events.push(e),new Set());
 assert.equal(events.filter(e=>e.type==='agent:reasoning_delta').map(e=>e.text).join(''),'Inspect the evidence.');
 assert.equal(events.find(e=>e.type==='agent:return')?.result,'The result.');
 }finally{await new Promise<void>(r=>server.close(()=>r()));}
});
