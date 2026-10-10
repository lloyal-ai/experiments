import {test} from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error Read-only report is a standalone Node script, outside the host build.
import {summarizeSession} from '../scripts/lib/session-report.mjs';

test('session reporting preserves aborted attempts, unknown counts, and separate native follow-ups',()=>{
 let seq=0;const r=(t_ms:number,type:string,data:any)=>({seq:++seq,t_ms,type,data});
 const raw=(t_ms:number,t:string,payload:any)=>r(t_ms,t==='command'?'wire.command.raw':'wire.native.raw',{raw:JSON.stringify({sessionId:'s',frame:{t,payload}})});
 const events=[r(10,'browser.command',{type:'submit_query',query:'first',mode:'flat'}),r(12,'wire.event',{type:'query',docId:'a',warm:false}),
 r(15,'http.request',{requestId:'x',wireBytes:200}),r(17,'wire.event',{type:'run:paused'}),r(37,'wire.event',{type:'run:resumed'}),
 r(40,'http.failure',{requestId:'x',error:'stopped'}),r(42,'wire.event',{type:'run:aborted'}),
 raw(50,'command',{type:'submit_query',query:'second',skipPlanner:true}),raw(51,'event',{type:'query',docId:'b',warm:true}),
 raw(52,'event',{type:'answer',text:'Cited result'}),raw(53,'event',{type:'complete',data:{}})];
 const report=summarizeSession(events,{backend:'test',test:true});
 assert.equal(report.attempts.length,2);const [failed,settled]=report.attempts;
 assert.equal(failed.status,'aborted');assert.equal(failed.timing.elapsedMs,32);assert.equal(failed.timing.elapsedExcludingAcknowledgedHoldMs,12);
 assert.equal(failed.http.reportedOutputTokens.total,null);assert.equal(failed.http.failed,1);
 assert.equal(settled.status,'settled-unreviewed');assert.equal(settled.followup,true);assert.equal(settled.comparisonEligible,false);
 assert.equal(settled.timing.elapsedMs,3);assert.equal(settled.answer,'Cited result');
});

test('session reporting uses reported cache counters, not request count or elapsed duration',()=>{
 const rows=[{seq:1,t_ms:0,type:'browser.command',data:{type:'submit_query',query:'q',mode:'flat'}},
 {seq:2,t_ms:1,type:'http.request',data:{requestId:'a',wireBytes:400}},
 {seq:3,t_ms:10,type:'http.response',data:{requestId:'a',usage:{input_tokens:100,output_tokens:20,input_token_details:{cache_read:30}}}},
 {seq:4,t_ms:11,type:'http.request',data:{requestId:'b',wireBytes:500}}];
 const [a]=summarizeSession(rows,{backend:'langgraph'}).attempts;
 assert.equal(a.status,'incomplete');assert.equal(a.timing.elapsedMs,null);assert.equal(a.http.requestBodyBytes,900);
 assert.equal(a.http.withoutTerminalObservation,1);assert.equal(a.http.reportedCachedPromptTokens.total,30);
 assert.equal(a.resources.perProcess.length,0);
});

test('native receipts preserve cell semantics and failed inquiries without double-counting UI mirrors',()=>{
 let seq=0;const raw=(t_ms:number,t:string,payload:any)=>({seq:++seq,t_ms,type:t==='command'?'wire.command.raw':'wire.native.raw',data:{raw:JSON.stringify({frame:{t,payload}})}});
 const rows=[raw(0,'command',{type:'submit_query',query:'q',mode:'flat'}),
 raw(1,'event',{type:'agent:prefilled',agentId:2,cells:100,role:'toolResult'}),
 raw(2,'event',{type:'agent:trace',agentId:2,event:{type:'branch:prefill',traceId:10,branchHandle:2,cells:100,role:'toolResult'}}),
 raw(3,'event',{type:'agent:failed',agentId:3,reason:'user_cancel'}),
 raw(4,'event',{type:'answer',text:'Partial answer'}),raw(5,'event',{type:'complete',data:{agentTokens:200}})];
 const [a]=summarizeSession(rows,{backend:'fieldnote'}).attempts;
 assert.equal(a.native.prefills.length,1);assert.equal(a.native.prefills[0].cells,100);
 assert.equal(a.native.completion.agentTokens,200);assert.equal(a.http.reportedOutputTokens.total,null);
 assert.equal(a.errors.length,1);assert.equal(a.errors[0].data.reason,'user_cancel');
 assert.equal(a.status,'settled-unreviewed');assert.equal(a.comparisonEligible,false);
});

test('abort cause sent after the terminal event remains visible without extending elapsed time',()=>{
 const rows=[{seq:1,t_ms:10,type:'browser.command',data:{type:'submit_query',query:'q'}},
 {seq:2,t_ms:30,type:'wire.event',data:{type:'run:aborted'}},
 {seq:3,t_ms:31,type:'wire.event',data:{type:'ui:error',message:'no_sequence'}}];
 const [a]=summarizeSession(rows,{backend:'fieldnote'}).attempts;
 assert.equal(a.status,'aborted');assert.equal(a.timing.elapsedMs,20);
 assert.equal(a.errors[0].data.message,'no_sequence');assert.equal(a.errors[0].afterTerminal,true);
});
