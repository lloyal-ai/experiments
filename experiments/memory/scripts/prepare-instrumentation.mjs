// Materialize the exact native sources and instrumentation used by the benchmark.
// Existing checkouts must match; never reset or overwrite a developer's checkout.
import { spawnSync } from 'node:child_process';
import { readFile, mkdir, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
const sources=JSON.parse(await readFile(resolve(root,'instrumentation/patches/sources.json'),'utf8'));
const repos=[
 ['lloyal-node','https://github.com/lloyal-ai/lloyal.node.git','instrumentation/lloyal-node'],
 ['liblloyal','https://github.com/lloyal-ai/liblloyal.git','instrumentation/lloyal-node/liblloyal'],
 ['llama.cpp','https://github.com/ggml-org/llama.cpp.git','instrumentation/lloyal-node/llama.cpp'],
];
function run(args,cwd=root){const p=spawnSync('git',args,{cwd,encoding:'utf8'});if(p.error||p.status)throw p.error??new Error(`git ${args.join(' ')}: ${p.stderr}`);return p.stdout.trim();}
for(const [name,url,relative] of repos){
 const dir=resolve(root,relative), pin=sources[name], patch=resolve(root,'instrumentation/patches',name+'.patch');
 const bytes=await readFile(patch);
 if(createHash('sha256').update(bytes).digest('hex')!==pin.patchSha256)throw new Error('Patch fingerprint mismatch: '+name);
 let exists=true;try{await access(resolve(dir,'.git'));}catch{exists=false;}
 if(!exists){await mkdir(dir,{recursive:true});run(['init'],dir);run(['remote','add','origin',url],dir);run(['fetch','--depth','1','origin',pin.head],dir);run(['checkout','--detach','FETCH_HEAD'],dir);}
 if(run(['rev-parse','HEAD'],dir)!==pin.head)throw new Error(`Unexpected ${name} checkout; move it aside explicitly before preparing pinned sources.`);
 if(bytes.length){
  const reverse=spawnSync('git',['apply','--reverse','--check',patch],{cwd:dir,encoding:'utf8'});
  if(reverse.status!==0){run(['apply','--check',patch],dir);run(['apply',patch],dir);}
 }
 console.log(`${name}: ${pin.head}, instrumentation verified`);
}
