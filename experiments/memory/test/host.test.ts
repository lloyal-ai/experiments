import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { AIMessage, AIMessageChunk, HumanMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import { FieldnoteSession } from '../src/application/session.js';
import { Evidence } from '../src/evidence.js';
import { RunControl } from '../src/graph/control.js';
import { loadConfig, sleep, withTimeout, ROOT } from '../src/util.js';
import { loadFixture } from '../src/fixtures.js';
import type { Ranker } from '../src/reranker.js';
import type { Model, ModelCall } from '../src/graph/contracts.js';
import { acquireModelLease } from '../src/model-lease.js';

// Scripted components exercise real graph/tool/media/host paths. Never inference measurements.
const ranker:Ranker={tokenize:async s=>Array.from(s).map(c=>c.charCodeAt(0)),score:async(q,docs)=>docs.map(d=>d.toLowerCase().includes(q.toLowerCase())?1:0.1)};
const emitted:any[]=[];const emit:any=(type:string,data:any)=>{const e={type,data};emitted.push(e);return e;};
async function workspace(){const dir=await mkdtemp(resolve(tmpdir(),'fieldnote-host-test-'));const corpus=resolve(dir,'corpus');await mkdir(corpus);await writeFile(resolve(corpus,'evidence.md'),'# Water trial\n\nCedar produces 1200 liters per day.\n\n## Audit\n\nBirch produces 900 liters per day.\n');return {dir,corpus};}
async function until(predicate:()=>boolean,events?:any[]){await withTimeout((async()=>{while(!predicate()){const failure=events?.find(e=>e.type==='ui:error');if(failure)throw new Error(failure.message);await sleep(10);}})(),10000,'test condition');}
function scripted():Model & {calls:{messages:BaseMessage[];options:ModelCall}[];peak:number;active:number}{return {calls:[],peak:0,active:0,async chat(messages,options){
 this.calls.push({messages,options});this.active++;this.peak=Math.max(this.peak,this.active);try{await sleep(10);options.signal.throwIfAborted();
 const system=String(messages[0].content),last=messages.at(-1);const count=messages.filter(m=>m instanceof ToolMessage).length;
 let ai:AIMessage;
 if(options.responseSchema?.name==='plan')ai=new AIMessage({content:JSON.stringify({intent:'research',tasks:[{description:'Compare Cedar capacity',...(JSON.stringify(options.responseSchema).includes('document_research')?{ability:'corpus_research'}:{})},{description:'Explain the audit',...(JSON.stringify(options.responseSchema).includes('document_research')?{ability:'document_research'}:{})}]})});
 else if(!options.tools?.length)ai=new AIMessage({content:'Cedar delivers 1200 liters/day; Birch 900. [Audit](evidence.md)'});
 else if(options.toolChoice==='report'||count>=2)ai=new AIMessage({content:'',tool_calls:[{id:'report',name:'report',args:{result:'Cedar delivers 1200 liters/day; the audit gives Birch 900. [Audit](evidence.md)',sources:[{title:'Audit',url:'evidence.md'}]}}]});
 else {const available=options.tools.map((t:any)=>t.function.name);const name=count===0?(available.includes('search')?'search':'search_documents'):(available.includes('read_file')?'read_file':'search_documents');ai=new AIMessage({content:'',tool_calls:[{id:'call-'+count,name,args:name==='read_file'?{filename:'evidence.md'}:{query:count?'audit':'Cedar'}}]});}
 options.onRequest?.('test');options.onChunk?.(new AIMessageChunk({content:ai.content,tool_call_chunks:ai.tool_calls?.map((c,i)=>({name:c.name,args:JSON.stringify(c.args),id:c.id,index:i,type:'tool_call_chunk'}))}));return ai;
 }finally{this.active--;}}};}

test('model lease excludes a second stack',async()=>{const {dir}=await workspace();const release=await acquireModelLease(dir,'one',[]);await assert.rejects(acquireModelLease(dir,'two',[]),/Another benchmark/);await release();});
test('Hold blocks the next boundary and cancellation releases that wait',async()=>{const c=new RunControl(),a=new AbortController();c.pause();let moved=false;const job=c.boundary(a.signal).then(()=>{moved=true;});await sleep(20);assert.equal(moved,false);a.abort(new Error('cancel'));await assert.rejects(job,/cancel/);});

test('real StateGraph planning interrupt, edits, fan-out, cited save and transcript follow-up',async()=>{
 const {dir,corpus}=await workspace(),events:any[]=[],model=scripted();const session=new FieldnoteSession(await loadConfig(),dir,model,ranker,emit,e=>events.push(e),corpus);
 await session.initialize();await session.dispatch({type:'submit_query',query:'Compare both systems',mode:'flat'});
 await until(()=>!!session.active?.pending,events);const revision=session.active!.revision;
 await session.dispatch({type:'update_task_description',revision:revision-1,index:0,description:'stale'});assert.match(events.at(-1).message,/revision/);events.pop();
 await session.dispatch({type:'update_task_description',revision,index:0,description:'Cedar capacity from audit'});
 await session.dispatch({type:'accept_plan',revision});await until(()=>!session.active,events);
 assert.ok(model.peak>=2);assert.equal(events.filter(e=>e.type==='complete').length,1);const entries=await session.library.list();assert.equal(entries.length,1);
 const saved=await session.library.read(entries[0].docId);assert.equal(saved?.record.inquiries.length,2);assert.match(saved!.record.answer,/1200/);
 const start=model.calls.length;await session.dispatch({type:'submit_query',query:'And Birch?',mode:'flat',skipPlanner:true});await until(()=>!session.active,events);
 assert.ok(model.calls.slice(start).some(c=>c.messages.some(m=>m instanceof AIMessage&&String(m.content).includes('1200'))));
 const ids=events.filter(e=>e.type==='agent:spawn').map(e=>e.agentId);assert.equal(new Set(ids).size,ids.length,'Agent identities are unique across follow-ups');
 const updated=await session.library.read(entries[0].docId);assert.equal(updated?.exchanges.length,1);await session.close();
});

test('actual PDF bytes produce text/page tools and a derived image, with inspected-byte receipts',async()=>{
 const {dir}=await workspace(),fixture=await loadFixture();const e=new Evidence('',emit,ranker,dir);const root=await e.ingest(await readFile(fixture.pdf));e.setRoots([root]);
 const search=JSON.parse((await e.execute('search_documents',{query:'Cedar'},'task:0')).text);assert.ok(search.hits.length);const doc=search.hits[0].id;
 const read=JSON.parse((await e.execute('read_document',{document:doc,page:1},'task:0')).text);assert.ok(read.content);assert.match(read.cite,/attachment:\/\//);
 const viewed=await e.execute('view_page',{document:doc,page:2},'task:0');assert.equal(viewed.images.length,1);await e.inspect(viewed.images[0].id);assert.equal(viewed.images[0].status,'selected');
 assert.ok((await e.imageMessages(viewed.images))[0].content);e.submit(viewed.images,'test-request');assert.equal(e.receipts.get(viewed.images[0].id)?.status,'submitted');
});

test('parallel evidence snapshots publish complete image bytes for HTTP readers',async()=>{
 const {dir}=await workspace(),fixture=await loadFixture();
 const e=new Evidence('',emit,ranker,dir),bytes=await readFile(fixture.image);
 const root=await e.ingest(bytes);
 // Different inquiry snapshots share the on-disk image address, as preflight does.
 const snapshots=Array.from({length:24},()=>e.snapshot([root],[]));
 await Promise.all(snapshots.map(async(snapshot,i)=>{
  for(let round=0;round<8;round++){
   const receipts=await snapshot.inputImages(`image:${i}:${round}`);
   assert.equal(receipts.length,1);
   await snapshot.inspect(receipts[0].id);
   const messages=await snapshot.imageMessages(receipts);
   assert.ok(messages[0].content);
  }
 }));
});

test('two participating sources run preflight before plan, then a canceled review preserves no brief',async()=>{
 const {dir,corpus}=await workspace(),events:any[]=[],model=scripted();const s=new FieldnoteSession(await loadConfig(),dir,model,ranker,emit,e=>events.push(e),corpus);await s.initialize();const fixture=await loadFixture();const root=await s.evidence.ingest(await readFile(fixture.pdf));
 await s.dispatch({type:'submit_query',query:'Compare the PDF with the corpus',mode:'flat',attachments:[root]});await until(()=>!!s.active?.pending,events);
 assert.ok(events.find(e=>e.type==='preflight:start'&&e.abilityCount===2));assert.ok(events.find(e=>e.type==='preflight:done'&&e.toolCalls>=4));assert.equal(events.filter(e=>e.type==='agent:spawn'&&e.key?.startsWith('source:')).length,2);
 await s.dispatch({type:'cancel_plan'});assert.equal((await s.library.list()).length,0);await s.close();
});

test('bad attachments are rejected before replacing the active plan; runtime source changes need no restart',async()=>{
 const {dir,corpus}=await workspace(),events:any[]=[],s=new FieldnoteSession(await loadConfig(),dir,scripted(),ranker,emit,e=>events.push(e),corpus);await s.initialize();await s.dispatch({type:'submit_query',query:'Compare',mode:'flat'});await until(()=>!!s.active?.pending,events);const active=s.active;
 await s.dispatch({type:'submit_query',query:'Bad',mode:'flat',attachments:[{digest:'sha256:'+'0'.repeat(64),size:1,mediaType:'bad'}]});assert.equal(s.active,active);assert.equal(events.at(-1).type,'ui:error');
 await s.dispatch({type:'set_ability_config',name:'corpus',values:{}});assert.equal(s.evidence.sources().length,0);assert.equal(active!.ask.sources[0].name,'corpus');assert.ok(events.find(e=>e.type==='config:updated'&&e.savedTo===null));await s.close();
});

test('canceling an HTTP inquiry suppresses late output, preserves siblings, and records failure',async()=>{
 const {dir,corpus}=await workspace(),events:any[]=[],normal=scripted();let canceledId=0,ready!:()=>void;const waiting=new Promise<void>(r=>{ready=r;});
 const model:Model={async chat(messages,o){const task=String(messages.filter(m=>m.type==='human').at(-1)?.content);if(task==='Explain the audit'&&o.responseSchema?.name!=='plan'){canceledId=o.agentId;ready();await new Promise<void>((_,reject)=>o.signal.addEventListener('abort',()=>{o.onChunk?.(new AIMessageChunk('late canceled output'));reject(o.signal.reason);},{once:true}));}return normal.chat(messages,o);}};
 const s=new FieldnoteSession(await loadConfig(),dir,model,ranker,emit,e=>events.push(e),corpus);await s.initialize();await s.dispatch({type:'submit_query',query:'Compare both',mode:'flat'});await until(()=>!!s.active?.pending,events);await s.dispatch({type:'accept_plan',revision:s.active!.revision});await withTimeout(waiting,2000,'cancel target');await s.dispatch({type:'cancel_agent',agentId:canceledId});await until(()=>!s.active,events);
 assert.ok(events.some(e=>e.type==='agent:failed'&&e.agentId===canceledId&&e.reason==='user_cancel'));assert.ok(events.some(e=>e.type==='agent:return'&&e.agentId!==canceledId));assert.ok(!events.some(e=>String(e.text).includes('late canceled')));assert.equal(events.filter(e=>e.type==='complete').length,1);await s.close();
});

test('Close aborts an in-flight request and recovers from already acquired tool evidence',async()=>{
 const {dir,corpus}=await workspace(),events:any[]=[],normal=scripted();let ready!:()=>void;const waiting=new Promise<void>(r=>{ready=r;});let recovering=false;
 const model:Model={async chat(messages,o){if(o.toolChoice==='report'){recovering=true;assert.ok(messages.some(m=>m instanceof ToolMessage&&String(m.content).includes('1200')));assert.equal(messages[0].type,'system');assert.ok(messages.slice(1).every(m=>m.type!=='system'),'Qwen accepts system instructions only at the beginning');assert.equal(messages.at(-1)?.type,'human');return normal.chat(messages,o);}if(messages.filter(m=>m instanceof ToolMessage).length>=2){ready();await new Promise<void>((_,reject)=>o.signal.addEventListener('abort',()=>reject(o.signal.reason),{once:true}));}return normal.chat(messages,o);}};
 const s=new FieldnoteSession(await loadConfig(),dir,model,ranker,emit,e=>events.push(e),corpus);await s.initialize();await s.dispatch({type:'submit_query',query:'Read the audit',mode:'flat',skipPlanner:true});await withTimeout(waiting,3000,'closing request');await s.dispatch({type:'wrap_up'});await until(()=>!s.active,events);assert.equal(recovering,true);assert.ok(events.some(e=>e.type==='agent:recovered'));assert.equal((await s.library.list()).length,1);await s.close();
});

test('citedReport rejects early reports once and malformed sources until repaired',async()=>{
 const {dir,corpus}=await workspace(),events:any[]=[];let calls=0;
 const model:Model={async chat(_messages,o){calls++;return new AIMessage({content:'',tool_calls:[{id:'r'+calls,name:'report',args:calls===1?{result:'No sources field'}:{result:'No relevant evidence was found.',sources:[]}}]});}};
 const s=new FieldnoteSession(await loadConfig(),dir,model,ranker,emit,e=>events.push(e),corpus);await s.initialize();await s.dispatch({type:'submit_query',query:'Question',mode:'flat',skipPlanner:true});await until(()=>!s.active,events);assert.equal(calls,3);assert.ok(events.some(e=>e.type==='complete'));await s.close();
});

test('the real Fieldnote reducer renders HTTP report deltas and preserves submitted roots without native prefill',async()=>{
 const {initialState,reduce}=await import('../work/fieldnote-app/src/ui/state.js');const {selectSections}=await import('../work/fieldnote-app/src/ui/select/write.js');
 let s:any=initialState;const fold=(e:any)=>{s=reduce(s,e);};
 fold({type:'query',docId:'test',query:'Question',warm:false});fold({type:'plan',intent:'research',tasks:[{description:'Task'}],clarifyQuestions:[],tokenCount:0,timeMs:0});fold({type:'research:start',mode:'flat',agentCount:1,reports:{tool:'report',field:'result'}});fold({type:'agent:spawn',agentId:1,parentAgentId:0,key:'task:0'});
 fold({type:'agent:report_delta',agentId:1,text:'Visible cited finding'});assert.equal(selectSections(s)[0].prose,'Visible cited finding');
 fold({type:'agent:http_images',agentId:1,attachments:[{digest:'sha256:'+'1'.repeat(64),size:123,mediaType:'application/vnd.oci.image.manifest.v1+json'}],requestId:'test',evidence:'submitted'});assert.equal(s.documents.get('test').attachments.length,1);assert.equal(s.session.pressure,null);
});


test('intentional Hold does not consume the inquiry time limit',async()=>{
 const control=new RunControl();let expired=false;const start=control.elapsed();const clear=control.deadline(80,start,()=>{expired=true;});
 control.pause();await sleep(130);assert.equal(expired,false);assert.ok(control.elapsed()-start<20);control.resume();await until(()=>expired);clear();
});

test('sequential Investigate supplies settled findings to the next task, and reopening restores the whole saved conversation',async()=>{
 const {dir,corpus}=await workspace(),events:any[]=[],model=scripted();const s=new FieldnoteSession(await loadConfig(),dir,model,ranker,emit,e=>events.push(e),corpus);await s.initialize();
 await s.dispatch({type:'submit_query',query:'Investigate the audit',mode:'deep'});await until(()=>!!s.active?.pending,events);await s.dispatch({type:'accept_plan',revision:s.active!.revision});await until(()=>!s.active,events);
 assert.equal(model.peak,1);assert.ok(model.calls.some(c=>c.messages.some(m=>m instanceof HumanMessage&&String(m.content).startsWith('Research task:'))&&c.messages.some(m=>m instanceof AIMessage&&String(m.content).includes('1200'))));
 const [entry]=await s.library.list();await s.close();const reopenedEvents:any[]=[];const reopened=new FieldnoteSession(await loadConfig(),dir,scripted(),ranker,emit,e=>reopenedEvents.push(e),corpus);await reopened.initialize();await reopened.dispatch({type:'open_doc',docId:entry.docId});assert.ok(reopenedEvents.some(e=>e.type==='doc'&&e.answer.includes('1200')));await reopened.close();
});

test('stopping during a settings rebuild still reaches the running inquiry immediately',async()=>{
 const {dir,corpus}=await workspace(),events:any[]=[];let slow=false,release!:()=>void;
 const delayed:Ranker={...ranker,tokenize:async t=>{if(slow)await new Promise<void>(r=>{release=r;});return ranker.tokenize(t);}};
 const s=new FieldnoteSession(await loadConfig(),dir,scripted(),delayed,emit,e=>events.push(e),corpus);await s.initialize();await s.dispatch({type:'submit_query',query:'Question',mode:'flat'});await until(()=>!!s.active?.pending,events);
 slow=true;const changing=s.dispatch({type:'set_ability_config',name:'corpus',values:{corpusPath:corpus}});await until(()=>!!release);await s.dispatch({type:'stop'});assert.equal(s.active,undefined);slow=false;release();await changing;await s.close();
});
