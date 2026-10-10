import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {WebSocket} from 'ws';
import {AIMessage} from '@langchain/core/messages';
import {serveFieldnote} from '../src/host/server.js';
import {loadConfig,sleep,withTimeout} from '../src/util.js';
import {loadFixture} from '../src/fixtures.js';

test('actual browser protocol uses one socket, real ingress/content routes, and saved library',async()=>{
 const dir=await mkdtemp(resolve(tmpdir(),'fieldnote-wire-'));const config=await loadConfig();
 const host=await serveFieldnote(config,{backend:'langgraph',port:0,dir,test:{ranker:{tokenize:async text=>[...text].map(c=>c.charCodeAt(0)),score:async(q,d)=>d.map(()=>1)},model:{chat:async()=>new AIMessage('An answer from the scripted contract test.')}}});
 const port=(host.server.address() as any).port,base=`http://127.0.0.1:${port}`,frames:any[]=[];const ws=new WebSocket(base.replace('http:','ws:'));
 try{ws.on('message',data=>frames.push(JSON.parse(data.toString())));await withTimeout((async()=>{while(!frames.some(f=>f.frame.t==='ready'))await sleep(5);})(),3000,'ready');
 const id=frames[0].sessionId;const send=(c:any)=>ws.send(JSON.stringify({sessionId:id,frame:{t:'command',payload:c}}));
 assert.ok(frames.some(f=>f.frame.payload?.type==='weights:done'));const fixture=await loadFixture();
 const upload=await fetch(base+'/v1/media/ingress',{method:'POST',body:await readFile(fixture.pdf)});assert.equal(upload.status,201);const root:any=await upload.json();
 const source=await fetch(base+`/v1/media/${root.digest}/source`);assert.equal(source.status,200);assert.equal(source.headers.get('content-type'),'application/pdf');
 send({type:'submit_query',query:'A test question',skipPlanner:true,mode:'flat',attachments:[root]});await withTimeout((async()=>{while(!frames.some(f=>f.frame.payload?.type==='complete'))await sleep(5);})(),5000,'complete');
 send({type:'library_list'});await sleep(30);assert.ok(frames.some(f=>f.frame.payload?.type==='library:list'&&f.frame.payload.entries.length===1));
 const second=new WebSocket(base.replace('http:','ws:'));const code=await new Promise<number>(r=>second.once('close',r));assert.equal(code,1013);
 }finally{ws.close();await host.close();}
});
