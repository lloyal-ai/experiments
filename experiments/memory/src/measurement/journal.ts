import { createWriteStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Emit } from '../types.js';
export class Journal {
 private at=performance.now();private seq=0;private file;
 constructor(readonly dir:string){this.file=createWriteStream(resolve(dir,'observations.jsonl'));this.emit('clock.anchor',{unixMs:Date.now(),performanceMs:performance.now(),pid:process.pid});}
 emit:Emit=(type,data={},inquiry)=>{const event={seq:++this.seq,t_ms:performance.now()-this.at,type,data,inquiry,stage:'interactive'};this.file.write(JSON.stringify(event)+'\n');return event;};
 wire=(payload:any)=>this.emit('wire.event',payload);
 async close(){await new Promise<void>((resolve,reject)=>{this.file.once('error',reject);this.file.end(resolve);});}
}
