import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { Agent, fetch } from 'undici';

test('matching transport survives an earlier header limit but still honors explicit cancellation',async()=>{
 const path='../src/experiments/memory/http-transport.mjs';
 const {benchmarkTransport}=await import(path);
 const server=createServer((_,res)=>setTimeout(()=>res.end('ok'),1500));
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const address=server.address();assert.ok(address&&typeof address!=='string');
 const url=`http://127.0.0.1:${address.port}`;
 const short=new Agent({headersTimeout:100,bodyTimeout:100});const long=benchmarkTransport(4000);
 try{
  await assert.rejects(fetch(url,{dispatcher:short}), (e:any)=>e.cause?.code==='UND_ERR_HEADERS_TIMEOUT');
  assert.equal(await (await long.fetch(url)).text(),'ok');
  await assert.rejects(long.fetch(url,{signal:AbortSignal.timeout(50)}));
 }finally{await short.destroy();await long.close();server.closeAllConnections();server.close();}
});
