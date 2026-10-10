/** Read-only derivation of observations; never declares workload or quality equivalence. */
export function normalize(row) {
  if (row.type === 'wire.event') return {...row, kind: 'event', value: row.data};
  if (row.type === 'browser.command') return {...row, kind: 'command', value: row.data};
  if (['wire.native.raw', 'wire.command.raw'].includes(row.type)) {
    const envelope = JSON.parse(row.data.raw);
    if (envelope.frame?.t === 'event') return {...row, kind: 'event', value: envelope.frame.payload};
    if (envelope.frame?.t === 'command') return {...row, kind: 'command', value: envelope.frame.payload};
  }
  return {...row, kind: 'observation', value: row.data};
}

function summarizeAttempt(rows, index, lastObservedMs) {
  const start = rows[0], events = rows.filter(r => r.kind === 'event');
  const terminal = events.find(r => ['complete', 'run:aborted'].includes(r.value.type));
  const end = terminal?.t_ms ?? rows.at(-1).t_ms;
  const interval = rows.filter(r => r.t_ms <= end);
  const first = type => events.find(r => r.value.type === type && r.t_ms <= end);
  const latency = type => first(type) ? first(type).t_ms - start.t_ms : null;
  const requests = interval.filter(r => r.type === 'http.request');
  const requestIds = new Set(requests.map(r => r.data.requestId));
  const responses = interval.filter(r => r.type === 'http.response' && requestIds.has(r.data.requestId));
  const failures = interval.filter(r => r.type === 'http.failure' && requestIds.has(r.data.requestId));
  const finishedIds = new Set([...responses,...failures].map(r => r.data.requestId));
  const sumReported = key => {
    const values = responses.map(r => key(r.data)).filter(Number.isFinite);
    return {total: values.length ? values.reduce((a,b) => a+b, 0) : null, reportingResponses: values.length};
  };
  const controls = interval.filter(r => r.kind === 'command' && ['pause','resume','cancel_agent','wrap_up','stop'].includes(r.value.type));
  let heldAt = null, heldMs = 0;
  for (const r of interval) {
    if (r.kind !== 'event') continue;
    if (r.value.type === 'run:paused' && heldAt === null) heldAt = r.t_ms;
    if (r.value.type === 'run:resumed' && heldAt !== null) {heldMs += r.t_ms-heldAt;heldAt = null;}
  }
  if (heldAt !== null) heldMs += end-heldAt;
  const peaks = new Map();
  for (const r of interval.filter(r => r.type === 'resource.sample')) for (const p of r.data.processes) {
    const prev = peaks.get(p.pid) ?? {pid:p.pid, peakRssBytes:0, peakCpuPct:0, samples:0};
    prev.peakRssBytes = Math.max(prev.peakRssBytes, p.rssBytes);prev.peakCpuPct = Math.max(prev.peakCpuPct,p.cpuPct);prev.samples++;peaks.set(p.pid,prev);
  }
  const answer = events.filter(r => r.value.type === 'answer' && r.t_ms <= end).at(-1)?.value.text ?? null;
  // agent:prefilled mirrors branch:prefill for presentation. Count only the trace records.
  const traces = interval.filter(r => r.kind === 'event' && r.value.type === 'agent:trace');
  const prefills = traces.filter(r => r.value.event.type === 'branch:prefill');
  const nativeCompletion = interval.find(r => r.type === 'wire.native.raw' && r.value.type === 'complete');
  return {
    index, commandSeq:start.seq, docId:first('query')?.value.docId ?? null,
    question:start.value.query, mode:start.value.skipPlanner ? 'Ask/follow-up' : start.value.mode,
    followup:first('query')?.value.warm ?? null,
    status:terminal?.value.type === 'complete' ? (answer ? 'settled-unreviewed' : 'settled-without-answer') : terminal ? 'aborted' : 'incomplete',
    comparisonEligible:false, quality:'unreviewed',
    timing:{clock:'host observation receipt, monotonic milliseconds', elapsedMs:terminal ? end-start.t_ms : null,
      observedUntilMs:end-start.t_ms, lastSessionObservationMs:lastObservedMs,
      acknowledgedHoldMs:heldMs, elapsedExcludingAcknowledgedHoldMs:terminal ? end-start.t_ms-heldMs : null,
      planReviewMs:latency('ui:plan_review'), researchStartMs:latency('research:start'),
      firstAgentReturnMs:latency('agent:return'), answerMs:latency('answer'), settledMs:latency('complete')},
    stages:Object.fromEntries(['preflight:start','preflight:done','plan:start','plan','research:start','research:done','synthesize:start','synthesize:done'].map(type => [type,events.filter(r => r.value.type === type).length])),
    controls:controls.map(r => ({seq:r.seq,atMs:r.t_ms-start.t_ms,...r.value})),
    findings:events.filter(r => r.value.type === 'agent:return').map(r => ({seq:r.seq,...r.value})),
    toolCalls:events.filter(r => r.value.type === 'agent:tool_call').map(r => ({seq:r.seq,agentId:r.value.agentId,tool:r.value.tool,args:r.value.args})),
    native:{completion:nativeCompletion?.value.data ?? null,
      prefills:prefills.map(r => ({seq:r.seq,traceId:r.value.event.traceId,branchHandle:r.value.event.branchHandle,
        role:r.value.event.role,cells:r.value.event.cells,attachments:r.value.event.attachments ?? []})),
      branches:traces.filter(r => ['branch:create','branch:prune'].includes(r.value.event.type)).map(r => ({seq:r.seq,...r.value.event})),
      note:'Native trace cells are not HTTP prompt-token counters. A retained conversation branch does not establish retention of inquiry tool/image KV; inspect parent positions and pruning. No duplicate presentation-prefill events are counted.'},
    http:{requests:requests.length,completed:responses.length,failed:failures.length,withoutTerminalObservation:requests.length-finishedIds.size,
      requestBodyBytes:requests.reduce((n,r) => n+r.data.wireBytes,0),
      reportedPromptTokens:sumReported(d => d.usage?.input_tokens),
      reportedOutputTokens:sumReported(d => d.usage?.output_tokens),
      reportedCachedPromptTokens:sumReported(d => d.usage?.input_token_details?.cache_read),
      note:'HTTP fields are observed requests only; absent native HTTP is not zero native inference work. Failed/unfinished streams may lack final token counts. Cached tokens do not establish app-owned or continuously resident KV.'},
    resources:{perProcess:[...peaks.values()],meaning:'Per-process ps RSS/CPU samples; RSS is not unique physical memory or GPU allocation. No summed memory total.'},
    // Hosts can emit the cause immediately after run:aborted. Retain it until the next ask,
    // while keeping all timing/token/resource measurements bounded by the terminal event.
    errors:rows.filter(r => r.type === 'journey.failure' || r.type === 'http.failure' || r.kind === 'event' && ['ui:error','agent:failed'].includes(r.value.type)).map(r => ({seq:r.seq,type:r.type,data:r.value,afterTerminal:!!terminal && r.t_ms>end})),
    answer,
  };
}

export function summarizeSession(raw, manifest) {
  const rows = raw.map(normalize), attempts = [];let current = null;
  for (const row of rows) {
    if (row.kind === 'command' && row.value.type === 'submit_query') {
      if (current) attempts.push(current);
      current = [];
    }
    if (current) current.push(row);
  }
  if (current) attempts.push(current);
  return {version:1,backend:manifest.backend,test:manifest.test,comparisonEligible:false,
    note:'Diagnostic summary only. Host completion, timings and token counts do not certify workload fidelity, cited-report quality, visual correctness or comparable successful UX. Browser paint is kept in the raw journal on its own clock.',
    attempts:attempts.map((r,i) => summarizeAttempt(r,i+1,rows.at(-1)?.t_ms ?? 0))};
}
