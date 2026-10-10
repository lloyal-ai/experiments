#!/usr/bin/env node
/** Render saved answer packets, without generation, editing, or rescoring. */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(new URL('../../memory/package.json', import.meta.url));
const { Marked } = await import(require.resolve('marked'));
const root = resolve(process.argv[2] ?? 'experiments/reasoning/results/cuda-fieldnote-v1');
const readJSON = async name => JSON.parse(await readFile(join(root, name), 'utf8'));
const [summary, quality, mapping, rubric] = await Promise.all([
  readJSON('summary.json'), readJSON('quality-by-run.json'),
  readJSON('review-mapping.json'), readJSON('quality-rubric.json'),
]);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Model-produced HTML is text. Citation destinations stay visible on hover but
// inert: these answers contain invented URLs and attachment IDs. Raw Markdown
// remains downloadable and is included verbatim in each source disclosure.
const markdown = new Marked({ renderer: {
  html({ text }) { return esc(text); },
  link({ href, tokens }) { return `<span class="citation" title="${esc(href)}">${this.parser.parseInline(tokens)}</span>`; },
  image({ href, text }) { return `<span title="${esc(href)}">${esc(text)}</span>`; },
}});
const labels = { resident: 'Lloyal', http: 'HTTP + prefix-cache', 'shared-prefix': 'HTTP + shared prefix' };
const criteriaLabels = {
  capacity_and_correction: 'Capacity and brochure correction', energy: 'Energy',
  cost_and_installation: 'Operating costs and installation', requirement_and_selection: 'Requirement and selection',
  grant: 'Grant coverage', maintenance: 'Maintenance', evidence_limits: 'Evidence limits',
  visual_route: 'Visual routing explanation', grounding: 'Grounding',
};
const records = [];
for (const run of summary.runs) {
  const review = quality.runs[run.run];
  const record = { ...run, review };
  if (review) {
    const packet = review.packet;
    const bytes = await readFile(join(root, 'review', `${packet}.md`));
    const hash = createHash('sha256').update(bytes).digest('hex');
    assert.equal(mapping[packet].run, run.run, `Wrong packet mapping: ${packet}`);
    assert.equal(mapping[packet].answerSha256, hash, `Answer changed: ${packet}`);
    record.source = bytes.toString('utf8');
    record.sha256 = hash;
    record.followup = await readFile(join(root, 'review', `${packet}-followup.md`), 'utf8');
  }
  records.push(record);
}
const seeds = [...new Set(records.map(r => r.seed))].sort();
const by = (seed, arm) => records.find(r => r.seed === seed && r.arm === arm);
const substantivePairs = seeds.map(seed => [by(seed, 'resident'), by(seed, 'shared-prefix')])
  .filter(pair => pair.every(r => r?.review?.substantiveInitialReport));
const jointWins = substantivePairs.filter(([l, r]) => l.generation.reasoningTokenCount < r.generation.reasoningTokenCount && l.review.score > r.review.score).length;
const pairCount = substantivePairs.length;
const overview = pairCount === 2 && jointWins === 2
  ? 'In both substantive shared-prefix comparisons, Lloyal used fewer reasoning tokens and scored higher on the frozen rubric.'
  : `In ${jointWins} of ${pairCount} substantive shared-prefix comparisons, Lloyal used fewer reasoning tokens and scored higher on the frozen rubric.`;
const defaultRound = substantivePairs.length ? seeds.indexOf(substantivePairs[0][0].seed) + 1 : 1;
const fmt = n => Number(n).toLocaleString('en-US');
const sourceDisclosure = r => `<details class="source"><summary>Exact saved Markdown · SHA-256 ${r.sha256.slice(0, 12)}…</summary><p><a href="review/${r.review.packet}.md">Open original answer packet</a></p><pre data-source="${r.review.packet}">${esc(r.source)}</pre><code>${r.sha256}</code></details>`;
function card(r) {
  const q = r.review;
  const answer = q ? `<details class="annotation" open><summary>Existing reviewer assessment · ${q.score}/${q.maximum}</summary><p>${esc(q.summary)}</p></details>
    <section class="answer" aria-label="Complete initial answer">${markdown.parse(r.source)}</section>
    ${sourceDisclosure(r)}
    <details class="followup"><summary>Separate follow-up answer — excluded from the initial score</summary><div class="answer">${markdown.parse(r.followup)}</div><a href="review/${q.packet}-followup.md">Original follow-up packet</a></details>`
    : '<div class="failure"><h3>No saved initial answer</h3><p>The synthesis exhausted its 32,768-position context while reasoning. No brief or completed follow-up was saved. This is a failed attempt, not a zero-token answer.</p></div>';
  return `<article class="card ${r.arm}" data-run="${r.run}"><header><div class="eyebrow">${r.arm === 'resident' ? 'Fieldnote · resident context' : 'LangGraph + llama-server · prefix-cache enabled'}</div><h2>${labels[r.arm]}</h2><div class="metrics"><div><strong>${fmt(r.generation.reasoningTokenCount)}</strong><span>synthesis reasoning tokens${q ? '' : ' · failed'}</span></div><div><strong>${q ? `${q.score}/${q.maximum}` : '—'}</strong><span>frozen rubric${q ? '' : ' · no answer'}</span></div><div><strong>${q ? fmt(r.answerTokens) : '—'}</strong><span>saved answer tokens${q?.substantiveInitialReport === false ? ' · tool markup' : ''}</span></div></div><small>${r.run}</small></header>${answer}</article>`;
}
function scoreComparison(left, right) {
  if (!left.review || !right.review) return '';
  return `<details class="rubric"><summary>Compare all nine rubric criteria and quoted evidence</summary><table><thead><tr><th>Criterion · 0–2 each</th><th>Lloyal</th><th>${labels[right.arm]}</th></tr></thead><tbody>${Object.entries(rubric.criteria).map(([key, description]) => `<tr><th>${criteriaLabels[key]}<small>${esc(description)}</small></th>${[left, right].map(r => `<td><strong>${r.review.criteria[key].score}/2</strong><p>${esc(r.review.criteria[key].evidence)}</p></td>`).join('')}</tr>`).join('')}</tbody></table><p>Original scores are unchanged. Citation usability was reviewed separately: ${[left, right].map(r => `<strong>${labels[r.arm]}:</strong> ${esc(r.review.citations)}`).join(' ')}</p></details>`;
}
function conclusion(left, right) {
  if (!right.review) return 'Ordinary HTTP produced no report in this round. Its failed generation cannot serve as a quality-matched token comparison.';
  if (right.review.substantiveInitialReport === false) return 'Shared-prefix HTTP saved only a literal tool-call block. Its lower reasoning count does not establish comparable-quality efficiency.';
  const delta = (1 - left.generation.reasoningTokenCount / right.generation.reasoningTokenCount) * 100;
  return `Lloyal emitted ${Math.abs(delta).toFixed(1)}% ${delta >= 0 ? 'fewer' : 'more'} synthesis reasoning tokens and scored ${left.review.score}/${left.review.maximum}, versus ${right.review.score}/${right.review.maximum}. This is a joint observation of token count and rubric quality, not a quality-matched causal estimate.`;
}
const panels = seeds.flatMap((seed, i) => ['shared-prefix', 'http'].map(arm => {
  const left = by(seed, 'resident'), right = by(seed, arm);
  assert(left && right, `Missing comparison for seed ${seed}, ${arm}`);
  return `<section class="round" data-round="${i + 1}" data-arm="${arm}"><div class="round-heading"><h2>Round ${i + 1} <span>· seed offset ${seed}</span></h2><p>${conclusion(left, right)}</p></div>${scoreComparison(left, right)}<div class="columns">${card(left)}${card(right)}</div></section>`;
})).join('\n');
const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Fieldnote answers side by side — CUDA reasoning</title>
<style>
:root{color-scheme:light;--ink:#202632;--muted:#596374;--line:#dce1e8;--native:#eb5138;--http:#4059df;--paper:#fff;--surface:#f4f6f9}*{box-sizing:border-box}body{margin:0;background:var(--surface);font:16px/1.55 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--ink)}main{max-width:1520px;margin:auto;padding:28px 32px 64px}a{color:#354fb4}h1{font-size:clamp(27px,3vw,39px);letter-spacing:-.035em;line-height:1.2;margin:14px 0}h2,h3{line-height:1.3}p{margin:10px 0}.intro{max-width:1030px}.intro p{font-size:17px}.overline,.eyebrow{text-transform:uppercase;font-size:11px;font-weight:700;letter-spacing:.08em;color:var(--muted)}.method{font-size:13px;color:var(--muted);margin:14px 0 22px;max-width:1130px}.controls{display:flex;justify-content:space-between;align-items:end;gap:20px;background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:14px 18px;margin-top:20px}.round-tabs{display:flex;gap:8px;flex-wrap:wrap}button,select{font:inherit;border:1px solid var(--line);background:var(--paper);color:var(--ink);border-radius:7px;padding:8px 13px}button{cursor:pointer;text-align:left}button span{display:block;font-size:11px;color:var(--muted);font-weight:400}button[aria-pressed="true"]{background:#202632;border-color:#202632;color:#fff}button[aria-pressed="true"] span{color:#e1e6ee}label{display:flex;flex-direction:column;gap:4px;font-size:12px;font-weight:600}select{font-size:14px}.round-heading{margin:24px 0 14px}.round-heading h2{font-size:20px;margin:0 0 5px}.round-heading h2 span{font-size:13px;font-weight:400;color:var(--muted)}.round-heading p{font-size:15px;max-width:1050px}.columns{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:22px;align-items:start}.card{border:1px solid var(--line);border-radius:12px;background:var(--paper);overflow:hidden}.card header{border-top:4px solid var(--http);padding:20px 24px 14px;border-bottom:1px solid var(--line)}.card.resident header{border-top-color:var(--native)}.card header h2{font-size:23px;margin:6px 0 14px;letter-spacing:-.025em}.metrics{display:flex;gap:24px;justify-content:space-between;margin-bottom:10px}.metrics strong{display:block;font-variant-numeric:tabular-nums;font-size:26px;line-height:1.1}.metrics span{display:block;font-size:11px;max-width:155px;color:var(--muted);margin-top:5px}small{font-size:11px;color:var(--muted)}.annotation{padding:14px 24px;background:#fafbfc;border-bottom:1px solid var(--line);font-size:13px}.annotation p{margin-bottom:0}.annotation summary{font-size:12px;font-weight:650}.answer{padding:24px;overflow-wrap:anywhere;font-size:15px;line-height:1.7}.answer>:first-child{margin-top:0}.answer>:last-child{margin-bottom:0}.answer h1{font-size:23px;letter-spacing:-.025em;margin:0 0 24px}.answer h2{font-size:19px;margin:25px 0 12px}.answer h3{font-size:17px;margin-top:22px}.answer p{margin:0 0 16px}.answer li{margin:4px 0}.answer table{font-size:13px}.citation{color:#475f8a;text-decoration:underline;text-decoration-style:dotted;cursor:help}.source,.followup{border-top:1px solid var(--line);padding:16px 24px;font-size:13px}.followup .answer{padding:20px 0}.source pre{white-space:pre-wrap;font-size:12px;line-height:1.6;background:var(--surface);padding:12px}.source code{font-size:10px;overflow-wrap:anywhere}summary{cursor:pointer}details.rubric{margin:0 0 18px;padding:12px 16px;background:var(--paper);border:1px solid var(--line);border-radius:8px;font-size:13px}table{border-collapse:collapse;width:100%;table-layout:fixed}td,th{padding:12px;border-bottom:1px solid var(--line);vertical-align:top;text-align:left}th small{display:block;font-weight:400;margin-top:4px}.failure{padding:24px;background:#fff8ef}.failure h3{margin-top:0}.footer{margin-top:32px;color:var(--muted);font-size:13px;max-width:1100px}[hidden]{display:none!important}button:focus-visible,select:focus-visible,summary:focus-visible{outline:3px solid #608afa;outline-offset:3px}@media(max-width:800px){main{padding:20px 14px}.controls{align-items:stretch;flex-direction:column}.columns{gap:12px}.card header,.annotation,.answer,.source,.followup{padding-left:16px;padding-right:16px}.metrics{gap:8px}.metrics strong{font-size:23px}}@media(max-width:560px){.columns{grid-template-columns:1fr}.round-tabs{flex-wrap:nowrap}button{padding:8px 10px}.rubric{overflow-x:auto}.rubric table{min-width:700px}}@media print{.controls,.rubric,.source,.followup{display:none}.card{overflow:visible}body{background:#fff}main{padding:0}.answer{font-size:10pt}.card header{break-after:avoid}}
</style></head><body><main>
<a href="index.html">← Benchmark report</a>
<div class="intro"><p class="overline">Full Fieldnote workload · NVIDIA L40S · all ${seeds.length} rounds</p><h1>Read the answers alongside the reasoning counts</h1><p><strong>${overview}</strong> Low reasoning counts on lower-quality outputs do not establish that an advantage disappeared at comparable quality.</p></div>
<p class="method">Complete initial answers appear below, with their original wording and citations. Reviewer annotations are separate. Scores come from the existing anonymous-packet review by the implementing assistant, not an independent evaluation. No scores, model outputs or token counts were changed. Opens at round ${defaultRound}${substantivePairs.length ? ', the first pair of substantive reports' : ''}.</p>
<div class="controls"><div class="round-tabs" aria-label="Choose round">${seeds.map((s, i) => `<button type="button" data-select-round="${i + 1}" aria-pressed="false">Round ${i + 1}<span>${by(s, 'shared-prefix').review?.substantiveInitialReport === false ? 'Shared-prefix: tool-call only' : `${by(s, 'resident').generation.reasoningTokenCount} vs ${by(s, 'shared-prefix').generation.reasoningTokenCount} reasoning tokens`}</span></button>`).join('')}</div><label>Compare Lloyal with<select id="comparator"><option value="shared-prefix">HTTP + shared prefix · prefix-cache enabled</option><option value="http">Ordinary HTTP · prefix-cache enabled</option></select></label></div>
${panels}
<div class="footer"><p>All answers are shown in full. Model-produced citation targets are preserved in the raw Markdown and on hover; they are inert in this view because several are fabricated or session-local. Expand “Exact saved Markdown” to inspect the original text and its verified SHA-256. Follow-ups are separate and cannot repair an initial answer’s score.</p><p>One synthetic task, ${seeds.length} rounds. Full prompts and generated evidence differ, and the shared-prefix arm changes instruction placement and tool headers. These observations do not isolate a retained-state mechanism or establish a general quality advantage. Application timing is reported separately in the main benchmark report.</p><p><a href="quality-rubric.json">Frozen rubric</a> · <a href="quality-review-blinded.json">Original anonymous review</a> · <a href="quality-by-run.json">Run mapping and evidence</a> · <a href="summary.json">Measurements</a> · <a href="README.md">Setup and interpretation</a></p></div>
</main><script>
const panels = [...document.querySelectorAll('.round')];
const buttons = [...document.querySelectorAll('[data-select-round]')];
const select = document.getElementById('comparator');
function render() {
  const params = new URLSearchParams(location.hash.slice(1));
  const round = buttons.some(b => b.dataset.selectRound === params.get('round')) ? params.get('round') : '${defaultRound}';
  const arm = params.get('arm') === 'http' ? 'http' : 'shared-prefix';
  panels.forEach(p => { p.hidden = p.dataset.round !== round || p.dataset.arm !== arm; });
  buttons.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.selectRound === round)));
  select.value = arm;
}
buttons.forEach(b => b.addEventListener('click', () => { location.hash = new URLSearchParams({round:b.dataset.selectRound,arm:select.value}); }));
select.addEventListener('change', () => { location.hash = new URLSearchParams({round:document.querySelector('[aria-pressed="true"]').dataset.selectRound,arm:select.value}); });
window.addEventListener('hashchange', render); render();
</script></body></html>`;
await writeFile(join(root, 'answers.html'), page);
console.log(`Wrote ${join(root, 'answers.html')}; verified ${records.filter(r => r.review).length} original answer hashes; retained ${records.length} attempts.`);
