import { mkdir, readFile, readdir, writeFile, rename, rm } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AIMessage, HumanMessage, type BaseMessage } from '@langchain/core/messages';
import type { Ask, Finding } from '../graph/contracts.js';
export interface BriefRecord { version:1;query:string;savedAt:string;mode:'flat'|'deep';effort:Ask['effort'];direct:boolean;attachments:string[];answer:string;inquiries:{task:string;findings:string}[];elapsedMs:number }
export interface SavedThread { docId:string;record:BriefRecord;exchanges:BriefRecord[] }
export class Library {
 constructor(readonly root:string){}
 path(id:string){if(!/^[\w.:-]+$/.test(id))throw new Error('Invalid brief identity');return resolve(this.root,id);}
 async reserve(){const id=new Date().toISOString().replaceAll(':','-')+'-'+randomUUID();await mkdir(this.path(id),{recursive:true});return id;}
 async read(id:string):Promise<SavedThread|null>{try{const dir=this.path(id),record=JSON.parse(await readFile(resolve(dir,'report.json'),'utf8'));if(record.version!==1||typeof record.answer!=='string')throw new Error('Unsupported brief record');const names=(await readdir(dir)).filter(n=>/^exchange-\d+\.json$/.test(n)).sort((a,b)=>Number(a.match(/\d+/)![0])-Number(b.match(/\d+/)![0]));return {docId:id,record,exchanges:await Promise.all(names.map(async n=>JSON.parse(await readFile(resolve(dir,n),'utf8'))))};}catch(e:any){if(e.code==='ENOENT')return null;throw e;}}
 async list(){await mkdir(this.root,{recursive:true});const out=[];for(const e of await readdir(this.root,{withFileTypes:true})){if(!e.isDirectory())continue;const thread=await this.read(e.name);if(!thread)continue;const r=thread.record;out.push({path:resolve(this.path(e.name),'report.json'),docId:e.name,title:r.query,savedAt:r.savedAt,mode:r.mode,effort:r.effort,direct:r.direct,hasMedia:!!r.attachments.length});}return out.sort((a,b)=>b.savedAt.localeCompare(a.savedAt));}
 async save(ask:Ask,answer:string,findings:Finding[],roots:string[],elapsedMs:number,signal?:AbortSignal){
  const dir=this.path(ask.docId);await mkdir(dir,{recursive:true});const existing=await this.read(ask.docId);const files=await readdir(dir);
  const ordinal=Math.max(0,...files.filter(f=>/^annexure-\d+\.md$/.test(f)).map(f=>Number(f.match(/\d+/)![0])));
  const refs:string[]=[];
  for(const [i,f] of findings.entries()){if(!f.body.trim())continue;const name=`annexure-${ordinal+i+1}.md`;await writeFile(resolve(dir,name),`# Annexure ${ordinal+i+1}\n\n**Task:** ${f.task}\n\n---\n\n${f.body.trimEnd()}\n`,{flag:'wx'});refs.push(`- [Annexure ${ordinal+i+1}](./${name}) — ${f.task}`);}
  const r:BriefRecord={version:1,query:ask.text,savedAt:new Date().toISOString(),mode:ask.mode,effort:ask.effort,direct:ask.direct,attachments:[...new Set(roots)],answer,inquiries:findings.map(f=>({task:f.task,findings:f.body})),elapsedMs};
  const name=existing?`exchange-${existing.exchanges.length+1}`:'report';
  await writeFile(resolve(dir,name+'.md'),`# ${r.query}\n\n> ${r.savedAt} · ${r.mode} · ${r.effort}\n\n${answer}\n${refs.length?'\n## Annexures\n\n'+refs.join('\n')+'\n':''}`);
  const tmp=resolve(dir,name+'.json.tmp');await writeFile(tmp,JSON.stringify(r,null,2)+'\n');
  // The JSON record is the commit marker. Stop before commit leaves no visible brief/exchange.
  if(signal?.aborted){await rm(tmp,{force:true});await rm(resolve(dir,name+'.md'),{force:true});for(const [i] of findings.entries())await rm(resolve(dir,`annexure-${ordinal+i+1}.md`),{force:true});signal.throwIfAborted();}
  await rename(tmp,resolve(dir,name+'.json'));
 }
 async release(id:string){if(!await this.read(id))await rm(this.path(id),{recursive:true,force:true});}
 async delete(file:string){const entries=await this.list();const entry=entries.find(e=>e.path===file);if(!entry)throw new Error('Brief is not in this library');await rm(this.path(entry.docId),{recursive:true});return entry.docId;}
 history(thread:SavedThread|null):BaseMessage[]{return thread?[thread.record,...thread.exchanges].flatMap(r=>[new HumanMessage(r.query),new AIMessage(r.answer)]):[];}
 roots(thread:SavedThread|null){return thread?[...new Set([thread.record,...thread.exchanges].flatMap(r=>r.attachments))]:[];}
}
