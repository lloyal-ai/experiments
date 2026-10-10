import { createServer, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { createReadStream } from 'node:fs';
import { BenchRun, savedRuns } from './runner.js';
import { ROOT, errorText } from './util.js';
import type { Config, Fixture } from './types.js';
import { requireMatchedWorkload } from './workload-review.js';

export async function serve(config:Config,fixture:Fixture,port:number) {
  let active:BenchRun|undefined;
  const clients=new Set<ServerResponse>();
  const send=(type:string,data:any)=>{for(const client of clients)client.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);};
  const snapshot=()=>active?{id:active.id,status:active.status,options:active.options,view:active.view,answers:{brief:active.log.events.find(e=>e.type==='answer'&&e.stage==='brief')?.data.text,followup:active.log.events.find(e=>e.type==='answer'&&e.stage==='followup')?.data.text},plan:[...active.log.events].reverse().find(e=>e.type==='plan.review')?.data.tasks,planAccepted:active.log.events.some(e=>e.type==='plan.accepted'),result:active.result,events:active.log.events.filter(e=>!['diagnostic.sample','native.turn','context.sample','server.metrics'].includes(e.type)).slice(-400)}:null;
  const server=createServer(async(req,res)=>{
    const url=new URL(req.url??'/',`http://127.0.0.1:${port}`);
    const json=(data:any,status=200)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data));};
    const file=async(path:string)=>{const info=await stat(path);const mime:Record<string,string>={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.png':'image/png','.pdf':'application/pdf','.json':'application/json','.md':'text/plain'};res.writeHead(200,{'content-type':mime[extname(path)]??'application/octet-stream','content-length':info.size,'cache-control':'no-store','x-content-type-options':'nosniff'});createReadStream(path).pipe(res);};
    try {
      if(req.method==='POST') {
        if(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`)return json({error:'Cross-origin controls are disabled'},403);
        let body='';for await(const chunk of req){body+=chunk;if(body.length>100000)throw new Error('Request too large');}
        const data=JSON.parse(body||'{}');
        if(url.pathname==='/api/run') {
          requireMatchedWorkload();
          if(active&&!['finished','failed'].includes(active.status))throw new Error('Finish the current run before loading another backend');
          if(!['fieldnote','langgraph'].includes(data.adapter)||!['J1','J1-investigate','J2'].includes(data.journey))throw new Error('Invalid backend or journey');
          active=new BenchRun(config,fixture,{adapter:data.adapter,journey:data.journey,control:data.control==='uninterrupted'?'uninterrupted':'interactive',automatic:data.automatic!==false,browser:true});
          active.log.on(e=>{if(!['diagnostic.sample','native.turn','server.metrics'].includes(e.type)&&!e.type.startsWith('ui.'))send('event',e);if(e.type==='ui.inspect_requested')send('event',e);});
          json({id:active.id});send('reset',snapshot());
          void active.start().finally(()=>send('snapshot',snapshot()));return;
        }
        if(!active)throw new Error('No active run');
        if(url.pathname==='/api/control'){await active.control(data.action,data);return json({ok:true});}
        if(url.pathname==='/api/stop'){await active.stop();send('snapshot',snapshot());return json({ok:true});}
        if(url.pathname==='/api/ack'){active.acknowledge(data.type,data.data);return json({ok:true});}
        throw new Error('Unknown endpoint');
      }
      if(url.pathname==='/api/events') {
        res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache',connection:'keep-alive'});res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot())}\n\n`);clients.add(res);req.on('close',()=>clients.delete(res));return;
      }
      if(url.pathname==='/api/state')return json(snapshot());
      if(url.pathname==='/api/fixtures')return json({cpuDiagnostic:!!config.cpuDiagnostic,journeys:fixture.journeys,files:{pdf:'harbor-pilot.pdf',image:'site-map.png'}});
      if(url.pathname==='/api/runs')return json(await savedRuns());
      if(url.pathname==='/api/receipt') {if(!active?.adapter)throw new Error('No adapter');const receipt=await active.adapter.inspect(url.searchParams.get('id')??'');return json(receipt);}
      if(url.pathname==='/api/asset') {if(!active?.adapter)throw new Error('No adapter');const receipt=await active.adapter.inspect(url.searchParams.get('id')??'');if(receipt.kind==='text')return json(receipt);if(!receipt.path)throw new Error('No asset');return await file(receipt.path);}
      if(url.pathname==='/api/original')return await file(fixture.pdf);
      if(url.pathname==='/api/report') {const id=url.searchParams.get('id')??'';if(!/^[-\w]+$/.test(id))throw new Error('Invalid run ID');return await file(resolve(ROOT,'runs',id,'report.html'));}
      const files:Record<string,string>={'/':'index.html','/app.js':'app.js','/style.css':'style.css'};
      if(url.pathname==='/vendor/marked.js')return await file(resolve(ROOT,'node_modules/marked/lib/marked.esm.js'));
      if(url.pathname==='/vendor/purify.js')return await file(resolve(ROOT,'node_modules/dompurify/dist/purify.es.mjs'));
      if(files[url.pathname])return await file(resolve(ROOT,'web',files[url.pathname]));
      json({error:'Not found'},404);
    }catch(e){if(!res.headersSent)json({error:errorText(e)},400);else res.end();}
  });
  await new Promise<void>((res,rej)=>{server.once('error',rej);server.listen(port,'127.0.0.1',res);});
  const pulse=setInterval(()=>{for(const client of clients)client.write(': keepalive\n\n');},10000);pulse.unref();
  const stop=async()=>{clearInterval(pulse);await active?.stop();for(const client of clients)client.end();server.close();};
  process.once('SIGINT',()=>void stop());process.once('SIGTERM',()=>void stop());
  console.log(`Lloyal bench: http://127.0.0.1:${port}`);
}
