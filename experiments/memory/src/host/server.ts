import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { MAX_DOCUMENT_BYTES, DOCUMENT_UPLOAD_TIMEOUT_MS } from '@lloyal-labs/media/node';
import { createContentRoutes } from '../../reference/portable/content-routes.cjs';
import { FieldnoteSession } from '../application/session.js';
import { LocalChatModel } from '../graph/model.js';
import type { Model } from '../graph/contracts.js';
import { HttpReranker, type Ranker } from '../reranker.js';
import { ModelStack, type StackName } from '../runtime/stack.js';
import { Journal } from '../measurement/journal.js';
import type { Config } from '../types.js';
import { ROOT } from '../util.js';
import { captureIdentity } from '../measurement/identity.js';
import { observeResources } from '../measurement/resources.js';

const mime:Record<string,string>={'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.svg':'image/svg+xml','.png':'image/png','.json':'application/json'};
export interface HostOptions {backend:StackName;port:number;corpusPath?:string;dir?:string;dataPath?:string;/** Only explicit injected test dependencies skip GPU startup. */test?:{model:Model;ranker:Ranker}}
export async function serveFieldnote(config:Config,opts:HostOptions){
 const dir=resolve(opts.dir??resolve(ROOT,'sessions',opts.backend+'-'+new Date().toISOString().replaceAll(':','-')));await mkdir(dir,{recursive:true});
 const dataPath=resolve(opts.dataPath??resolve(dir,'data'));
 const journal=new Journal(dir),stack=new ModelStack(opts.backend,config,dir,journal.emit,dataPath);const shutdown=new AbortController();
 const origin=`http://127.0.0.1:${opts.port}`,app=resolve(ROOT,'work/fieldnote-app/dist-web');
 let stopObserving:(()=>Promise<void>)|undefined;
 let session:FieldnoteSession|undefined,connected=false,closing=false;
 let settleReady!:(ok:boolean)=>void;const ready=new Promise<boolean>(resolve=>{settleReady=resolve;});let content:ReturnType<typeof createContentRoutes>|undefined;let activeWs:WebSocket|undefined;
 const corpusPath=opts.corpusPath?resolve(opts.corpusPath):'';
 await writeFile(resolve(dir,'manifest.json'),JSON.stringify({version:2,backend:opts.backend,test:!!opts.test,comparisonEligible:false,quality:'unreviewed',config,corpusPath,dataPath,createdAt:new Date().toISOString(),frontendPatch:JSON.parse(await readFile(resolve(ROOT,'reference/frontend-patch.json'),'utf8'))},null,2));
 const server=createServer(async(req,res)=>{
  try{
   const url=new URL(req.url??'/',origin);
   if(url.pathname==='/__bench/browser'&&req.method==='POST'){let size=0;const chunks:Buffer[]=[];for await(const part of req){size+=part.length;if(size>1048576)throw new Error('Observation too large');chunks.push(part);}journal.emit('browser.observation',JSON.parse(Buffer.concat(chunks).toString()));res.writeHead(204).end();return;}
   if(url.pathname==='/__bench/status'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({backend:opts.backend,dir,connected,pids:stack.pids(),test:!!opts.test,comparisonEligible:false}));return;}
   if(url.pathname.startsWith('/v1/')){
    if(opts.backend==='fieldnote'){const proxy=httpRequest({hostname:'127.0.0.1',port:stack.nativePort,path:req.url,method:req.method,headers:req.headers},up=>{res.writeHead(up.statusCode??502,up.headers);up.pipe(res);});proxy.on('error',e=>{res.writeHead(502).end(String(e));});req.pipe(proxy);return;}
    if(!content){res.writeHead(503).end('Session is initializing');return;}if(content(req,res))return;
   }
   let pathname=decodeURIComponent(url.pathname);let file=resolve(app,'.'+pathname);
   if(!file.startsWith(app+sep)&&file!==app){res.writeHead(403).end();return;}
   if(pathname==='/'||pathname.startsWith('/brief/'))file=resolve(app,'index.html');
   try{if(!(await stat(file)).isFile())throw new Error('Not a file');}catch{res.writeHead(404).end('Not found');return;}
   res.setHeader('Content-Type',mime[extname(file)]??'application/octet-stream');res.end(await readFile(file));
  }catch(e){if(!res.headersSent)res.writeHead(400);res.end(String(e));}
 });
 const wss=new WebSocketServer({server,maxPayload:1024*1024});
 const clients=new Set<WebSocket>();
 wss.on('connection',async ws=>{
  clients.add(ws);ws.once('close',()=>clients.delete(ws));
  if(connected||closing){ws.close(1013,'Only one Fieldnote session can be active');return;}connected=true;activeWs=ws;
  if(!await ready || ws.readyState!==WebSocket.OPEN){connected=false;ws.close();return;}
  if(opts.backend==='fieldnote'){
   // One upstream connection for this actual browser. Raw frames are observed, never reduced or translated.
   const upstream=new WebSocket(`ws://127.0.0.1:${stack.nativePort}`);const pending:string[]=[];
   ws.on('message',data=>{const raw=data.toString();journal.emit('wire.command.raw',{raw});if(upstream.readyState===WebSocket.OPEN)upstream.send(raw);else pending.push(raw);});
   upstream.on('open',()=>pending.splice(0).forEach(raw=>upstream.send(raw)));
   upstream.on('message',data=>{journal.emit('wire.native.raw',{raw:data.toString()});if(ws.readyState===WebSocket.OPEN)ws.send(data.toString());});
   upstream.on('error',e=>{journal.emit('native.transport.failure',{error:String(e)});ws.close(1011,'Native host failed');});
   upstream.on('close',()=>ws.close());ws.once('close',()=>{upstream.close();connected=false;});return;
  }
  const sessionId=randomUUID();const frame=(t:string,payload?:any)=>{if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({sessionId,frame:{t,...(payload===undefined?{}:{payload})}}));};
  try{
   frame('session',{phase:'warming'});
   const ranker=opts.test?.ranker??new HttpReranker(`http://127.0.0.1:${stack.rankerPort}`,resolve(dir,'reranker-requests'),journal.emit);
   const model=opts.test?.model??new LocalChatModel(config,dir,journal.emit);
   const current=new FieldnoteSession(config,dataPath,model,ranker,journal.emit,event=>{const shown=opts.test&&event.type==='bench:capabilities'?{...event,backend:'TEST — scripted model; no inference measurements'}:event;journal.wire(shown);frame('event',shown);},corpusPath);session=current;
   content=createContentRoutes({store:current.evidence.store,ingest:(bytes,signal)=>current.evidence.ingest(bytes,signal),maxUploadBytes:MAX_DOCUMENT_BYTES,uploadTimeoutMs:DOCUMENT_UPLOAD_TIMEOUT_MS,allowedOrigin:origin});
   ws.on('message',data=>{try{const m=JSON.parse(data.toString());if(m.sessionId&&m.sessionId!==sessionId)throw new Error('Wrong session');if(m.frame?.t!=='command')throw new Error('Expected command frame');void current.dispatch(m.frame.payload);}catch(e){frame('event',{type:'ui:error',message:String(e)});}});
   ws.once('close',()=>{void current.close().finally(()=>{if(session===current){session=undefined;connected=false;}});});
   await current.initialize();if(ws.readyState!==WebSocket.OPEN){await current.close();connected=false;return;}frame('session',{phase:'live'});frame('ready');
  }catch(e){frame('event',{type:'ui:error',message:String(e)});frame('session',{phase:'died'});journal.emit('session.failure',{error:String(e)});await session?.close();session=undefined;connected=false;ws.close();}
 });
 const close=async()=>{if(closing)return;closing=true;shutdown.abort();await session?.close();for(const ws of clients)ws.close();await new Promise<void>(r=>wss.close(()=>r()));await new Promise<void>(r=>server.close(()=>r()));await stopObserving?.();await stack.stop();await journal.close();};
 try{
  await new Promise<void>((res,rej)=>{server.once('error',rej);server.listen(opts.port,'127.0.0.1',()=>{server.off('error',rej);res();});});
  if(!opts.test){await captureIdentity(config,dir);await stack.start(shutdown.signal,corpusPath,origin);if(opts.backend==='langgraph')await new HttpReranker(`http://127.0.0.1:${stack.rankerPort}`,resolve(dir,'reranker-requests'),journal.emit).verify(shutdown.signal);}
  if(!opts.test)stopObserving=observeResources(()=>stack.pids(),journal.emit);
  settleReady(true);
 }catch(e){settleReady(false);await close();throw e;}
 return {server,close,dir,url:`${origin}/?server=${encodeURIComponent(`ws://127.0.0.1:${opts.port}`)}&backend=${opts.backend}`,journal};
}
