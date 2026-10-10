import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Emit } from '../types.js';
const exec=promisify(execFile);
/** External process observations. Per-process RSS is never called unique physical or GPU memory. */
export function observeResources(pids:()=>number[],emit:Emit){
 let stopped=false,job:Promise<void>|undefined;
 const platformModule='../experiments/memory/platform.mjs';
 const platform=import(platformModule);
 const tick=()=>{if(stopped||job)return;job=(async()=>{
  const ids=[...new Set([process.pid,...pids()])],started=performance.now();
  try{
   const {gpuSnapshot,processMemory}=await platform;
   const [{stdout},gpu,hostMemory]=await Promise.all([
    exec('ps',['-p',ids.join(','),'-o','pid=,rss=,%cpu=']),gpuSnapshot(),Promise.all(ids.map(async pid=>({pid,memory:await processMemory(pid)})))]);
   const processes=stdout.trim().split('\n').filter(Boolean).map(line=>{const [pid,rss,cpu]=line.trim().split(/\s+/).map(Number);return {pid,rssBytes:rss*1024,cpuPct:cpu};});
   emit('resource.sample',{source:'ps',unixMs:Date.now(),processes,gpu,hostMemory,collectionMs:performance.now()-started,rssMeaning:'per-process resident bytes; shared pages can appear in multiple rows; not unique physical or GPU allocation',scope:'Application controller and owned model/reranker hosts. Browser and helper descendants are excluded.'});
  }catch(e){emit('resource.unavailable',{source:'ps / NVML / proc',error:String(e)});}
 })().finally(()=>{job=undefined;});};
 const timer=setInterval(tick,1000);tick();
 return async()=>{stopped=true;clearInterval(timer);await job;};
}
