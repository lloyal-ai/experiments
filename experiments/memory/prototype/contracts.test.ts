import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { sseData, HttpModel } from '../src/http-model.js';
import { Controls } from '../src/controls.js';
import { EventLog } from '../src/events.js';
import { Evidence, bm25 } from '../src/evidence.js';
import { loadFixture } from '../src/fixtures.js';
import { LangGraphAdapter, recoveryHistory } from '../src/langgraph.js';
import { loadConfig, sleep } from '../src/util.js';
import { acquireModelLease } from '../src/model-lease.js';

test('SSE preserves split UTF-8, CRLF, multiline records and terminal record',async()=>{
  const raw=new TextEncoder().encode('data: {"text":"café"}\r\n\r\ndata: first\r\ndata: second\r\n\r\ndata: [DONE]');
  const stream=new ReadableStream<Uint8Array>({start(c){for(const byte of raw)c.enqueue(new Uint8Array([byte]));c.close();}});
  const records=[];for await(const data of sseData(stream))records.push(data);
  assert.deepEqual(records,['{"text":"café"}','first\nsecond','[DONE]']);
});
test('two benchmark instances cannot hold a model lease at once',async()=>{
  const dir=await mkdtemp(resolve(tmpdir(),'bench-lease-'));const release=await acquireModelLease(dir,'first',[]);
  await assert.rejects(acquireModelLease(dir,'second',[]),/Another benchmark owns/);await release();
  const next=await acquireModelLease(dir,'second',[]);await next();
});
test('a held step remains blocked; cancel rejects it without waiting for resume',async()=>{
  const control=new Controls(),abort=new AbortController();control.hold();let advanced=false;
  const waiting=control.boundary(abort.signal).then(()=>{advanced=true;});
  await sleep(15);assert.equal(advanced,false);abort.abort(new Error('User canceled'));
  await assert.rejects(waiting,/User canceled/);control.resume();assert.equal(advanced,false);
});
test('evidence receipt detects changed image bytes; selected and submitted are distinct',async()=>{
  const fixture=await loadFixture(),dir=await mkdtemp(resolve(tmpdir(),'bench-receipt-'));
  const {readFile}=await import('node:fs/promises');const path=resolve(dir,'figure.png');await writeFile(path,await readFile(fixture.diagram));
  const events:any[]=[];const evidence=new Evidence(fixture,((...args:any[])=>{events.push(args);}) as any,()=>'',0);
  const receipt=await evidence.imageReceipt('task:0',path,'figure',2);assert.equal(receipt.status,'selected');
  evidence.submit([receipt],'request-1');assert.equal(evidence.receipts.get(receipt.id)?.requestId,'request-1');
  await evidence.inspect(receipt.id);await writeFile(path,'corrupt');await assert.rejects(evidence.inspect(receipt.id),/digest mismatch/);
});
test('search ranks the independent correction above the unrelated lamp passage',()=>{
  const scores=bm25('audit corrected Birch water capacity',['Audit corrected Birch water capacity to 900 liters','Cedar lamps 1400 lumens']);assert.ok(scores[0]>scores[1]);
});
test('closing a run rejects outstanding event gates',async()=>{
  const log=new EventLog();await log.open(await mkdtemp(resolve(tmpdir(),'bench-log-')));
  const waiting=log.waitFor(e=>e.type==='impossible',60000);const rejected=assert.rejects(waiting,/Run finished/);await log.close();await rejected;
});
test('a failure arriving before an event gate is registered is not lost',async()=>{
  const log=new EventLog();await log.open(await mkdtemp(resolve(tmpdir(),'bench-failed-gate-')));
  log.emit('run.error',{message:'Fixed-evidence contract violated'});
  await assert.rejects(log.waitFor(e=>e.type==='plan.review',60000),/Fixed-evidence contract/);
  await log.close();
});
test('early close keeps completed evidence while closing an incomplete tool batch',()=>{
  const history=recoveryHistory([{role:'assistant',content:null,tool_calls:[{id:'a',type:'function',function:{name:'read_source',arguments:'{}'}},{id:'b',type:'function',function:{name:'view_figure',arguments:'{}'}}]},{role:'tool',tool_call_id:'a',content:'Audited Birch capacity is 900.'}]);
  assert.equal(history[1].content,'Audited Birch capacity is 900.');assert.equal(history[2].tool_call_id,'b');assert.match(history[2].content,/No result is available/);
});
test('real LangGraph fan-out joins all findings and resends the synthesis transcript for a follow-up',async()=>{
  const config=await loadConfig(),fixture=await loadFixture(),dir=await mkdtemp(resolve(tmpdir(),'bench-graph-'));
  const log=new EventLog();await log.open(dir);log.stage='brief';const adapter=new LangGraphAdapter(config,fixture,dir,log.emit);
  let active=0,peak=0;const conversations:any[]=[];
  (adapter as any).model={chat:async(messages:any[],o:any)=>{
    conversations.push({messages:structuredClone(messages),inquiry:o.inquiry});o.onRequest?.('mock-'+conversations.length);
    if(o.inquiry==='planner')return {role:'assistant',content:JSON.stringify({tasks:[{description:'Model proposal'}]})};
    if(o.inquiry==='synthesis'){const content='Cedar meets the requirement with 1200 liters per day [trial].';o.onText?.(content);return {role:'assistant',content};}
    active++;peak=Math.max(peak,active);await sleep(15);active--;
    const content='Cedar 1200 liters per day. The orange route bypasses the UV chamber [PDF p.2].';o.onText?.(content);return {role:'assistant',content};
  }};
  await adapter.ask('Question','J1');await log.waitFor(e=>e.type==='plan.review',1000);await adapter.accept(fixture.journeys.J1.tasks);
  await log.waitFor(e=>e.type==='complete',5000);assert.equal(peak,4);
  const synthesis=conversations.find(c=>c.inquiry==='synthesis');for(let i=0;i<4;i++)assert.match(JSON.stringify(synthesis.messages),new RegExp(`task:${i}`));
  await sleep(0);const end=log.events.length-1;await adapter.ask('And the route?','J1',true);await log.waitFor(e=>e.type==='complete',5000,end);
  const followup=conversations.at(-1).messages;assert.ok(followup.some((m:any)=>m.role==='assistant'&&m.content.includes('meets the requirement')));
  await adapter.stop();await log.close();
});
test('canceling an HTTP-backed inquiry prevents late visible output and does not cancel its siblings',async()=>{
  const config=await loadConfig(),fixture=await loadFixture(),dir=await mkdtemp(resolve(tmpdir(),'bench-cancel-'));
  const log=new EventLog();await log.open(dir);const adapter=new LangGraphAdapter(config,fixture,dir,log.emit);
  let waitingResolve!:()=>void;const waiting=new Promise<void>(r=>waitingResolve=r);
  (adapter as any).model={chat:async(_messages:any[],o:any)=>{
    if(o.inquiry==='planner')return {role:'assistant',content:'{"tasks":[{"description":"plan"}]}'};
    if(o.inquiry==='task:1'){
      waitingResolve();await new Promise<void>((_,rej)=>{o.signal.addEventListener('abort',()=>{o.onText?.('late canceled output');rej(o.signal.reason);},{once:true});});
    }
    await sleep(20);o.onText?.('surviving evidence');return {role:'assistant',content:'surviving evidence'};
  }};
  await adapter.ask('Question','J1');await log.waitFor(e=>e.type==='plan.review',1000);await adapter.accept(fixture.journeys.J1.tasks.slice(0,2));await waiting;
  await adapter.cancel('task:1');await log.waitFor(e=>e.type==='complete',5000);
  assert.equal(log.events.some(e=>e.type==='section.update'&&e.data.text==='late canceled output'),false);
  assert.ok(log.events.some(e=>e.type==='inquiry.status'&&e.inquiry==='task:0'&&e.data.status==='completed'));
  await adapter.stop();await log.close();
});
