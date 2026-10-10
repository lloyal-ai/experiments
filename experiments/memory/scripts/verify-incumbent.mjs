import {build} from 'esbuild';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
const root=new URL('../',import.meta.url).pathname;
const result=await build({entryPoints:[resolve(root,'src/host/server.ts')],bundle:true,write:false,metafile:true,platform:'node',format:'esm',logLevel:'silent',external:['sharp','@embedpdf/pdfium']});
const inputs=Object.keys(result.metafile.inputs);
const forbidden=inputs.filter(p=>/node_modules\/(?:effection\/|@lloyal-labs\/(?:lloyal-agents|lloyal\.node|[^/]+-ability)\/)/.test(p));
if(forbidden.length)throw new Error('Incumbent imported execution packages: '+forbidden.join(', '));
const pairs=[['content/bm25.ts','bm25.js'],['content/ranges.ts','ranges.js'],['content/fit.ts','resources/fit.js'],['content/documents.ts','resources/documents.js'],['content/files.ts','resources/files.js']];
const helpers=[];
for(const [local,leaf] of pairs){const from=`reference/fieldnote-app/node_modules/@lloyal-labs/rig/dist/${leaf}`,to=`src/${local}`;helpers.push({from,to,sourceSha256:createHash('sha256').update(await readFile(resolve(root,from))).digest('hex'),adaptedSha256:createHash('sha256').update(await readFile(resolve(root,to))).digest('hex'),adaptation:local.endsWith('files.ts')?'CommonJS/TypeScript import adaptation; marked replaces the native Markdown parser. Structural conformance cases in test/portable.test.ts.':'TypeScript source extraction; no orchestration or inference imports.'});}
const record={entry:'src/host/server.ts',checkedAt:new Date().toISOString(),forbiddenInputs:forbidden,inputs,externalContentPackages:['sharp','@embedpdf/pdfium'],helpers};
await writeFile(resolve(root,'reference/incumbent-boundary.json'),JSON.stringify(record,null,2)+'\n');console.log('Incumbent dependency boundary verified; '+inputs.length+' build inputs; no native inference, Effection or ability factories.');
