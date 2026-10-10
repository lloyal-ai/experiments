import { readFileSync, writeFileSync, mkdirSync, cpSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
const root = new URL('../', import.meta.url).pathname;
const records = [];
const helpers = [];
const copy = (from, to) => { const bytes=readFileSync(resolve(root,from)); mkdirSync(dirname(resolve(root,to)),{recursive:true});writeFileSync(resolve(root,to),bytes);records.push({from,to,sha256:createHash('sha256').update(bytes).digest('hex')}); };
const base='reference/fieldnote-app/node_modules/@lloyal-labs';
// Direct, dependency-reviewed leaf modules. No rig/agents package barrel is executed by the incumbent.
for(const file of ['content-routes','tools/weave-sources']) {
 const name=file.split('/').at(-1);
 copy(`${base}/rig/dist/${file}.js`,`reference/portable/${name}.cjs`);
 copy(`${base}/rig/dist/${file}.d.ts`,`reference/portable/${name}.d.cts`);
}
for(const name of ['corpus','documents']) {
 const manifest=JSON.parse(readFileSync(`${root}${base}/${name}-ability/package.json`));
 for(const file of ['ability.json','skill.eta']) copy(`${base}/${name}-ability/${file}`,`reference/abilities/${name}/${file}`);
 records.push({package:manifest.name,version:manifest.version});
}
writeFileSync(resolve(root,'reference/portable/manifest.json'),JSON.stringify({source:'pinned Fieldnote installed packages',records},null,2)+'\n');
const { createRequire } = await import('node:module');
const parser=createRequire(resolve(root,'reference/fieldnote-app/package.json'))('@babel/parser'),vm=await import('node:vm');
const schemas=[];
for(const [pkg,files] of [['corpus',['grep','read-file','search']],['documents',['search-documents','read-document','view-page']]]) for(const file of files){
 const from=`${base}/${pkg}-ability/dist/tools/${file}.js`;
 const code=readFileSync(resolve(root,from),'utf8'), ast=parser.parse(code);
 const cls=ast.program.body.find(n=>n.type==='ClassDeclaration');
 const props={};for(const name of ['name','description','parameters']){const field=cls.body.body.find(m=>m.key?.name===name&&m.value);if(field)props[name]=vm.runInNewContext('('+code.slice(field.value.start,field.value.end)+')',{}, {timeout:100});}
 if(!props.parameters){const ctor=cls.body.body.find(n=>n.kind==='constructor');let expr;function visit(n){if(!n||typeof n!=='object')return;if(n.type==='AssignmentExpression'&&code.slice(n.left.start,n.left.end)==='this.parameters')expr=code.slice(n.right.start,n.right.end);for(const [k,v] of Object.entries(n))if(k!=='loc')if(Array.isArray(v))v.forEach(visit);else if(v&&typeof v==='object')visit(v);}visit(ctor);if(expr)props.parameters=vm.runInNewContext('('+expr+')',{resources:[],chunks:[]},{timeout:100});}
 if(!props.name||!props.parameters)throw new Error('No declarative schema: '+from);
 schemas.push({type:'function',function:props});records.push({from,extracted:'declarative name/description/parameters only',sha256:createHash('sha256').update(code).digest('hex')});
}
for(const pkg of ['rig','corpus-ability','documents-ability','media'])for(const name of ['LICENSE','LICENSE-FAQ.md'])copy(`${base}/${pkg}/${name}`,`reference/licenses/${pkg}/${name}`);
writeFileSync(resolve(root,'reference/portable/tool-schemas.json'),JSON.stringify(schemas,null,2)+'\n');
writeFileSync(resolve(root,'reference/portable/manifest.json'),JSON.stringify({source:'pinned Fieldnote installed packages',records},null,2)+'\n');
