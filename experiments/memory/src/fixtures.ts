import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import PDFDocument from 'pdfkit';
import sharp from 'sharp';
import { ROOT, digest, jsonFile } from './util.js';
import type { Fixture, Task } from './types.js';

const packet = [
  ['trial', 'Trial results', 'The fictional Harbor water pilot compared the Cedar and Birch treatment systems over 30 days. Cedar delivered 1200 liters per day; Birch delivered 900 liters per day. Both met the drinking-water quality target. Cedar used 6 kWh per day and Birch used 3 kWh per day. Figures refer to the same operating conditions, not annual forecasts.'],
  ['cost', 'Operating costs', 'The operating ledger reports Cedar at 18 credits per day and Birch at 12 credits per day, excluding installation. Cedar needs a 400-credit inlet upgrade. Birch needs no inlet upgrade. A grant covers installation but does not cover recurring operating costs.'],
  ['audit', 'Independent correction', 'An early brochure said Birch delivered 1400 liters per day. The independent 30-day audit corrected that number to 900 liters per day. The brochure used a short clean-water test that is not representative. The council requires at least 1000 liters per day, so Birch alone fails the capacity requirement.'],
  ['maintenance', 'Maintenance and limitations', 'Cedar requires filter inspection every 7 days; Birch requires it every 14 days. The pilot measured no winter performance. Neither system has established annual reliability from this short pilot. Do not treat a 30-day result as an annual guarantee.'],
  ['distractor', 'Unrelated Harbor lighting pilot', 'A different Harbor street-lighting pilot measured Cedar lamps at 1400 lumens and Birch lamps at 1200 lumens. These are lamps, not water systems. Lighting quantities must not be used as water production or energy figures.'],
] as const;
const taskTexts = [
 'Compare the audited daily capacity and energy use of Cedar and Birch; check the corrected brochure claim. Cite the trial and audit.',
 'Compare operating cost, installation constraints and the council requirement. Reconcile the audit with the ledger and explain the feasible option.',
 'Inspect the attached pilot PDF figure visually. Explain the blue and orange routes and which component the orange route bypasses. Cite page 2.',
 'Evaluate maintenance intervals and limits of the pilot evidence, including what is unknown about winter reliability. Cite sources.',
];
const tasks = (texts: readonly string[]): Task[] => texts.map((description, i) => ({ id: `task:${i}`, description }));

export async function buildFixtures(): Promise<Fixture> {
  const root = resolve(ROOT, 'fixtures/generated');
  await mkdir(resolve(root, 'corpus'), { recursive: true });
  const diagram = resolve(root, 'flow-diagram.png');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="700"><rect width="1200" height="700" fill="white"/><style>text{font-family:Arial;font-size:30px;fill:#172334}.label{font-size:24px}</style><defs><marker id="blue" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#1268c5"/></marker><marker id="orange" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="#d65317"/></marker></defs><text x="50" y="65" font-size="36">Harbor pilot: routing diagram</text><g fill="#edf3f8" stroke="#172334" stroke-width="3"><rect x="50" y="290" width="220" height="110" rx="14"/><rect x="450" y="290" width="240" height="110" rx="14"/><rect x="880" y="290" width="250" height="110" rx="14"/></g><text x="95" y="355">Intake</text><text x="485" y="355">UV chamber</text><text x="930" y="355">Storage</text><path d="M270 340 H445 M690 340 H875" fill="none" stroke="#1268c5" stroke-width="8" marker-end="url(#blue)"/><path d="M160 290 V180 H1000 V285" fill="none" stroke="#d65317" stroke-width="8" stroke-dasharray="15 8" marker-end="url(#orange)"/><text class="label" x="465" y="150">Orange: maintenance bypass</text><text class="label" x="420" y="465">Blue: normal treatment route</text><text class="label" x="50" y="620">Read direction from the arrowheads. This is a schematic, not to scale.</text></svg>`;
  await sharp(Buffer.from(svg)).png().toFile(diagram);
  const image = resolve(root, 'site-map.png');
  await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="600"><rect width="1000" height="600" fill="#f7f6ee"/><style>text{font-family:Arial;fill:#1f3344;font-size:32px}</style><text x="50" y="65">Harbor pilot site map</text><path d="M500 120 V530" stroke="#54a7cb" stroke-width="80"/><circle cx="220" cy="260" r="70" fill="#3b8561"/><circle cx="770" cy="260" r="70" fill="#d49230"/><text x="160" y="380">Cedar</text><text x="720" y="380">Birch</text><text x="45" y="500">West bank</text><text x="735" y="500">East bank</text><text x="50" y="570">North is up</text></svg>`)).png().toFile(image);
  const pdf = resolve(root, 'harbor-pilot.pdf');
  const pdfDoc = new PDFDocument({ size: 'A4', margin: 45, info: { Title: 'Harbor Water Pilot', Author: 'Lloyal benchmark synthetic fixture', CreationDate: new Date('2026-01-01T00:00:00Z'), ModDate: new Date('2026-01-01T00:00:00Z') } });
  const out = createWriteStream(pdf); pdfDoc.pipe(out);
  pdfDoc.fontSize(23).text('Harbor Water Pilot'); pdfDoc.moveDown().fontSize(12).text('Synthetic evidence packet. All entities and numbers are fictional.');
  for (const [id, title, text] of packet.filter(x => x[0] === 'trial' || x[0] === 'maintenance')) { pdfDoc.moveDown().fontSize(16).text(title).fontSize(12).text(text); }
  pdfDoc.addPage().fontSize(22).text('Figure 1: Treatment routing'); pdfDoc.moveDown().fontSize(12).text('The diagram below records normal and maintenance routes. Inspect its arrows and component labels to explain the bypass.'); pdfDoc.image(diagram, 42, 180, { width: 510 });
  pdfDoc.end(); await new Promise<void>((res, rej) => { out.on('finish', res); out.on('error', rej); });
  const sources = [];
  for (const [id, title, text] of packet) { const path = resolve(root, 'corpus', `${id}.md`); await writeFile(path, `# ${title}\n\n${text}\n`); sources.push({ id, title, path, text }); }
  sources.push({ id: 'pdf-page-1', title: 'Harbor Water Pilot, page 1', path: pdf, page: 1, text: packet.filter(x => ['trial', 'maintenance'].includes(x[0])).map(x => x[2]).join('\n\n') });
  const fixture: Fixture = {
    version: 1, root, pdf, image, diagram, sources,
    journeys: {
      J1: { question: 'Which Harbor water pilot system should the council select? Use the attached PDF, site map and local evidence corpus. Compare audited capacity, energy, cost, correction and maintenance. Explain the routing figure visually. Give a concise cited research brief and distinguish measured results from unknowns.', followup: 'Using the brief and the routing figure: which system meets the daily council requirement, what is its daily operating cost, and which component does the orange route bypass?', tasks: tasks(taskTexts) },
      'J1-investigate': { question: 'Investigate the Harbor water pilot decision in sequence: establish the audited constraints, evaluate feasible systems using those findings, then reconcile cost and operational risks including the PDF routing figure. Cite evidence.', followup: 'Which system is feasible, what does it cost per day, and which component does the orange route bypass?', tasks: tasks([taskTexts[0], taskTexts[1], taskTexts[2] + ' Also state the limits of the evidence.']) },
      J2: { question: 'Explain Figure 1 in the attached Harbor Water Pilot PDF visually. Describe the blue and orange paths, arrow direction and the component bypassed. Cite its page. Include one short factual sentence about the pilot from page 1.', followup: 'In Figure 1, does the orange route pass through the UV chamber? How does that compare with the blue route? Refer to the previous answer and cite the page.', tasks: tasks(['Explain the PDF figure visually with a page reference and one measured pilot fact.']) },
    }, hashes: {},
  };
  for (const path of [pdf, image, diagram, ...sources.filter(s => !s.page).map(s => s.path)]) fixture.hashes[path] = digest(await readFile(path));
  await jsonFile(resolve(root, 'manifest.json'), fixture);
  await jsonFile(resolve(root, 'answer-key.json'), { synthetic: true, facts: [
    { id: 'cedar-capacity', patterns: ['cedar[\\s\\S]{0,160}1[,]?200', '1[,]?200[\\s\\S]{0,100}cedar'], journeys: ['J1','J1-investigate'] },
    { id: 'birch-corrected', patterns: ['birch[\\s\\S]{0,160}900', '900[\\s\\S]{0,100}birch'], journeys: ['J1','J1-investigate'] },
    { id: 'cedar-cost', patterns: ['cedar[\\s\\S]{0,160}18', '18[\\s\\S]{0,100}cedar'], journeys: ['J1','J1-investigate'] },
    { id: 'bypass', patterns: ['(?:orange|bypass)[\\s\\S]{0,220}(?:bypasses|bypass|skip|avoid|without|not pass)[\\s\\S]{0,100}UV', 'UV[\\s\\S]{0,120}(?:bypass|skip|avoid)'], journeys: ['J1','J1-investigate','J2'] },
  ], note: 'Pattern coverage is a smoke signal only. Blind claim/citation review is required for quality-equivalent performance claims; raw answers and source receipts are retained.' });
  return fixture;
}
export function fixturePath(path: string, oldRoot: string, newRoot: string): string {
  const suffix=relative(oldRoot,path);
  if(suffix==='..'||suffix.startsWith('../')||isAbsolute(suffix))throw new Error('Fixture path outside its recorded root: '+path);
  return resolve(newRoot,suffix);
}
export async function loadFixture(): Promise<Fixture> {
  const root=resolve(ROOT,'fixtures/generated');
  let raw:string;
  try { raw=await readFile(resolve(root,'manifest.json'),'utf8'); }
  catch(error) { if((error as NodeJS.ErrnoException).code==='ENOENT')return buildFixtures();throw error; }
  const original:Fixture=JSON.parse(raw);
  const rebase=(path:string)=>fixturePath(path,original.root,root);
  const fixture:Fixture={...original,root,pdf:rebase(original.pdf),image:rebase(original.image),diagram:rebase(original.diagram),sources:original.sources.map(s=>({...s,path:rebase(s.path)})),hashes:Object.fromEntries(Object.entries(original.hashes).map(([path,hash])=>[rebase(path),hash]))};
  // Relocation changes paths only. Missing or changed evidence must not be regenerated.
  for(const [path,hash] of Object.entries(fixture.hashes))if(digest(await readFile(path))!==hash)throw new Error('Fixture hash mismatch: '+path);
  return fixture;
}
