import {readFile,writeFile,mkdir,access,appendFile} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,execFileSync} from 'node:child_process';
import {randomInt,createHash} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),memory=resolve(root,'../memory');
const args=process.argv.slice(2),get=(k,d)=>args.includes('--'+k)?args[args.indexOf('--'+k)+1]:d;
const output=resolve(get('output',resolve(root,'runs','suite-'+new Date().toISOString().replaceAll(':','-'))));
await mkdir(output,{recursive:false});
const protocol=JSON.parse(await readFile(resolve(root,'protocol.json'),'utf8'));
if(protocol.status!=='frozen')throw new Error('Pilot acceptance must freeze the protocol before measured runs');
const order=[...protocol.arms];for(let i=order.length-1;i>0;i--){const j=randomInt(i+1);[order[i],order[j]]=[order[j],order[i]];}
const schedule=protocol.seedOffsets.flatMap((seed,r)=>order.map((_,i)=>({replicate:r+1,seed,arm:order[(i+r)%order.length]})));
const sha=b=>createHash('sha256').update(b).digest('hex');
const record={createdAt:new Date().toISOString(),protocol,protocolSha256:sha(await readFile(resolve(root,'protocol.json'))),rubricSha256:sha(await readFile(resolve(root,'quality-rubric.json'))),schedule,nativePatch:JSON.parse(await readFile(resolve(root,'work/native-patch.json'),'utf8'))};
await writeFile(resolve(output,'suite.json'),JSON.stringify(record,null,2));
await writeFile(resolve(output,'quality-rubric.json'),await readFile(resolve(root,'quality-rubric.json')));
let child;let interrupted=false;
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{interrupted=true;child?.kill(signal);});
for(const [i,entry] of schedule.entries()){
 if(interrupted)break;
 const id=String(i+1).padStart(2,'0')+'-'+entry.arm+'-r'+entry.replicate;
 const log=createWriteStream(resolve(output,id+'.log'));console.log('Starting '+id);
 child=spawn(process.execPath,['--import','tsx',resolve(root,'scripts/run.mjs'),'--arm',entry.arm,'--seed',String(entry.seed),'--output',resolve(output,id)],{cwd:memory,env:process.env,stdio:['ignore','pipe','pipe']});
 child.stdout.pipe(log);child.stderr.pipe(log);
 const result=await new Promise((res,rej)=>{child.once('error',rej);child.once('close',(code,signal)=>res({code,signal}));});log.end();
 await appendFile(resolve(output,'outcomes.jsonl'),JSON.stringify({id,...entry,...result,finishedAt:new Date().toISOString()})+'\n');console.log(id+': '+JSON.stringify(result));
}
await writeFile(resolve(output,'suite-status.json'),JSON.stringify({status:interrupted?'interrupted':'finished',finishedAt:new Date().toISOString()}));
