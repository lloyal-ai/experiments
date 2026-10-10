import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, openSync, closeSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateOutcomes } from './fixture.mjs';
const job=JSON.parse(readFileSync(process.argv[2],'utf8'));
const require=createRequire(resolve(job.appRoot,'package.json'));
const {run,scoped}=require('effection');
const {createContext}=require('@lloyal-labs/lloyal.node');
const {initAgents,withSpine,agentPool,parallel,JsonlTraceWriter}=require('@lloyal-labs/lloyal-agents');
const fd=openSync(resolve(job.dir,'agents.jsonl'),'w');
const observation=event=>appendFileSync(resolve(job.dir,'workload.jsonl'),JSON.stringify({unixMs:Date.now(),...event})+'\n');
const begin=performance.now();
try {
 const ctx=await createContext({modelPath:job.model,nCtx:job.context,nSeqMax:job.sequences,nBatch:512,typeK:'q4_0',typeV:'q4_0'});
 observation({event:'model.ready',pid:process.pid,sharedTextTokens:ctx.tokenizeSync(job.fixture.shared,false).length});
 const start=performance.now();
 const result=await run(function*(){
  yield* initAgents(ctx,{traceWriter:new JsonlTraceWriter(fd,{bufferSize:128})});
  return yield* withSpine({systemPrompt:job.fixture.shared,enableThinking:false,params:{temperature:0,topK:0,topP:1,minP:0}},function*(spine){
   observation({event:'prefix.ready'});
   const rounds=[];
   for(let round=0;round<job.rounds;round++){
   const at=performance.now();observation({event:'round.start',round});
   const runPool=function*(){return yield* agentPool({parent:spine,pruneOnReturn:true,enableThinking:false,schema:job.fixture.schema,acceptFreeText:true,
    budget:{maxTurns:1,context:{softLimit:1024,hardLimit:512}},capacity:job.count,
    orchestrate:parallel(job.fixture.tasks.map(t=>({key:t.id,content:t.question,systemPrompt:'',seed:t.seed})),{
     afterDone:function*(index,outcome){observation({event:'task.done',round,index,outcome});}
    })});};
   const result=yield* (job.scopeRounds?scoped(runPool):runPool());
   const outcomes=validateOutcomes(result.outcomes,job.fixture.tasks);
   rounds.push({round,workMs:performance.now()-at,outcomes,totalTokens:result.totalTokens,steps:result.steps,failure:result.failure?String(result.failure):null});
   observation({event:'round.done',...rounds.at(-1)});
   if(result.failure)break;
   }
   return rounds;
  });
 });
 const outcomes=result.flatMap(r=>r.outcomes);
 writeFileSync(resolve(job.dir,'result.json'),JSON.stringify({backend:'lloyal',startupAndWorkMs:performance.now()-begin,workMs:performance.now()-start,rounds:result,outcomes,failure:result.find(r=>r.failure)?.failure??null},null,2));
 if(result.some(r=>r.failure)||outcomes.length!==job.count*job.rounds||outcomes.some(o=>!o.valid))process.exitCode=2;
} catch(error) {writeFileSync(resolve(job.dir,'result.json'),JSON.stringify({backend:'lloyal',failure:String(error)},null,2));process.exitCode=1;}
finally {closeSync(fd);}
