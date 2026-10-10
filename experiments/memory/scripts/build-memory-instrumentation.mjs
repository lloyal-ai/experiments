// Rebuild the isolated sources. Never resets or changes the original repositories.
import { spawnSync } from 'node:child_process';
import { access, writeFile, readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root=fileURLToPath(new URL('..',import.meta.url));
const nodeRoot=resolve(root,'instrumentation/lloyal-node');
const run=(cmd,args,cwd=root)=>{const p=spawnSync(cmd,args,{cwd,stdio:'inherit'});if(p.error||p.status)throw p.error??new Error(cmd+' failed: '+p.status);};
for(const path of ['src/index.ts','llama.cpp/src/llama-bench-memory.cpp','liblloyal/CMakeLists.txt','node_modules/.bin/cmake-js'])await access(resolve(nodeRoot,path));
const headerVersion=process.env.LLOYAL_BENCH_NODE_HEADERS??'24.6.0';
const gpu=process.env.LLOYAL_GPU??(process.platform==='darwin'?'metal':'cuda');
if(!['metal','cuda'].includes(gpu))throw new Error('Instrumented comparisons require Metal or CUDA');
const jobs=process.env.LLOYAL_BENCH_BUILD_JOBS??'4';
const cudaArch=process.env.LLOYAL_BENCH_CUDA_ARCH;
if(gpu==='cuda'&&!cudaArch)throw new Error('Set LLOYAL_BENCH_CUDA_ARCH explicitly for both builds');
let md4c=process.env.LLOYAL_BENCH_MD4C;
if(md4c)await access(md4c);
const common=[`GGML_METAL=${gpu==='metal'?'ON':'OFF'}`,`GGML_CUDA=${gpu==='cuda'?'ON':'OFF'}`,'LLAMA_OPENSSL=OFF',
 ...(gpu==='cuda'?[`CMAKE_CUDA_ARCHITECTURES=${cudaArch}`,'GGML_NATIVE=OFF','GGML_AVX2=ON']:[])];
const configure=['configure','--runtime-version',headerVersion,...common.map(s=>'--CD'+s),...(md4c?['--CDFETCHCONTENT_SOURCE_DIR_MD4C='+md4c]:[])];
run('npm',['run','build:ts'],nodeRoot);
run(resolve(nodeRoot,'node_modules/.bin/cmake-js'),configure,nodeRoot);
run('cmake',['--build',resolve(nodeRoot,'build'),'--target','lloyal.node','-j'+jobs]);
const serverArgs=['-S',resolve(nodeRoot,'llama.cpp'),'-B',resolve(root,'instrumentation/llama-server-build'),'-G','Ninja','-DCMAKE_BUILD_TYPE=Release',...common.map(s=>'-D'+s),'-DLLAMA_BUILD_TESTS=OFF','-DLLAMA_BUILD_EXAMPLES=OFF','-DLLAMA_BUILD_SERVER=ON','-DLLAMA_CURL=OFF'];
run('cmake',serverArgs);run('cmake',['--build',resolve(root,'instrumentation/llama-server-build'),'--target','llama-server','-j'+jobs]);
run('python3',['scripts/export-memory-patches.py']);
const hash=async path=>{const h=createHash('sha256');for await(const b of createReadStream(path))h.update(b);return h.digest('hex');};
const files={};for(const folder of ['instrumentation/lloyal-node/build/Release','instrumentation/llama-server-build/bin'])for(const name of await readdir(resolve(root,folder)))if(/(?:\.node|\.dylib|\.so(?:\.\d+)*|^llama-server)$/.test(name)){const path=folder+'/'+name;files[path]=await hash(resolve(root,path));}
await writeFile(resolve(root,'instrumentation/build-receipt.json'),JSON.stringify({builtAt:new Date().toISOString(),node:process.version,platform:process.platform,arch:process.arch,gpu,cudaArch,napi:8,nodeHeaders:headerVersion,md4c:md4c??'CMake pinned release-0.5.2',configure,serverArgs,files,sources:JSON.parse(await readFile(resolve(root,'instrumentation/patches/sources.json'),'utf8'))},null,2));
console.log('Both instrumented builds recorded. Restart any host before using the new binaries.');
