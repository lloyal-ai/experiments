import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {readdir,readFile,stat,writeFile} from 'node:fs/promises';
import {resolve,relative} from 'node:path';
import type {Config} from '../types.js';
import {ROOT} from '../util.js';
export async function fileHash(path:string){const hash=createHash('sha256');for await(const bytes of createReadStream(path))hash.update(bytes);return hash.digest('hex');}
export async function treeIdentity(root:string){const files:{path:string;sha256:string;bytes:number}[]=[];async function walk(dir:string){for(const entry of (await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const path=resolve(dir,entry.name);if(entry.isDirectory())await walk(path);else if(entry.isFile())files.push({path:relative(root,path),sha256:await fileHash(path),bytes:(await stat(path)).size});}}await walk(root);return {sha256:createHash('sha256').update(JSON.stringify(files)).digest('hex'),files};}
export async function captureIdentity(config:Config,dir:string){
 if(!['darwin','linux'].includes(process.platform))throw new Error('Native artifact identity is not configured for '+process.platform);
 const gpu=process.env.LLOYAL_GPU??(process.platform==='darwin'&&process.arch==='arm64'?'metal':'cpu');
 const suffix=gpu==='metal'||gpu==='cpu'?'':'-'+gpu;
 const nativeDirectory=config.memoryInstrumentation?resolve(ROOT,'instrumentation/lloyal-node/build/Release'):resolve(config.fieldnoteRoot,`node_modules/@lloyal-labs/lloyal.node-${process.platform}-${process.arch}${suffix}/bin`);
 const files={model:config.model,projector:config.projector,reranker:config.reranker,server:config.serverBinary,lockfile:resolve(ROOT,'package-lock.json'),nativeEntry:resolve(config.fieldnoteRoot,'dist/targets/web/serve.mjs'),nativeAddon:resolve(nativeDirectory,'lloyal.node'),nativeLlama:resolve(nativeDirectory,process.platform==='linux'?'libllama.so.0':'libllama.0.dylib')};
 const hashes:Record<string,unknown>={};for(const [name,path] of Object.entries(files)){const meta=await stat(path);hashes[name]={path,bytes:meta.size,sha256:await fileHash(path)};}
 const identity={artifactMeaning:'Configured candidate artifacts. Instrumented native execution is independently attested by native-loaded-identity.jsonl from the host process.',memoryInstrumentation:!!config.memoryInstrumentation,node:process.version,platform:process.platform,arch:process.arch,files:hashes,host:await treeIdentity(resolve(ROOT,'src')),frontend:await treeIdentity(resolve(ROOT,'work/fieldnote-app/dist-web')),baseline:JSON.parse(await readFile(resolve(ROOT,'reference/fieldnote-app.snapshot.json'),'utf8')).sourceDigest};
 await writeFile(resolve(dir,'identity.json'),JSON.stringify(identity,null,2)+'\n');return identity;
}
