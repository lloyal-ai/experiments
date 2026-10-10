import { readFile, mkdir, writeFile, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { FileAttachmentStore, createContentIngress } from '@lloyal-labs/media/node';
import { asAttachment, representationsOf, pagesOf, type Attachment, type Descriptor } from '@lloyal-labs/media';
import type { Receipt, Emit } from './types.js';
import type { ToolSchema, Message } from './http-model.js';
import type { Ranker } from './reranker.js';
import { digest, sleep } from './util.js';
import { loadResources, chunkResources } from './content/files.js';
import { fitChunks } from './content/fit.js';
import { loadDocuments, type Document } from './content/documents.js';
import { mergeRanges, subtractRanges } from './content/ranges.js';
import { BM25Index } from './content/bm25.js';
import type { Resource, Chunk } from './content/types.js';
import { sourceInfo, type SourceInfo, type SourceName } from './prompts.js';

import { readFileSync } from 'node:fs';
import { ROOT } from './util.js';
export const tools: ToolSchema[] = JSON.parse(readFileSync(resolve(ROOT, 'reference/portable/tool-schemas.json'), 'utf8'));
type Indexed = Document & { id: string };
export type ToolResult = { text: string; images: Receipt[]; receipts: Receipt[]; attachments: Descriptor[]; ranking?: any };
const idOf = (root: Descriptor) => root.digest.replace('sha256:', '').slice(0, 12);
const cite = (doc: Indexed, page: number) => `attachment://${doc.id}/page/${page}`;

/** Evidence comes only from source bytes and model-requested tools. No fixture answer text or fixed crop. */
export class Evidence {
  receipts = new Map<string, Receipt>();
  readonly store: FileAttachmentStore;
  readonly ingress: ReturnType<typeof createContentIngress>;
  roots: Attachment[] = [];
  resources: Resource[] = [];
  chunks: Chunk[] = [];
  private documents = new Map<string, Promise<{ doc: Indexed; chunks: Chunk[] }>>();
  private active: Attachment[] = [];
  private included = new Set<SourceName>(['corpus', 'documents']);
  constructor(private corpusPath: string, private emit: Emit, private ranker: Ranker, private dir: string, private delayMs = 0) {
    this.store = new FileAttachmentStore(resolve(dir, 'media'));
    this.ingress = createContentIngress(this.store);
  }
  async initialize(signal?: AbortSignal) {
    this.resources = this.corpusPath ? loadResources(this.corpusPath) : [];
    this.chunks = await fitChunks(chunkResources(this.resources), { maxTokens: 256, tokenize: t => this.ranker.tokenize(t, signal) });
    this.emit('corpus.indexed', { fileCount: this.resources.length, chunkCount: this.chunks.length });
  }
  snapshot(roots: readonly Descriptor[], excluded: string[]) {
    const e = new Evidence(this.corpusPath, this.emit, this.ranker, this.dir, this.delayMs);
    e.resources = this.resources; e.chunks = this.chunks; e.documents = this.documents;
    e.setRoots(roots);
    for (const name of excluded) if (name === 'corpus' || name === 'documents') e.participation(name, false);
    return e;
  }
  descriptor(digest: string): Descriptor {
    const bytes=this.store.get(digest); if(!bytes || !this.store.getManifest(digest))throw new Error('Missing attachment '+digest);
    return {mediaType:'application/vnd.oci.image.manifest.v1+json',digest,size:bytes.byteLength};
  }
  async ingest(bytes: Uint8Array, signal?: AbortSignal) {
    const at = performance.now();
    const root = await this.ingress.ingest(bytes, signal);
    if (!this.roots.some(r => r.digest === root.digest)) this.roots.push(root);
    this.emit('attachment.ingested', { root, sourceDigest: digest(bytes), durationMs: performance.now() - at });
    return root;
  }
  setRoots(roots: readonly Descriptor[]) {
    this.active = roots.map(root => {
      const manifest = this.store.getManifest(root.digest);
      if (!manifest) throw new Error(`Unknown attachment ${root.digest}`);
      const actual = this.store.get(root.digest);
      if (!actual || actual.byteLength !== root.size) throw new Error('Attachment descriptor does not match stored bytes');
      const attachment = asAttachment(root);
      if (!attachment) throw new Error(`Invalid attachment descriptor ${root.digest}`);
      return attachment;
    });
  }
  participation(name: SourceName, included: boolean) { if (included) this.included.add(name); else this.included.delete(name); }
  isIncluded(name: SourceName) { return this.included.has(name); }
  sources(): SourceInfo[] {
    const result: SourceInfo[] = [];
    if (this.included.has('corpus') && this.resources.length) {
      const toc = this.resources.map(r => {
        const topics = [...new Set(this.chunks.filter(c => c.resource === r.name && c.section && !c.section.includes(' > ')).map(c => c.heading))];
        return topics.length ? `${r.name} (topics: ${topics.join(', ')})` : r.name;
      }).join('\n');
      result.push(sourceInfo('corpus', toc));
    }
    const docs = loadDocuments(this.store, this.active);
    if (this.included.has('documents') && docs.length) {
      const label = (s: string) => s.replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
      const toc = docs.map(d => {
        const topics = [...new Set(d.meta.sections.filter(s => !s.path.includes(' > ') && s.heading !== d.meta.title).map(s => label(s.heading)))].slice(0, 8);
        return `${label(d.meta.title)} — ${d.meta.pageCount} pages${topics.length ? ` (topics: ${topics.join(', ')})` : ''}`;
      }).join('\n');
      result.push(sourceInfo('documents', toc));
    }
    return result;
  }
  schemas() {
    const names = new Set(this.sources().flatMap(s => s.tools));
    return tools.filter(t => names.has(t.function.name)).map(t => t.function.name === 'read_file' ? { ...t, function: { ...t.function, parameters: { ...t.function.parameters, properties: { ...t.function.parameters.properties, filename: { ...t.function.parameters.properties.filename, enum: this.resources.map(r => r.name) } } } } } : t);
  }
  coverageKey(question: string) { return [question, this.sources().map(s => s.name).sort().join(','), this.active.map(a => a.digest).sort().join(',')].join('|'); }
  private async index(signal?: AbortSignal) {
    const entries = await Promise.all(this.active.filter(a => this.store.getManifest(a.digest)?.config.mediaType === 'application/vnd.lloyal.document.v1+json').map(a => {
      let promise = this.documents.get(a.digest);
      if (!promise) {
        promise = (async () => { const [document] = loadDocuments(this.store, [a]); const doc = { ...document, id: idOf(a) }; const chunks = await fitChunks(document.chunks.map(c => ({ ...c, resource: doc.id })), { maxTokens: 256, tokenize: t => this.ranker.tokenize(t, signal) }); return { doc, chunks }; })();
        this.documents.set(a.digest, promise); void promise.catch(() => this.documents.delete(a.digest));
      }
      return promise;
    }));
    return { docs: entries.map(e => e.doc), chunks: entries.flatMap(e => e.chunks) };
  }
  private put(input: Omit<Receipt, 'id'>): Receipt { const r = { ...input, id: `${input.inquiry}/${this.receipts.size}` }; this.receipts.set(r.id, r); this.emit('evidence.receipt', r, r.inquiry); return r; }
  async imageReceipt(inquiry: string, path: string, source: string, page?: number): Promise<Receipt> { const bytes = await readFile(path), meta = await sharp(bytes).metadata(); return this.put({ inquiry, source, path, digest: digest(bytes), kind: 'image', width: meta.width, height: meta.height, page, status: 'selected' }); }
  async bitmapReceipt(inquiry: string, root: Descriptor, source: string, page?: number) {
    const manifest = this.store.getManifest(root.digest); if (!manifest) throw new Error('Missing image manifest');
    const representation = representationsOf(manifest).find(r => r.mediaType.startsWith('image/')); if (!representation) throw new Error('No projectable representation');
    const bytes = this.store.get(representation.digest); if (!bytes) throw new Error('Missing image bytes');
    const path = resolve(this.dir, 'observed-images', representation.digest.slice(7) + '.png');
    await mkdir(resolve(this.dir, 'observed-images'), { recursive: true });
    // Concurrent inquiries may publish the same image. Readers must only see complete bytes.
    const temporary = `${path}.${randomUUID()}.tmp`;
    try { await writeFile(temporary, bytes, { flag: 'wx' }); await rename(temporary, path); }
    finally { await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; }); }
    const receipt = await this.imageReceipt(inquiry, path, source, page); receipt.attachment = root; return receipt;
  }
  async inputImages(inquiry: string) {
    const result: Receipt[] = [];
    for (const root of this.active) if (representationsOf(this.store.getManifest(root.digest)!).some(r => r.mediaType.startsWith('image/'))) result.push(await this.bitmapReceipt(inquiry, root, root.digest));
    return result;
  }
  submit(receipts: Receipt[], requestId: string) { for (const receipt of receipts) { const r: Receipt = { ...receipt, status: 'submitted', requestId }; this.receipts.set(r.id, r); this.emit('evidence.receipt', r, r.inquiry); } }
  private past(history: Message[], tool: string): any[] {
    const out: any[] = [];
    for (let i = 0; i < history.length - 1; i++) for (const call of history[i].tool_calls ?? []) {
      if (call.function.name !== tool) continue;
      const resultAt = history.findIndex((m, j) => j > i && m.role === 'tool' && m.tool_call_id === call.id);
      if (resultAt < 0 || !history.slice(resultAt + 1).some(m => m.role === 'assistant')) continue;
      try { if (!JSON.parse(String(history[resultAt].content)).error) out.push(JSON.parse(call.function.arguments)); } catch {}
    }
    return out;
  }
  private async ranked(query: string, chunks: Chunk[], inquiry: string, signal?: AbortSignal, indexChunks=chunks) {
    const at = performance.now();
    let candidates = chunks;
    if (chunks.length > 100) { const lexical = new BM25Index(indexChunks.map(c => c.tokens)); const qt = await this.ranker.tokenize(query, signal); const inScope=new Set(chunks); candidates = lexical.score(qt).map(h => indexChunks[h.index]).filter(c=>inScope.has(c)).slice(0,100); }
    const scores = await this.ranker.score(query, candidates.map(c => c.text), signal);
    const ranked = candidates.map((chunk, i) => ({ chunk, score: scores[i] })).sort((a, b) => b.score - a.score);
    const selected: typeof ranked = []; let tokens = 0;
    for (const row of ranked) { if (selected.length >= 5 || tokens + row.chunk.tokens.length > 2048) break; selected.push(row); tokens += row.chunk.tokens.length; }
    this.emit('retrieval.ranking', { query, method: 'BM25 candidate cap 100 → stock HTTP Qwen3 cross-encoder; local query only', totalScored: candidates.length, admittedTokens: tokens, rows: ranked.map(r => ({ file: r.chunk.resource, heading: r.chunk.heading, startLine: r.chunk.startLine, score: r.score, selected: selected.includes(r) })) }, inquiry);
    return { __ranking: { query, selectedPassageCount: selected.length, totalChars: selected.reduce((n,r)=>n+r.chunk.text.length,0), durationMs: performance.now()-at, topResults: ranked.map(({chunk:c,score})=>({heading:c.heading,file:c.resource,section:c.section,snippet:c.text.slice(0,200),score,startLine:c.startLine,endLine:c.endLine})), topK:5, tokenBudget:2048, admittedTokens:tokens, totalScored:candidates.length }, totalScored: candidates.length, hits: selected.map(({ chunk: c, score }) => ({ file: c.resource, heading: c.heading, section: c.section, startLine: c.startLine, endLine: c.endLine, snippet: c.text.slice(0, 200), score })) };
  }
  async execute(name: string, args: any, inquiry: string, history: Message[] = [], signal?: AbortSignal): Promise<ToolResult> {
    signal?.throwIfAborted(); await sleep(this.delayMs);
    if (!this.schemas().some(t => t.function.name === name)) throw new Error(`Unavailable tool: ${name}`);
    let result: any; const images: Receipt[] = [], attachments: Descriptor[] = [];
    if (name === 'search' || name === 'search_documents') {
      if (!args.query?.trim()) result = { error: 'query must not be empty' };
      else if (name === 'search') result = await this.ranked(args.query.trim(), this.chunks, inquiry, signal);
      else { const index = await this.index(signal); const scope = args.document ? index.docs.find(d => d.id === args.document || d.meta.title.toLowerCase() === String(args.document).trim().toLowerCase()) : undefined;
        if (args.document && !scope) result = { error: `Unknown document: ${args.document}` };
        else { result = await this.ranked(args.query.trim(), index.chunks.filter(c => !scope || c.resource === scope.id), inquiry, signal, index.chunks); result.hits = result.hits.map((hit: any) => { const d = index.docs.find(d => d.id === hit.file)!; const span = pagesOf(d.meta, hit.startLine, hit.endLine); return { ...hit, document: d.meta.title, id: d.id, ...span, cite: cite(d, span.pageStart) }; }); }
      }
    } else if (name === 'grep') {
      if (!args.pattern?.trim()) result = { error: 'pattern must not be empty' };
      else { let re: RegExp; try { re = new RegExp(args.pattern.trim(), args.ignoreCase === false ? 'g' : 'gi'); } catch { re = /(?!) /g; result = { error: `Invalid regex: ${args.pattern}` }; }
        if (!result) { const matches: any[] = []; let totalMatches = 0;
          for (const resource of this.resources) resource.content.split('\n').forEach((line, i) => { const hits = line.match(re); if (!hits) return; totalMatches += hits.length; const raw = line.trim(), start = Math.max(0, raw.search(re) - 40), end = Math.min(raw.length, start + 200); matches.push({ file: resource.name, line: i + 1, text: raw.length <= 200 ? raw : `${start ? '…' : ''}${raw.slice(start, end)}${end < raw.length ? '…' : ''}` }); });
          result = { totalMatches, matchingLines: matches.length, truncated: matches.length > 50, matches: matches.slice(0, 50), ...(totalMatches === 0 ? { note: 'Zero matches does NOT mean the topic is absent — only that this exact pattern was not found. Try search() for semantic matching or a broader/simpler regex.' } : {}) };
        }
      }
    } else if (name === 'read_file') {
      const filename = args.filename || args.path, resource = this.resources.find(r => r.name === filename);
      if (!resource) result = { error: `File not found: ${filename}. Available: ${this.resources.map(r => r.name).join(', ')}` };
      else { const lines = resource.content.split('\n'), span = (a: any): [number, number] => [Math.max(0, (a.startLine ?? 1) - 1), Math.min(lines.length, a.endLine ?? Math.min(100, lines.length))]; const [s, e] = span(args);
        const unread = subtractRanges([s, e], mergeRanges(this.past(history, name).filter(a => (a.filename || a.path) === filename).map(span).filter(([a, b]) => b > a)));
        const current = this.chunks.find(c => c.resource === filename && c.startLine - 1 <= s && c.endLine >= e), section = current?.section ?? '', parent = section.includes(' > ') ? section.slice(0, section.lastIndexOf(' > ')) : '';
        const words = (current?.heading ?? '').toLowerCase().split(/[\s>_\-./]+/).filter(w => w.length >= 3);
        const sameFile=this.chunks.filter(c=>c.resource===filename && c.section && c.section!==section && c.startLine!==current?.startLine && (parent?c.section.startsWith(parent+' > ')||c.section===parent:!c.section.includes(' > ')));
        const crossFile=this.chunks.filter(c=>c.resource!==filename&&c.section&&words.some(w=>c.heading.toLowerCase().includes(w)||c.section.toLowerCase().includes(w)));
        const related=[...sameFile,...crossFile];
        result = unread.length ? { file: filename, lines: unread.map(([a, b]) => `${a + 1}-${b}`), content: unread.map(([a, b]) => lines.slice(a, b).join('\n')).join('\n...\n'), relatedSections: [...new Map(related.map(c => [`${c.resource}:${c.startLine}`, c])).values()].slice(0, 8).map(c => ({ file: c.resource, heading: c.heading, section: c.section, startLine: c.startLine, endLine: c.endLine })) } : { file: filename, note: `Lines ${s + 1}-${e} already read` };
      }
    } else {
      const index = await this.index(signal), find = (value: any) => index.docs.find(d => d.id === value || d.meta.title.toLowerCase() === String(value).trim().toLowerCase()), doc = find(args.document);
      if (!doc) result = { error: `Unknown document: ${args.document}. Attached: ${index.docs.map(d => `${d.meta.title} (${d.id})`).join(', ')}` };
      else if (name === 'read_document') {
        const lines = doc.resource.content.split('\n');
        const span = (a: any): [number, number] | null => { if (typeof a.page === 'number') { const p = doc.meta.pages.find(p => p.page === a.page); if (!p) return null; const covering = doc.meta.sections.filter(s => s.pageStart <= p.page && p.page <= s.pageEnd); return [covering.length ? Math.min(...covering.map(s => s.startLine)) - 1 : p.startLine - 1, covering.length ? Math.max(...covering.map(s => s.endLine)) : p.endLine]; } const start = Math.max(0, (a.startLine ?? 1) - 1); return [start, Math.min(lines.length, a.endLine ?? start + 100)]; };
        const requested = span(args);
        if (!requested) result = { error: `Page ${args.page} is out of range: ${doc.meta.pageCount} pages` };
        else { const [s, e] = requested, previous = this.past(history, name).filter(a => find(a.document)?.id === doc.id).map(span).filter((s): s is [number, number] => !!s), unread = subtractRanges(requested, mergeRanges(previous)), where = pagesOf(doc.meta, s + 1, e);
          result = unread.length ? { document: doc.meta.title, id: doc.id, lines: unread.map(([a, b]) => `${a + 1}-${b}`), ...where, cite: cite(doc, where.pageStart), content: unread.map(([a, b]) => lines.slice(a, b).join('\n')).join('\n...\n') } : { document: doc.meta.title, id: doc.id, note: `Lines ${s + 1}-${e} already read` };
        }
      } else {
        const page = doc.meta.pages.find(p => p.page === args.page), where = { document: doc.meta.title, id: doc.id, page: args.page };
        if (!page) result = { error: `Page ${args.page} is out of range: ${doc.meta.pageCount} pages` };
        else { const figures = doc.meta.figures.filter(f => f.page === page.page), figure = args.figure !== undefined ? figures[args.figure - 1] : undefined;
          const again = this.past(history, name).some(a => find(a.document)?.id === doc.id && a.page === page.page && a.figure === args.figure);
          if (args.figure !== undefined && !figure) result = { error: `Page ${page.page} has ${figures.length} figures` };
          else if (args.figure === undefined && !(page.page === 1 || page.chars === 0 || page.imageObjects || page.pathObjects >= 20 || page.taggedTables || page.taggedFigures)) result = { ...where, note: `Page ${page.page} is text only — read_document gives you its text.` };
          else { const root = figure?.root ?? page.render; if (!root) result = { ...where, note: `Page ${page.page} is not archived as an image.` };
            else { images.push(await this.bitmapReceipt(inquiry, root, doc.meta.title, page.page)); attachments.push(root); result = { ...where, ...(again ? { note: `You viewed page ${page.page} before.` } : {}), ...(figure ? { figure: args.figure, caption: figure.caption } : {}), cite: cite(doc, page.page), attachments: [root] }; }
          }
        }
      }
    }
    const ranking=result.__ranking; delete result.__ranking;
    const text = JSON.stringify(result); const receipt = this.put({ inquiry, source: name, text, digest: digest(text), kind: 'text', status: 'selected' });
    return { text, images, attachments, receipts: [receipt, ...images], ...(ranking?{ranking}:{}) };
  }
  async imageMessages(receipts: Receipt[]): Promise<Message[]> { if (!receipts.length) return []; return [{ role: 'user', content: await Promise.all(receipts.flatMap(r => [Promise.resolve({ type: 'text', text: `Visual evidence: ${r.source}` }), readFile(r.path!).then(bytes => ({ type: 'image_url', image_url: { url: `data:image/png;base64,${bytes.toString('base64')}` } }))])) }]; }
  async inspect(id: string) { const r = this.receipts.get(id); if (!r) throw new Error(`Unknown receipt ${id}`); const bytes = r.kind === 'text' ? r.text! : await readFile(r.path!); if (digest(bytes) !== r.digest) throw new Error(`Receipt digest mismatch: ${id}`); this.emit('inspection.resolved', { ...r, verified: true }, r.inquiry); return r; }
}
