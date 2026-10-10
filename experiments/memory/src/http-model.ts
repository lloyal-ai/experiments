import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Emit } from './types.js';
export type Message = { role: 'system' | 'user' | 'assistant' | 'tool'; content: any; tool_calls?: ToolCall[]; tool_call_id?: string };
export type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };
export type ToolSchema = { type: 'function'; function: { name: string; description: string; parameters: any } };

/** Incremental SSE parsing: arbitrary UTF-8/network chunk boundaries, multiple data lines, final buffer. */
export async function* sseData(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.getReader(), decoder = new TextDecoder(); let pending = '';
  try {
    for (;;) {
      const { value, done } = await reader.read(); pending += done ? decoder.decode() : decoder.decode(value, { stream: true });
      pending = pending.replace(/\r\n/g, '\n');
      let at: number;
      while ((at = pending.indexOf('\n\n')) >= 0) { const block = pending.slice(0, at); pending = pending.slice(at + 2); const data = block.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n'); if (data) yield data; }
      if (done) { if (pending.startsWith('data:')) yield pending.slice(5).trim(); break; }
    }
  } finally { reader.releaseLock(); }
}

export class HttpModel {
  constructor(private baseUrl: string, private dir: string, private emit: Emit, private maxTokens: number) {}
  async chat(messages: Message[], options: { inquiry: string; tools?: ToolSchema[]; signal?: AbortSignal; slot?: number; maxTokens?: number; onText?: (text: string) => void; onRequest?: (id: string) => void; toolChoice?: any; jsonSchema?: any }): Promise<Message> {
    const id = randomUUID();
    const body: any = { model: 'benchmark', messages, stream: true, stream_options: { include_usage: true }, temperature: 0, seed: 1000, max_tokens: options.maxTokens ?? this.maxTokens, cache_prompt: true, chat_template_kwargs: { enable_thinking: false }, ...(options.slot !== undefined ? { id_slot: options.slot } : {}), ...(options.tools?.length ? { tools: options.tools, tool_choice: options.toolChoice ?? 'auto' } : {}), ...(options.jsonSchema ? { response_format: { type: 'json_schema', json_schema: { name: 'plan', strict: true, schema: options.jsonSchema } } } : {}) };
    const serialized = JSON.stringify(body);
    await writeFile(resolve(this.dir, `request-${id}.json`), serialized);
    this.emit('model.request', { id, wireBytes: Buffer.byteLength(serialized), messageCount: messages.length, slot: options.slot }, options.inquiry);
    options.onRequest?.(id);
    let text = '', reason = '', first = true, usage: any = null, timings: any = null;
    const calls = new Map<number, ToolCall>(); let finishReason: string | null = null;
    try {
      const res = await fetch(`${this.baseUrl}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: serialized, signal: options.signal });
      if (!res.ok) throw new Error(`llama-server ${res.status}: ${(await res.text()).slice(0, 1600)}`);
      if (!res.body) throw new Error('Missing response body');
      for await (const data of sseData(res.body)) {
        if (data === '[DONE]') break;
        const chunk = JSON.parse(data); if (chunk.error) throw new Error(JSON.stringify(chunk.error));
        const choice = chunk.choices?.[0], delta = choice?.delta;
        if (first && (delta?.content || delta?.tool_calls || delta?.reasoning_content)) { first = false; this.emit('model.first_token', { id }, options.inquiry); }
        if (delta?.content) { text += delta.content; options.onText?.(text); }
        if (delta?.reasoning_content) reason += delta.reasoning_content;
        for (const c of delta?.tool_calls ?? []) {
          const old = calls.get(c.index) ?? { id: '', type: 'function' as const, function: { name: '', arguments: '' } };
          if (c.id) old.id = c.id;
          if (c.function?.name) old.function.name += c.function.name;
          if (c.function?.arguments) old.function.arguments += c.function.arguments;
          calls.set(c.index, old);
        }
        if (chunk.usage) usage = chunk.usage;
        if (chunk.timings) timings = chunk.timings;
        if (choice?.finish_reason) finishReason = choice.finish_reason;
      }
      const answer: Message = { role: 'assistant', content: text || null, ...(calls.size ? { tool_calls: [...calls.values()] } : {}) };
      await writeFile(resolve(this.dir, `response-${id}.json`), JSON.stringify({ answer, reason, usage, timings, finishReason }, null, 2));
      this.emit('model.end', { id, usage, timings, finishReason, contentChars: text.length, reasoningChars: reason.length }, options.inquiry);
      return answer;
    } catch (err) { this.emit('model.end', { id, aborted: options.signal?.aborted ?? false, partialChars: text.length, usage, timings, error: String(err) }, options.inquiry); throw err; }
  }
}
