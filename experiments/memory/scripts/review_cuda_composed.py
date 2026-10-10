"""Reproduce evidence receipts around a retrospective, non-blind claim review.
The prose judgments below are manual; hashes/counts/checks are computed.
"""
from pathlib import Path
import json, hashlib, re
ROOT=Path(__file__).resolve().parents[1]
p=ROOT/'comparisons/cuda-composed-2026-10-10'
sha=lambda b:hashlib.sha256(b).hexdigest()
load=lambda f:json.loads(f.read_text())
protocol=load(p/'protocol.json')
summary=load(p/'memory-summary.json')
expected={
 'capacity_energy': 'Cedar 1200 L/day and 6 kWh/day; Birch 900 L/day and 3 kWh/day.',
 'audit_requirement': 'Birch brochure 1400 corrected to 900; council requires at least 1000; Cedar alone meets this, Birch alone does not.',
 'cost_upgrade': 'Cedar 18 credits/day and 400-credit inlet upgrade; Birch 12 credits/day and no inlet upgrade.',
 'grant': 'Grant covers installation, not recurring operating costs.',
 'maintenance': 'Cedar filter inspection every 7 days; Birch every 14 days.',
 'limits': '30-day pilot; winter performance unmeasured; annual reliability unestablished.',
 'figure': 'PDF page 2: blue normal route Intake → UV chamber → Storage; orange maintenance bypass Intake → Storage, bypassing UV chamber.',
 'distractor': 'Do not treat lighting-pilot lumens as water capacity or energy.',
}
judgments={
 'fieldnote':{
  'capacity_energy':'correct','audit_requirement':'correct primary selection; the unqualified phrase "only configuration" conflicts with its later combined option',
  'cost_upgrade':'correct numbers','grant':'omitted in inquiry 2 and final synthesis',
  'maintenance':'correct numbers','limits':'correct core uncertainty; adds unsupported freezing/ice and seasonal claims under citations',
  'figure':'partial in first answer: source-list sentence says blue through UV/orange bypass; no body explanation of endpoints or arrows. Document inquiry and follow-up contain the correct explanation.',
  'distractor':'not used as water evidence',
 },
 'langgraph':{
  'capacity_energy':'correct','audit_requirement':'correct single-system recommendation',
  'cost_upgrade':'correct numbers','grant':'present in inquiry 2, omitted in final synthesis',
  'maintenance':'correct numbers','limits':'correct; does not infer a winter-performance advantage',
  'figure':'correct in main body: both full paths, line styles, bypassed component and page-2 citation',
  'distractor':'not used as water evidence',
 },
}
extra={
 'fieldnote':[
  {'claim':'Cedar + Birch "doubles the capital and operational burden"','verdict':'incorrect','reason':'18 + 12 = 30 credits/day, not twice Cedar\'s 18. The corpus gives Birch no inlet upgrade and no combined installation cost that establishes doubled capital.'},
  {'claim':'The pilot establishes Cedar as the lesser-risk choice when winter reliability is unknown.','verdict':'unsupported comparative reliability inference','reason':'Capacity supports selecting Cedar; neither system has winter-performance evidence.'},
  {'claim':'Combined output of 2100 L/day','verdict':'arithmetic extrapolation, not measured combined configuration','reason':'1200 + 900 is correct addition, but the fixtures do not test operating both systems together.'},
 ],
 'langgraph':[
  {'claim':'The cost inquiry says a combination costs "30 credits/day extra".','verdict':'imprecise inquiry wording, not repeated in synthesis','reason':'30 is the sum; increment over Cedar alone is 12. The final recommendation avoids the combined-system claim.'},
 ],
}
reviews={}
for backend in ['fieldnote','langgraph']:
 base=p/backend
 answer=(base/'answer.md').read_text()
 events=summary['backends'][backend]['stageEvents']
 answers=[e['text'] for e in events if e['type']=='answer']
 report=load(next((base/'data/reports').glob('*/report.json')))
 blobs=base/'data/media/blobs/sha256'
 uploads={name:{'sha256':digest,'storedSourceBytesMatch':(blobs/digest).exists() and sha((blobs/digest).read_bytes())==digest} for name,digest in protocol['attachmentHashes'].items()}
 assert all(x['storedSourceBytesMatch'] for x in uploads.values())
 review={
  'reviewVersion':1,'status':'reviewed-with-differences','reviewedOn':'2026-10-10',
  'method':'Manual local artifact review by the implementing assistant; retrospective rubric; neither blind nor independent; one generated answer per backend.',
  'backend':backend,'executionCompleted':True,'comparisonEligible':False,'overallQualityEquivalent':False,
  'scope':'Initial four-inquiry synthesis and separate continuation; no model rerun, answer editing, or automatic keyword score substitutes for this review.',
  'answerSha256':sha(answer.encode()),'wordCountWhitespaceSplit':len(answer.split()),
  'sourceByteVerification':uploads,
  'groundTruth':expected,'firstAnswer':judgments[backend],'additionalFindings':extra[backend],
  'continuation':{'coreFacts':'all correct','selectedSystem':'Cedar; 1200 L/day meets 1000 L/day requirement','dailyCost':'18 credits/day','orangeBypass':'UV chamber; both paths explained','textSha256':sha(answers[1].encode())},
  'citations': ({'firstAnswer':'Body uses parenthesized file:line labels rather than the required inline Markdown links; Markdown links occur in Sources. Several maintenance.md:1/trial.md:1 references target headings rather than evidence on line 3.',
                  'attachmentCitation':'3b32f5401dfe/page/2 lacks attachment:// and fails the pinned UI citation parser. Inquiry citation had the correct scheme; follow-up again omits it.',
                  'grounding':'Core measured figures are supported by the corpus; added freezing/seasonal claims are not.'} if backend=='fieldnote' else
                 {'firstAnswer':'Core facts have inline corpus links; page-2 attachment link matches the stored document prefix and parser grammar. Not every repeated factual assertion has a local inline citation.',
                  'attachmentCitation':'The extra Sources entry cite(Harbor Water Pilot)/2 is malformed. The separate valid attachment://9a503717ac5a/page/2 link supports the figure.',
                  'grounding':'Core final claims are supported. Inquiry 2 has mismatched source labels/URLs, e.g. Operating costs mapped to cite(audit.md)/1-3, although final body uses cost.md.'}),
  'verdict':'LangGraph has better initial figure coverage and fewer unsupported additions in this sample. Both preserve core numerical facts, omit the grant in synthesis, and answer the three follow-up questions correctly. Full quality equivalence is not established.',
  'evidenceFiles':['answer.md','reviewed-plan.json','browser.jsonl',str(next((base/'data/reports').glob('*/report.json')).relative_to(base)),'settled.png','followup.png'],
 }
 (base/'quality-review.json').write_text(json.dumps(review,indent=2,ensure_ascii=False)+'\n')
 (p/'review'/f'{backend}-followup.md').write_text(answers[1]+'\n')
 reviews[backend]=review
# Compare actual recorded synthesis system instructions, not source templates alone.
trace=next((p/'fieldnote/data/reports').glob('trace*'))
tr=[json.loads(l) for l in trace.read_text().splitlines()]
native=next(r for r in tr if r.get('type')=='prompt:format' and r.get('agentId')==131077)
nm=json.loads(native['messages'])
hp=p/'langgraph/http/9a1f063d-a3a1-4c46-b9a3-4ec9c63f0901.request.json'
hm=load(hp)['messages']
systems={k:next(m['content'] for m in ms if m['role']=='system') for k,ms in [('fieldnote',nm),('langgraph',hm)]}
assert systems['fieldnote']==systems['langgraph']
receipts={
 'synthesisSystemPromptsByteIdentical':True,'systemSha256':sha(systems['fieldnote'].encode()),'systemBytes':len(systems['fieldnote'].encode()),
 'nativeEvidence':str(trace.relative_to(p)),'httpEvidence':str(hp.relative_to(p)),
 'userMessageHashes':{k:sha(next(m['content'] for m in ms if m['role']=='user').encode()) for k,ms in [('fieldnote',nm),('langgraph',hm)]},
 'meaning':'Only the synthesis system instructions are byte-identical. Findings/user messages, image choices, tool counts, execution order and retained state differ.',
 'visualInputs':'Identical uploaded PDF and PNG bytes verified in both stores. Native document agent requested figure=1 (crop); LangGraph requested full page=2. These are actual model tool choices, not manually extracted substitutes.',
 'httpCapacityVsComposed':'Capacity diagnostic uses separate/default KV streams; this composed pair retains explicit --kv-unified with ctx=32768, parallel=4. They are separate conditions.',
}
(p/'review/prompt-and-input-controls.json').write_text(json.dumps(receipts,indent=2)+'\n')
(p/'review/quality-comparison.json').write_text(json.dumps({'status':'reviewed-with-differences','comparisonEligible':False,'method':reviews['fieldnote']['method'],'verdict':reviews['fieldnote']['verdict'],'backends':reviews},indent=2,ensure_ascii=False)+'\n')
print('Reviewed both initial answers, four inquiry findings each, and both follow-ups; input and prompt receipts saved.')
