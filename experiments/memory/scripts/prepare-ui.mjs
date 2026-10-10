import { cpSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const root=new URL('../',import.meta.url).pathname,from=resolve(root,'reference/fieldnote-app'),app=resolve(root,'work/fieldnote-app');
if(!existsSync(app)){mkdirSync(resolve(root,'work'),{recursive:true});cpSync(from,app,{recursive:true});}
const patches=[];
function change(file,edit){const original=readFileSync(resolve(from,file),'utf8');const modified=edit(original);writeFileSync(resolve(app,file),modified);patches.push({file,original:hash(original),modified:hash(modified)});}
const hash=s=>createHash('sha256').update(s).digest('hex');
change('src/protocol.ts',s=>s.replace('export type WorkflowEvent = AgentEvent |',`export type HttpObservation =
  | { type: 'agent:ranking'; agentId: number; callId: string; tool: string; ranking: Record<string, unknown> }
  | { type: 'bench:capabilities'; backend: string; continuation: string; nativeTelemetry: boolean }
  | { type: 'agent:http_images'; agentId: number; attachments: Descriptor[]; requestId: string; evidence: 'submitted' }
  | { type: 'agent:report_delta' | 'agent:text_delta' | 'agent:reasoning_delta' | 'agent:plan_delta'; agentId: number; text: string }
  | { type: 'agent:usage'; agentId: number; tokenCount: number };
export type WorkflowEvent = HttpObservation | AgentEvent |`).replace("ppl: number; tokenCount", "ppl?: number; tokenCount"));
change('src/ui/state.ts',s=>s.replace('export interface SessionState {',"export interface SessionState {\n  backend?: { name: string; continuation: string; nativeTelemetry: boolean }; ").replace('ppl: number; timeMs:', 'ppl?: number; timeMs:'));
change('src/ui/reduce.ts',s=>s.replace("  'query': 'own'", "  'bench:capabilities': 'session',\n  'agent:ranking': 'ignored', 'agent:http_images': 'run', 'agent:report_delta': 'run', 'agent:text_delta': 'run', 'agent:reasoning_delta': 'run', 'agent:plan_delta': 'run', 'agent:usage': 'run',\n  'query': 'own'")
 .replace("    case 'config:loaded':", "    case 'bench:capabilities': return { ...s, backend: { name: ev.backend, continuation: ev.continuation, nativeTelemetry: ev.nativeTelemetry } };\n    case 'config:loaded':")
 .replace("    case 'agent:prefilled': {", "    case 'agent:http_images':\n    case 'agent:prefilled': {")
 .replace("    case 'agent:produce': {",`    case 'agent:usage': return replaceAgent(doc, ev.agentId, a => ({ ...a, tokenCount: ev.tokenCount }));
    case 'agent:plan_delta': return replaceAgent(doc, ev.agentId, a => ({ ...a, contentBuffer: ev.text }));
    case 'agent:report_delta': return replaceAgent(doc, ev.agentId, a => ({ ...a, httpProse: ev.text, phase: 'content' } as AgentRuntime));
    case 'agent:text_delta': return replaceAgent(doc, ev.agentId, a => ({ ...a, httpProse: ((a as any).httpProse ?? '') + ev.text, contentBuffer: a.contentBuffer + ev.text, phase: 'content' } as AgentRuntime));
    case 'agent:reasoning_delta': return replaceAgent(doc, ev.agentId, a => ({ ...a, timeline: (a.timeline ?? []).map(t => t.kind === 'think' && t.live ? { ...t, body: t.body + ev.text } : t) }));
    case 'agent:produce': {`));
change('src/ui/select/inquiry.ts',s=>s.replace('  const report = reports.field', "  if (typeof (a as any).httpProse === 'string') return (a as any).httpProse || null;\n  const report = reports.field"));
change('src/ui/App.tsx',s=>("import { useContentOrigin } from '@lloyal-labs/ui';\n" + s).replace('Ask about this brief — the context is still warm…','Ask about this brief…').replace('  const live = useProjection(selectLive);','  const live = useProjection(selectLive);\n  const backend = useProjection((s: AppState) => s.session.backend);\n  const hostOrigin = useContentOrigin();\n  const [hostBackend, setHostBackend] = useState<string | null>(null);\n  useEffect(() => { let active = true; fetch((hostOrigin ?? "") + "/__bench/status").then(r => r.ok ? r.json() : null).then(s => { if (active && s) setHostBackend(s.backend); }).catch(() => {}); return () => { active = false; }; }, [hostOrigin]);').replace('      <Shell',`      <div role="status" style={{ padding: '4px 16px', fontSize: 11, background: '#f2f2ef', color: '#555' }}>
        {backend ? backend.name + ' · ' + backend.continuation : hostBackend === 'fieldnote' ? 'Fieldnote / Lloyal (KV telemetry)' : hostBackend === 'langgraph' ? 'LangGraph + llama-server · Transcript resent over HTTP · connecting' : 'Backend not yet confirmed'}
      </div>
      <Shell`));
change('src/ui/parts/Figures.tsx',s=>s.replace('  const origin = useContentOrigin();', "  const origin = useContentOrigin();\n  const http = useProjection((s: import('../state.js').AppState) => s.session.backend?.nativeTelemetry === false);")
 .replace('pageFacts(meta, new Set(threadDigests));', "pageFacts(meta, new Set(threadDigests)).map(line => http ? line.replace('Viewed as images', 'Submitted as images') : line);")
 .replace('what the model was given', 'evidence attached or submitted')
 .replace('what the model saw','submitted representation')
 .replace('Attached image, as the model received it','Attached or submitted image representation'));
change('src/ui/moments/Write.tsx',s=>s.replace('<section key={s.index} style={S.section}>','<section key={s.index} data-bench-section={s.index} style={S.section}>'));
change('src/ui/parts/Prose.tsx',s=>s.replace('      <Markdown','      <div data-bench-prose><Markdown').replace('      />','      /></div>'));
change('node_modules/@lloyal-labs/ui/dist/fold.js',s=>s.replace("{ kind: 'tool_call', id, tool: ev.tool,", "{ kind: 'tool_call', id, transportCallId: ev.callId, tool: ev.tool,")
  .replace('callId: agent.pendingToolCallId,',"callId: typeof ev.callId === 'string' ? (agent.timeline.find(t => t.kind === 'tool_call' && t.transportCallId === ev.callId)?.id ?? null) : agent.pendingToolCallId,"));
// Identical, passive bridge observations; no second socket and no second reducer.
change('targets/web/web-bridge.ts',s=>s.replace('configuredWssUrl() ?? DEFAULT_WSS', "configuredWssUrl() ?? ((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV ? DEFAULT_WSS : (window.location.protocol === 'https:' ? 'wss://' : 'ws://') + window.location.host)"));
const bridgePath=resolve(app,'targets/web/web-bridge.ts');let bridge=readFileSync(bridgePath,'utf8');
bridge=bridge.replace('  });\n}',`  });
  const bridge = window.harness;
  let observations: unknown[] = [];
  const post = () => { if (!observations.length) return; const batch = observations; observations = []; navigator.sendBeacon('/__bench/browser', new Blob([JSON.stringify(batch)], { type: 'application/json' })); };
  const send = bridge.send.bind(bridge);
  bridge.send = command => { observations.push({ kind: 'command', at: performance.now(), command }); send(command); };
  let scheduled=false,lastSample=-Infinity,lastSignature='';
  bridge.onEvent(frame => {
    if (['query','plan','ui:plan_review','ui:clarify','research:start','agent:return','answer','complete','run:paused','run:resumed'].includes(frame.ev.type)) requestAnimationFrame(() => requestAnimationFrame(() => { observations.push({kind:'paint-observation', at:performance.now(), seq:frame.seq, type:frame.ev.type}); }));
    if(scheduled||performance.now()-lastSample<200)return;scheduled=true;
    requestAnimationFrame(()=>requestAnimationFrame(()=>{scheduled=false;lastSample=performance.now();const prose=[...document.querySelectorAll('[data-bench-prose]')].map(el=>({section:el.closest('[data-bench-section]')?.getAttribute('data-bench-section')??null,chars:el.textContent?.trim().length??0,rendered:(el as HTMLElement).offsetHeight>0}));const signature=JSON.stringify(prose);if(signature!==lastSignature){lastSignature=signature;observations.push({kind:'prose-render',at:lastSample,seq:frame.seq,visibility:document.visibilityState,prose});}}));
  });
  setInterval(post, 500);
  window.addEventListener('pagehide', post);
}`);writeFileSync(bridgePath,bridge);
patches.find(p=>p.file==='targets/web/web-bridge.ts').modified=hash(bridge);
change('node_modules/@lloyal-labs/dev-tools/dist/index.js',s=>s.replace('    m.eventCount++;', "    if(ev.type === 'bench:capabilities') m.nativeTelemetry = ev.nativeTelemetry;\n    m.eventCount++;").replace('if (instr && ev.type', 'if (m.nativeTelemetry !== false && instr && ev.type').replace("        case 'agent:produce': {", "        case 'agent:usage':\n        case 'agent:produce': {")
 .replace('                callId: null,','                callId: typeof ev.callId === \'string\' ? ev.callId : null,')
 .replace("x.agentId === agentId && x.tool === tool && x.settledAt === null", "x.agentId === agentId && x.tool === tool && x.settledAt === null && (typeof ev.callId !== 'string' || x.callId === ev.callId)")
 .replace("        case 'agent:trace': {", `        case 'agent:ranking': {
            const r = m.retrievals.find(x => x.callId === ev.callId && x.agentId === ev.agentId);
            if (r && ev.ranking) { r.admission = ev.ranking; r.explore = true; }
            return;
        }
        case 'agent:trace': {`));
change('node_modules/@lloyal-labs/dev-tools/dist/react.js',s=>s.replace("'pause — hold at the tick boundary; branches stay resident'","(m.nativeTelemetry === false ? 'pause — hold at the next asynchronous boundary; in-flight HTTP may continue' : 'pause — hold at the tick boundary; branches stay resident')"));
let patchText='';
for(const p of patches){const diff=spawnSync('diff',['-u','--label','a/'+p.file,'--label','b/'+p.file,resolve(from,p.file),resolve(app,p.file)],{encoding:'utf8'});if(diff.status!==0&&diff.status!==1)throw new Error('Cannot record UI patch: '+diff.stderr);patchText+=diff.stdout;}
writeFileSync(resolve(root,'reference/frontend.patch'),patchText);
writeFileSync(resolve(root,'reference/frontend-patch.json'),JSON.stringify({reason:'Shared transport presentation and passive observations; native execution unchanged',patches},null,2)+'\n');
const built=spawnSync('npm',['run','build:web'],{cwd:app,stdio:'inherit'});if(built.status!==0)throw new Error('Shared frontend build failed');
console.log('Built the same Fieldnote frontend for both hosts:',resolve(app,'dist-web'));
