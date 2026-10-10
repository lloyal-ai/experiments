import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec=promisify(execFile);
const unavailable=e=>({unavailable:String(e)});
const command=async(name,args=[])=>{try{return (await exec(name,args,{timeout:5000,maxBuffer:2**20})).stdout;}catch(e){return unavailable(e);}};
const file=async path=>{try{return await readFile(path,'utf8');}catch(e){return unavailable(e);}};
const number=s=>s?.trim()!==''&&Number.isFinite(Number(s))?Number(s):null;
export function parseGpuSnapshot(devices,processes){
 const rows=s=>typeof s==='string'?s.trim().split('\n').filter(Boolean).map(l=>l.split(',').map(v=>v.trim())):null;
 return {source:'nvidia-smi / NVML',devices:rows(devices)?.map(([uuid,total,used,utilization,temperature,power,clock])=>({uuid,totalMiB:number(total),usedMiB:number(used),utilizationPct:number(utilization),temperatureC:number(temperature),powerW:number(power),smClockMHz:number(clock)}))??null,
  processes:rows(processes)?.map(([gpuUuid,pid,used])=>({gpuUuid,pid:number(pid),usedMiB:number(used)}))??null,
  ...(typeof devices!=='string'?{deviceError:devices}:{}),...(typeof processes!=='string'?{processError:processes}:{})};
}
export async function gpuSnapshot(){
 if(process.platform!=='linux')return null;
 const [devices,processes]=await Promise.all([
  command('nvidia-smi',['--query-gpu=uuid,memory.total,memory.used,utilization.gpu,temperature.gpu,power.draw,clocks.sm','--format=csv,noheader,nounits']),
  command('nvidia-smi',['--query-compute-apps=gpu_uuid,pid,used_gpu_memory','--format=csv,noheader,nounits'])]);
 return parseGpuSnapshot(devices,processes);
}
export function parseSmaps(raw){
 if(typeof raw!=='string')return {unavailable:raw};
 const fields=Object.fromEntries([...raw.matchAll(/^(Rss|Pss|Private_Clean|Private_Dirty|Swap|SwapPss):\s+(\d+) kB$/gm)].map(m=>[m[1],Number(m[2])*1024]));
 return {source:'/proc/PID/smaps_rollup',rssBytes:fields.Rss??null,pssBytes:fields.Pss??null,privateBytes:fields.Private_Clean===undefined||fields.Private_Dirty===undefined?null:fields.Private_Clean+fields.Private_Dirty,swapBytes:fields.Swap??null,swapPssBytes:fields.SwapPss??null};
}
export async function processMemory(pid){return process.platform==='linux'?parseSmaps(await file(`/proc/${pid}/smaps_rollup`)):null;}
export async function systemSnapshot(){
 const out={unixMs:Date.now(),platform:process.platform};
 if(process.platform==='linux'){
  const [memory,vmstat,swap,gpu,driver]=await Promise.all([file('/proc/meminfo'),file('/proc/vmstat'),file('/proc/swaps'),gpuSnapshot(),command('nvidia-smi',['-q'])]);
  return {...out,memory,vmstat,swap,gpu,driver};
 }
 for(const [key,[name,args]] of Object.entries({memory:['vm_stat',[]],swap:['sysctl',['vm.swapusage']],power:['pmset',['-g','batt']],thermal:['pmset',['-g','therm']]}))out[key]=await command(name,args);
 return out;
}
