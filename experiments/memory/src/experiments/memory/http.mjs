import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Annotation, StateGraph, START, END, Send } from '@langchain/langgraph';
import { ChatOpenAI } from '@langchain/openai';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { checkAnswer } from './fixture.mjs';
import { benchmarkTransport } from './http-transport.mjs';
const job=JSON.parse(readFileSync(process.argv[2],'utf8'));
const observation=event=>appendFileSync(resolve(job.dir,'workload.jsonl'),JSON.stringify({unixMs:Date.now(),...event})+'\n');
const transport=job.matchHttpDeadline?benchmarkTransport(job.timeoutMs):null;
const inferenceFetch=transport?.fetch??fetch;
if(transport)writeFileSync(resolve(job.dir,'transport.json'),JSON.stringify(transport.receipt,null,2));
let round=0;
const state=Annotation.Root({index:Annotation(),results:Annotation({reducer:(a,b)=>a.concat(b),default:()=>[]})});
const graph=new StateGraph(state).addNode('dispatch',()=>({})).addNode('worker',async s=>{
 const task=job.fixture.tasks[s.index],start=performance.now();
 const capture=async(input,init)=>{
  writeFileSync(resolve(job.dir,`round-${round}-${task.id}.request.json`),String(init?.body??''));
  const response=await inferenceFetch(input,init);const bytes=await response.text();
  writeFileSync(resolve(job.dir,`round-${round}-${task.id}.response.json`),bytes);
  return new Response(bytes,{status:response.status,headers:response.headers});
 };
 const model=new ChatOpenAI({...(transport?{timeout:job.timeoutMs}:{}),model:'local',apiKey:'local',temperature:0,maxRetries:0,useResponsesApi:false,
  configuration:{baseURL:`http://127.0.0.1:${job.port}/v1`,fetch:capture},
  modelKwargs:{cache_prompt:true,seed:task.seed,top_k:0,top_p:1,min_p:0,chat_template_kwargs:{enable_thinking:false},
   response_format:{type:'json_schema',json_schema:{name:'entry',strict:true,schema:job.fixture.schema}}}});
 try {
  observation({event:'task.request',round,index:s.index});
  const ai=await model.invoke([new SystemMessage(job.fixture.shared),new HumanMessage(task.question)],{signal:AbortSignal.timeout(job.timeoutMs)});
  const result={key:task.id,result:ai.content,valid:checkAnswer(ai.content,task.expected),usage:ai.usage_metadata,durationMs:performance.now()-start,failed:null};
  observation({event:'task.done',round,index:s.index,outcome:result});return {results:[result]};
 }catch(error){const result={key:task.id,valid:false,failed:String(error)};observation({event:'task.done',round,index:s.index,outcome:result});return {results:[result]};}
}).addEdge(START,'dispatch').addConditionalEdges('dispatch',()=>job.fixture.tasks.map((_,index)=>new Send('worker',{index}))).addEdge('worker',END).compile();
const start=performance.now();
try {
 if(job.primeHttpPrefix){
  observation({event:'prefix.prime.start'});
  const task=job.fixture.prime;
  const body={model:'local',messages:[{role:'system',content:job.fixture.shared},{role:'user',content:task.question}],temperature:0,seed:task.seed,top_k:0,top_p:1,min_p:0,cache_prompt:true,chat_template_kwargs:{enable_thinking:false},response_format:{type:'json_schema',json_schema:{name:'entry',strict:true,schema:job.fixture.schema}}};
  writeFileSync(resolve(job.dir,'prime.request.json'),JSON.stringify(body));
  const response=await inferenceFetch(`http://127.0.0.1:${job.port}/v1/chat/completions`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(job.timeoutMs)});
  const bytes=await response.text();writeFileSync(resolve(job.dir,'prime.response.json'),bytes);
  if(!response.ok)throw new Error('Prefix priming failed: '+response.status);
  const parsed=JSON.parse(bytes);if(!checkAnswer(parsed.choices?.[0]?.message?.content??'',task.expected))throw new Error('Prefix priming answer failed exact check');
  observation({event:'prefix.prime.done',timings:parsed.timings});
 }
 const rounds=[];
 for(round=0;round<job.rounds;round++){
  const at=performance.now();observation({event:'round.start',round});
  const result=await graph.invoke({});
  rounds.push({round,workMs:performance.now()-at,outcomes:result.results});
  observation({event:'round.done',...rounds.at(-1)});
 }
 const outcomes=rounds.flatMap(r=>r.outcomes);
 writeFileSync(resolve(job.dir,'result.json'),JSON.stringify({backend:'langgraph-shared-prefix',workMs:performance.now()-start,rounds,outcomes},null,2));
 if(outcomes.length!==job.count*job.rounds||outcomes.some(r=>!r.valid))process.exitCode=2;
 // Format/tokenize the actual requests after timing, without running another inference.
 const tokenRows=[];
 for(const task of job.fixture.tasks){
  const request=JSON.parse(readFileSync(resolve(job.dir,`round-0-${task.id}.request.json`),'utf8'));
  const post=async(path,body)=>{const r=await fetch(`http://127.0.0.1:${job.port}/${path}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw new Error(path+': '+r.status);return r.json();};
  const applied=await post('apply-template',request);
  const tokenized=await post('tokenize',{content:applied.prompt,add_special:false,parse_special:true});
  tokenRows.push({task:task.id,prompt:applied.prompt,tokens:tokenized.tokens});
 }
 let prefix=0;while(prefix<Math.min(...tokenRows.map(r=>r.tokens.length))&&tokenRows.every(r=>r.tokens[prefix]===tokenRows[0].tokens[prefix]))prefix++;
 writeFileSync(resolve(job.dir,'http-prefix.json'),JSON.stringify({commonPrefixTokens:prefix,meaning:'Actual request chat-template endpoint plus pinned tokenizer; endpoint receipt retained separately from cache hits',rows:tokenRows},null,2));
}catch(error){writeFileSync(resolve(job.dir,'post-run-error.json'),JSON.stringify({error:String(error)}));process.exitCode=1;}

finally{await transport?.close();}
