import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ROOT } from './util.js';
import type { Event } from './types.js';
import type { RunOptions } from './runner.js';
import { workloadReview } from './workload-review.js';

export async function summarize(events:Event[],options:RunOptions,error?:string) {
  const first=(type:string,stage?:string)=>events.find(e=>e.type===type&&(!stage||e.stage===stage));
  const elapsed=(a:Event|undefined,b:Event|undefined)=>a&&b?b.t_ms-a.t_ms:null;
  const key=JSON.parse(await readFile(resolve(ROOT,'fixtures/generated/answer-key.json'),'utf8'));
  const brief=first('answer','brief')?.data.text??'',followup=first('answer','followup')?.data.text??'';
  const coverage=key.facts.filter((f:any)=>f.journeys.includes(options.journey)).map((f:any)=>({id:f.id,matched:f.patterns.some((p:string)=>new RegExp(p,'i').test(brief))}));
  const actions=events.filter(e=>e.type==='user.action');
  const held=first('control.held'),resumed=first('control.resumed');
  const canceled=actions.find(e=>e.data.action==='cancel');
  const postCancelUpdates=canceled?events.filter(e=>e.seq>canceled.seq&&e.type==='section.update'&&e.inquiry===canceled.data.inquiry):[];
  const heldUpdates=held&&resumed?events.filter(e=>e.seq>held.seq&&e.seq<resumed.seq&&e.type==='section.update'):[];
  const requests=events.filter(e=>e.type==='model.request');
  const endings=events.filter(e=>e.type==='model.end');
  const measured=endings.filter(e=>e.data.timings||e.data.usage?.prompt_tokens_details);
  const cacheSamples=measured.map(e=>({stage:e.stage,inquiry:e.inquiry,requestId:e.data.id,cachedTokens:e.data.timings?.cache_n??e.data.usage?.prompt_tokens_details?.cached_tokens??null,evaluatedPromptTokens:e.data.timings?.prompt_n??null,promptMs:e.data.timings?.prompt_ms??null,decodeMs:e.data.timings?.predicted_ms??null}));
  const peak=(source:string)=>Math.max(0,...events.filter(e=>e.type==='resource.sample'&&e.data.source===source).map(e=>e.data.memory?.rss??0))||null;
  const useful=events.find(e=>e.stage==='brief'&&e.type==='milestone.useful')??events.find(e=>e.stage==='brief'&&e.type==='section.update'&&e.data.text?.length>=120);
  const render=useful?events.find(e=>e.type==='ui.rendered'&&e.data.eventSeq>=(useful.data.eventSeq??useful.seq)):undefined;
  const warnings=[...events.filter(e=>e.type==='coverage.gap').map(e=>`${e.data.feature}: ${e.data.reason}`)];
  if(!events.some(e=>e.type==='inspection.resolved'&&e.data.kind==='image'))warnings.push('No verified image receipt inspected');
  if(!options.browser)warnings.push('No browser UX timings: headless diagnostic only');
  if(heldUpdates.length)warnings.push('Visible section updates occurred while held');
  if(postCancelUpdates.length)warnings.push('Canceled inquiry emitted late visible content');
  if(!brief.trim()||!followup.trim())warnings.push('Brief or follow-up missing');
  if(coverage.some((f:any)=>!f.matched))warnings.push('Required fact smoke checks failed; inspect the saved answer');
  if(/\[task:\d+\]/i.test(brief+'\n'+followup))warnings.push('Answer cites an inquiry ID instead of an evidence source');
  return {
    ...options,continuationMode:options.adapter==='fieldnote'?'KV':'Transcript resent over HTTP',status:error?'failed':'completed',error:error??null,
    claimEligible:false,comparison:workloadReview,qualityReview:'Not established; pattern coverage is not a semantic or citation audit. Workload mismatch independently invalidates the comparison.',
    limitations:['Engine builds not matched','Whole-inference-process memory comparison unavailable','Synthetic pilot, not a distribution of real workloads','Retrieval methods differ','Cold reopen control and trace-overhead ablation not implemented'],
    metrics:{startupMs:elapsed(first('backend.start'),first('ready')),briefMs:elapsed(first('query','brief'),first('complete','brief')),followupMs:elapsed(first('query','followup'),first('complete','followup')),firstDraftBackendMs:elapsed(first('query','brief'),useful),firstDraftBrowserMs:elapsed(first('query','brief'),render),holdAckMs:elapsed(actions.find(e=>e.data.action==='hold'),held),closeToSettledMs:elapsed(actions.find(e=>e.data.action==='close'),first('complete','brief')),httpRequests:requests.length,wireBytes:requests.reduce((n,e)=>n+e.data.wireBytes,0),serverPromptTokensReported:endings.some(e=>e.data.usage)?endings.reduce((n,e)=>n+(e.data.usage?.prompt_tokens??0),0):null,serverCompletionTokensReported:endings.some(e=>e.data.usage)?endings.reduce((n,e)=>n+(e.data.usage?.completion_tokens??0),0):null,nativePeakObservedRssBytes:peak('native-process-self'),orchestratorPeakObservedRssBytes:peak('orchestrator-process-self'),serverPeakRssBytes:null,heldVisibleUpdates:heldUpdates.length,postCancelVisibleUpdates:postCancelUpdates.length},
    cacheReuse:{samples:cacheSamples,nativeWarmDeltaEvents:events.filter(e=>e.type==='native.warm_delta').map(e=>e.data),note:'Continuation does not imply KV reuse. Server prompt tokens and cached tokens are distinct; absent counters are unknown.'},
    factCoverage:coverage,coverageGaps:warnings,capabilities:first('capabilities')?.data??{},answers:{brief,followup},
  };
}
export const escapeHtml=(x:any)=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function reportHtml(id:string,result:any) {
  return `<!doctype html><meta charset="utf-8"><title>Diagnostic ${escapeHtml(id)}</title><style>body{font:16px system-ui;max-width:1000px;margin:50px auto;padding:20px;color:#19332f;background:#fafbf8}pre{white-space:pre-wrap;background:white;padding:24px;border:1px solid #d8dfda;border-radius:12px}h1{font-size:28px}.invalid{padding:20px;border:2px solid #a14126;background:#fff0e8}</style><h1>${escapeHtml(result.adapter)} (${escapeHtml(result.continuationMode)}) · ${escapeHtml(result.journey)}</h1><p>${escapeHtml(id)} · ${escapeHtml(result.status)}</p><aside class="invalid"><strong>Invalid architecture comparison — diagnostic record only.</strong><p>${escapeHtml(workloadReview.reason)}</p><p>${escapeHtml(workloadReview.allowedUse)}</p><p>${escapeHtml(workloadReview.browserScope)}</p></aside><h2>Diagnostic measurements and coverage</h2><pre>${escapeHtml(JSON.stringify({...result,answers:undefined},null,2))}</pre><h2>Brief</h2><pre>${escapeHtml(result.answers.brief)}</pre><h2>Follow-up</h2><pre>${escapeHtml(result.answers.followup)}</pre>`;
}
