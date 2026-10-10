import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertPortFree } from './server.js';

/** Cross-process exclusion, not just a disabled button. Never clear an ambiguous live lease. */
export async function acquireModelLease(root:string,runId:string,ports:number[]):Promise<()=>Promise<void>> {
  const dir=resolve(root,'.cache');await mkdir(dir,{recursive:true});const path=resolve(dir,'model-lease.json');
  const token=randomUUID();
  for(let attempt=0;attempt<2;attempt++) {
    try {
      const file=await open(path,'wx');await file.writeFile(JSON.stringify({pid:process.pid,runId,token,createdAt:new Date().toISOString()}));await file.close();
      const release=async()=>{try{const current=JSON.parse(await readFile(path,'utf8'));if(current.token===token)await unlink(path);}catch(e:any){if(e.code!=='ENOENT')throw e;}};
      try{for(const port of ports)await assertPortFree(port);}catch(e){await release();throw new Error('A model backend is already listening. Shut it down before starting another run.');}
      return release;
    } catch(e:any) {
      if(e.code!=='EEXIST')throw e;
      const owner=JSON.parse(await readFile(path,'utf8'));
      let gone=false;try{process.kill(owner.pid,0);}catch(error:any){gone=error.code==='ESRCH';}
      if(!gone)throw new Error(`Another benchmark owns the model lease (${owner.runId}). Finish it before loading a backend.`);
      // A dead parent may have left an inference child: both listening ports must also be free.
      for(const port of ports)await assertPortFree(port);
      const current=JSON.parse(await readFile(path,'utf8'));if(current.token!==owner.token)throw new Error('Model lease changed; retry after the active run finishes');
      await unlink(path);
    }
  }
  throw new Error('Could not acquire the model lease');
}
