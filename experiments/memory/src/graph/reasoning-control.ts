import { SystemMessage, type BaseMessage } from '@langchain/core/messages';
import type { Config } from '../types.js';
import type { ModelCall } from './contracts.js';

/** Stable system prefix followed by the original stage instruction. No evidence is removed. */
export function sharedPrefixMessages(messages: BaseMessage[], header: string): BaseMessage[] {
  if (!header) throw new Error('Shared-prefix arm requires the current Fieldnote brief and catalog');
  const first = messages[0];
  if (first?.type !== 'system' || typeof first.content !== 'string') throw new Error('Expected a text system instruction');
  // The catalog was already at the beginning of inquiry/preflight instructions.
  // Preserve the complete original instruction, including that repetition, for auditability.
  return [new SystemMessage(header + '\n\n# Current stage instructions\n' + first.content), ...messages.slice(1)];
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
