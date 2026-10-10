import { SystemMessage, HumanMessage, type BaseMessage } from '@langchain/core/messages';
import type { Config } from '../types.js';
import type { ModelCall } from './contracts.js';

/** Stable system prefix followed by the original stage instruction. No evidence is removed. */
export function sharedPrefixMessages(messages: BaseMessage[], header: string): BaseMessage[] {
  if (!header) throw new Error('Shared-prefix arm requires the current Fieldnote brief and catalog');
  const first = messages[0];
  if (first?.type !== 'system' || typeof first.content !== 'string') throw new Error('Expected a text system instruction');
  const result: BaseMessage[] = [new SystemMessage(header)];
  let pending: any[] = [{type:'text',text:'# Current stage instructions\n'+first.content}];
  const flush=()=>{if(pending.length){result.push(new HumanMessage({content:pending}));pending=[];}};
  // One ordinary multimodal user turn lets the server checkpoint the shared header.
  for(const message of messages.slice(1)) {
    if(message.type==='human')pending.push(...(typeof message.content==='string'?[{type:'text',text:message.content}]:message.content));
    else {flush();result.push(message);}
  }
  flush();return result;
}

export function reasoningSampling(config: Config, options: ModelCall) {
  const experiment = config.reasoning;
  if (!experiment) return undefined;
  const { sampling, seed } = experiment;
  return {
    temperature: options.stage === 'planning' ? 0.3 : sampling.temperature,
    seed: options.seed !== undefined ? options.seed + (options.stage === 'preflight' ? 0 : seed) : seed + (options.stage === 'synthesis' ? 3000 : options.stage === 'planning' ? 100 : 4000),
    top_k: sampling.topK, top_p: sampling.topP, min_p: sampling.minP, typical_p: 1,
    repeat_penalty: 1, presence_penalty: 0, frequency_penalty: 0, repeat_last_n: 64,
    samplers: ['penalties', 'top_k', 'typ_p', 'top_p', 'min_p', 'temperature'],
  };
}
