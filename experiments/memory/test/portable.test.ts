import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {ROOT} from '../src/util.js';
import {parseMarkdown} from '../src/content/markdown.js';
import {fitChunks,splitParagraphs} from '../src/content/fit.js';
import {BM25Index} from '../src/content/bm25.js';
import {mergeRanges,subtractRanges} from '../src/content/ranges.js';
const pinned=createRequire(resolve(ROOT,'reference/fieldnote-app/package.json'));

test('portable Markdown addresses match the pinned utility on structural corpus cases (no model loaded)',()=>{
 // Test oracle only. This call parses Markdown; it creates no context, model or GPU queue.
 const native=pinned('@lloyal-labs/lloyal.node').loadBinary().parseMarkdown;
 for(const text of ['', '# One\nText\n','Before\n\n# One\nText\n\n## Two\nTail','Title\n=====\n\nBody\n\n## End\nMore','```md\n# Not a heading\n```\n\n# Real\nTail','# **Bold** and [linked](https://example.com)\nText','> ## In a quote\n> Body\n\n# Outside\nBody', '# Long\n'+('long line '.repeat(800))+'\n'])assert.deepEqual(parseMarkdown(text),native(text));
});
test('portable fitting, lexical ranking and range subtraction match pinned pure helpers',async()=>{
 const originalFit=pinned(resolve(ROOT,'reference/fieldnote-app/node_modules/@lloyal-labs/rig/dist/resources/fit.js'));const originalBM=pinned(resolve(ROOT,'reference/fieldnote-app/node_modules/@lloyal-labs/rig/dist/bm25.js'));const originalRanges=pinned(resolve(ROOT,'reference/fieldnote-app/node_modules/@lloyal-labs/rig/dist/ranges.js'));
 const lines=['# Heading','','first paragraph','','second paragraph that is long'];assert.deepEqual(splitParagraphs(lines),originalFit.splitParagraphs(lines));
 const chunk={resource:'sample.md',heading:'Heading',section:'Heading',text:lines.join('\n'),tokens:[],startLine:1,endLine:5};const options={maxTokens:12,tokenize:async(text:string)=>[...text].map(c=>c.charCodeAt(0))};assert.deepEqual(await fitChunks([chunk],options),await originalFit.fitChunks([chunk],options));
 const docs=[[1,2,2],[1,3,3,4],[],[9]];assert.deepEqual(new BM25Index(docs).score([2,1],3),new originalBM.BM25Index(docs).score([2,1],3));
 const ranges:[number,number][]=[[0,2],[1,4],[7,10]];assert.deepEqual(mergeRanges(ranges),originalRanges.mergeRanges(ranges));assert.deepEqual(subtractRanges([0,12],mergeRanges(ranges)),originalRanges.subtractRanges([0,12],originalRanges.mergeRanges(ranges)));
});
