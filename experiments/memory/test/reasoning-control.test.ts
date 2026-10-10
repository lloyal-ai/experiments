import test from 'node:test';
import assert from 'node:assert/strict';
import {SystemMessage,HumanMessage} from '@langchain/core/messages';
import {sharedPrefixMessages,reasoningSampling} from '../src/graph/reasoning-control.js';
import type {Config} from '../src/types.js';
const config={reasoning:{arm:'shared-prefix',seed:4100,sampling:{temperature:0.5,topK:40,topP:0.95,minP:0.05},nativeBranches:8}} as Config;
test('shared-prefix layout retains stage instructions and original message objects without mutation',()=>{
 const tail=new HumanMessage('Actual evidence');const source=[new SystemMessage('Synthesis rules'),tail];
 const changed=sharedPrefixMessages(source,'Stable catalog and question');
 assert.equal(source[0].content,'Synthesis rules');assert.deepEqual(changed[1].content,[{type:'text',text:'# Current stage instructions\nSynthesis rules'},{type:'text',text:'Actual evidence'}]);
 assert.equal(changed[0].content,'Stable catalog and question');
 assert.throws(()=>sharedPrefixMessages(source,''));
});
test('explicit sampler parameters match native stage seeds and filters',()=>{
 const base={signal:new AbortController().signal,agentId:1};
 assert.equal(reasoningSampling(config,{...base,stage:'preflight',seed:2001})?.seed,2001);
 assert.equal(reasoningSampling(config,{...base,stage:'inquiry',seed:1001})?.seed,5101);
 const synth=reasoningSampling(config,{...base,stage:'synthesis'});
 assert.equal(synth?.seed,7100);assert.equal(synth?.temperature,.5);assert.equal(synth?.top_p,.95);assert.equal(synth?.repeat_penalty,1);
 assert.equal(reasoningSampling(config,{...base,stage:'planning'})?.temperature,.3);
 assert.equal(reasoningSampling({} as Config,base),undefined);
});
