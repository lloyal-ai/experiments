import { readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { serveFieldnote } from '../../host/server.ts';
import { ROOT, sleep } from '../../util.ts';
import { fileHash } from '../../measurement/identity.ts';
import { loadFixture, fixturePath } from '../../fixtures.ts';
const get=(args,name,fallback)=>{const i=args.indexOf('--'+name);return i<0?fallback:args[i+1];};
async function playwright(){
 try{return await import('playwright');}catch{}
 const path=process.env.PLAYWRIGHT_MODULE;
 if(!path)throw new Error('Install Playwright with npm install --prefix setup/browser playwright@1.62.1, install its Chromium browser, and set PLAYWRIGHT_MODULE to that package directory.');
 return createRequire(import.meta.url)(path);
}
export async function composedCommand(args,base){
 const output=resolve(get(args,'output',resolve(ROOT,'comparisons','memory-composed-'+new Date().toISOString().replaceAll(':','-'))));
 await mkdir(output,{recursive:false});
 const originalFixture=JSON.parse(await readFile(resolve(ROOT,'fixtures/generated/manifest.json'),'utf8'));
 const fixture=await loadFixture();
 const prior=JSON.parse(await readFile(resolve(ROOT,'validation/deliberation-repeat-2026-10-09.json'),'utf8')).procedure;
 prior.attachments=prior.attachments.map(path=>fixturePath(path,originalFixture.root,fixture.root));
 const config={...base,memoryInstrumentation:true,fieldnoteRoot:resolve(ROOT,'work/fieldnote-instrumented'),serverBinary:resolve(ROOT,'instrumentation/llama-server-build/bin/llama-server')};
 const question=prior.question+'\n\nUse exactly these four independent inquiries. Assign the stated protocol to each inquiry:\n'+prior.reviewedObjectives.map((t,i)=>`${i+1}. ${i===2?'document_research':'corpus_research'}: ${t.description}`).join('\n');
 const protocol={kind:'composed-Fieldnote-UI',requestRevision:2,plannerTransport:'LangGraph response_format json_schema; native PlanTool schema',reviewTimeoutMs:config.timeoutMs,originalQuery:prior.question,reason:'Make the required three corpus and one document routes explicit through the ordinary user request; preserve failed earlier routing attempts.',createdAt:new Date().toISOString(),query:question,attachments:prior.attachments,objectives:prior.reviewedObjectives,effort:'medium',followup:fixture.journeys.J1.followup,config,freshCoverage:true,driver:'Playwright; ordinary UI actions only; one WebSocket client',quality:'unreviewed',comparisonEligible:false};
 protocol.attachmentHashes=Object.fromEntries(await Promise.all(protocol.attachments.map(async p=>[p,await fileHash(p)])));
 protocol.hostSourceHashes=Object.fromEntries(await Promise.all(['src/evidence.ts','src/graph/model.ts','src/graph/workflow.ts','src/runtime/stack.ts','src/experiments/memory/composed.mjs'].map(async p=>[p,await fileHash(resolve(ROOT,p))])));
 await writeFile(resolve(output,'protocol.json'),JSON.stringify(protocol,null,2));
 await cp(resolve(ROOT,'src'),resolve(output,'execution-source/src'),{recursive:true});
 await cp(resolve(ROOT,'package-lock.json'),resolve(output,'execution-source/package-lock.json'));
 const {chromium}=await playwright();
 const requested=get(args,'backend','both'),backends=requested==='both'?['fieldnote','langgraph']:[requested];
 if(backends.some(b=>!['fieldnote','langgraph'].includes(b)))throw new Error('Use --backend fieldnote|langgraph|both');
 for(const backend of backends){
  const dir=resolve(output,backend);await mkdir(dir);
  let host,browser,page;const frames=[],errors=[];let status={status:'failed'};
  const onSignal=()=>{void (async()=>{await browser?.close();await host?.close();await writeFile(resolve(dir,'driver-status.json'),JSON.stringify({status:'interrupted',unixMs:Date.now()}));process.exit(130);})();};
  process.once('SIGINT',onSignal);process.once('SIGTERM',onSignal);
  const observation=e=>appendFileSync(resolve(dir,'browser.jsonl'),JSON.stringify({unixMs:Date.now(),...e})+'\n');
  const waitEvent=async(predicate,after=0,ms=1200000)=>{const deadline=Date.now()+ms;while(Date.now()<deadline){const found=frames.slice(after).find(x=>predicate(x.event));if(found)return found.event;await sleep(100);}throw new Error('Timed out waiting for application event');};
  try{
   console.log('Starting composed '+backend);
   host=await serveFieldnote(config,{backend,port:Number(get(args,'port','8100')),corpusPath:resolve(fixture.root,'corpus'),dir});
   const browserChannel=get(args,'browser-channel','chrome');
   browser=await chromium.launch({...(browserChannel==='chromium'?{}:{channel:browserChannel}),headless:!args.includes('--headed')});
   observation({type:'browser.identity',version:browser.version(),channel:browserChannel});
   const context=await browser.newContext({viewport:{width:1440,height:1000}});page=await context.newPage();
   page.on('pageerror',e=>{errors.push(String(e));observation({type:'page.error',error:String(e)});});
   page.on('websocket',socket=>{
    observation({type:'socket.open',url:socket.url()});
    socket.on('framereceived',({payload})=>{try{const raw=JSON.parse(String(payload));const event=raw.frame?.t==='event'?raw.frame.payload:null;if(event)frames.push({unixMs:Date.now(),event});observation({type:'frame.received',raw});}catch{observation({type:'frame.invalid',raw:String(payload)});}});
    socket.on('framesent',({payload})=>observation({type:'frame.sent',raw:String(payload)}));
   });
   await page.goto(host.url);
   await page.getByRole('heading',{name:'What should we look into?'}).waitFor({timeout:180000});
   await page.getByText('Ready',{exact:true}).waitFor({timeout:180000});
   await page.getByRole('button',{name:'Survey independent lenses, side by side',exact:true}).click();
   await page.getByRole('radio',{name:/^Standard/}).click();
   // Source chips expose ordinary participation state. No direct harness commands.
   for(const [name,on] of [['corpus',true],['documents',true],['web',false]]){
    const chip=page.getByRole('button',{name:new RegExp('^'+name+'(?: ·.*)?$')});const pressed=await chip.getAttribute('aria-pressed');
    if(pressed!==null&&(pressed==='true')!==on)await chip.click();
    if(on&&pressed===null)throw new Error(name+' is not configured');
   }
   await page.locator('input[type=file]').setInputFiles(protocol.attachments);
   await page.getByRole('button',{name:'Send',exact:true}).waitFor();
   const composer=page.getByPlaceholder('Ask a question worth a brief…');
   await composer.fill(protocol.query,{timeout:120000});
   // Install the review watcher before submitting; the UI auto-starts after five seconds.
   const editReady=page.getByTitle('Rewrite this line').first().waitFor({timeout:config.timeoutMs}).then(()=>page.getByTitle('Rewrite this line').first().click());
   // Retain the rejection until awaited below, even if sending fails first.
   void editReady.catch(()=>{});
   await page.getByRole('button',{name:'Send',exact:true}).click();
   await editReady;
   const plan=[...frames].reverse().find(x=>x.event.type==='plan')?.event;
   if(!plan)throw new Error('No reviewed plan event');
   const corpus=plan.tasks.filter(t=>t.ability==='corpus_research'),documents=plan.tasks.filter(t=>t.ability==='document_research');
   // Editing a description preserves the planner's routing. Never hide a routing mismatch.
   if(corpus.length!==3||documents.length!==1||plan.tasks.length!==4)throw new Error('Planner routing does not admit the frozen four-objective UI fixture: '+JSON.stringify(plan.tasks));
   const corpusObjectives=[protocol.objectives[0],protocol.objectives[1],protocol.objectives[3]];let ci=0;
   const assignments=plan.tasks.map(t=>t.ability==='document_research'?protocol.objectives[2]:corpusObjectives[ci++]);
   for(let i=0;i<4;i++){
    if(i>0)await page.getByTitle('Rewrite this line').nth(i).click();
    const input=page.locator('input:not([placeholder]):not([type=file])').filter({visible:true});
    await input.fill(assignments[i].description);await input.press('Enter');
    await waitEvent(e=>e.type==='plan'&&e.tasks[i]?.description===assignments[i].description);
   }
   const reviewed=[...frames].reverse().find(x=>x.event.type==='plan')?.event;
   await writeFile(resolve(dir,'reviewed-plan.json'),JSON.stringify(reviewed,null,2));
   await page.getByRole('button',{name:'Start now',exact:true}).click();
   const completion=await waitEvent(e=>e.type==='complete');
   const answer=[...frames].reverse().find(x=>x.event.type==='answer')?.event.text;
   if(!answer)throw new Error('Completed without an answer');
   await writeFile(resolve(dir,'answer.md'),answer);await page.screenshot({path:resolve(dir,'settled.png'),fullPage:true});
   if(!frames.some(x=>x.event.type==='preflight:done')||!frames.some(x=>x.event.type==='synthesize:done'))throw new Error('Missing preflight or synthesis stage');
   const at=frames.length;
   await page.getByPlaceholder(/^Ask about this brief/).fill(protocol.followup);
   await page.getByRole('button',{name:'Send',exact:true}).click();
   await waitEvent(e=>e.type==='complete',at);
   await page.screenshot({path:resolve(dir,'followup.png'),fullPage:true});
   await writeFile(resolve(dir,'visible.txt'),await page.locator('body').innerText());
   status={status:'complete',completion,quality:'unreviewed',comparisonEligible:false,errors};
  }catch(error){status={status:'failed',error:String(error),errors};if(page)await page.screenshot({path:resolve(dir,'failure.png'),fullPage:true}).catch(()=>{});console.error(status.error);}
  finally{process.removeListener('SIGINT',onSignal);process.removeListener('SIGTERM',onSignal);await browser?.close();await host?.close();await writeFile(resolve(dir,'driver-status.json'),JSON.stringify(status,null,2));}
  console.log('Composed '+backend+': '+status.status);
  if(status.status!=='complete')throw new Error('Composed workload did not pass: '+dir);
 }
 console.log('Composed evidence: '+output);
}
