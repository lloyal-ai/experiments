import { createWriteStream, type WriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { Event } from './types.js';

export class EventLog {
  events: Event[] = [];
  stage = 'setup';
  private start = performance.now();
  private stream!: WriteStream;
  private listeners = new Set<(event: Event) => void>();
  private closed = false;
  private pending = new Set<(error:Error)=>void>();
  async open(dir: string) { await mkdir(dir, { recursive: true }); this.stream = createWriteStream(resolve(dir, 'events.jsonl')); }
  emit = (type: string, data: any = {}, inquiry?: string): Event => {
    const ev: Event = { seq: this.events.length, t_ms: performance.now() - this.start, type, stage: this.stage, data, ...(inquiry ? { inquiry } : {}) };
    if(this.closed)return ev;
    this.events.push(ev); this.stream.write(JSON.stringify(ev) + '\n');
    for (const listener of this.listeners) listener(ev);
    return ev;
  };
  on(listener: (event: Event) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  waitFor(predicate: (event: Event) => boolean, timeoutMs = 120000, afterSeq = -1): Promise<Event> {
    if(this.closed)return Promise.reject(new Error('Run log is closed'));
    const found = this.events.find(e => e.seq > afterSeq && (predicate(e)||e.type==='run.error'));
    if(found?.type==='run.error')return Promise.reject(new Error(found.data.message));
    if(found)return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); this.listeners.delete(listener);this.pending.delete(cancel); };
      const cancel=(error:Error)=>{cleanup();reject(error);};this.pending.add(cancel);
      const listener = (ev: Event) => { if (ev.seq > afterSeq && predicate(ev)) { cleanup(); resolve(ev); } else if (ev.type === 'run.error') { cleanup(); reject(new Error(ev.data.message)); } };
      const timer = setTimeout(() => { cleanup(); reject(new Error(`Event gate timed out after ${timeoutMs}ms`)); }, timeoutMs);
      this.listeners.add(listener);
    });
  }
  async close() { this.closed=true;for(const cancel of this.pending)cancel(new Error('Run finished'));await new Promise<void>((res, rej) => { this.stream.on('error', rej); this.stream.end(res); }); }
}

export interface ViewState {
  held: boolean; phase: string; tasks: Record<string, { status: string; text: string }>;
  evidence: Record<string, any>; answer: string; completed: boolean;
}
export const emptyView = (): ViewState => ({ held: false, phase: 'idle', tasks: {}, evidence: {}, answer: '', completed: false });
/** Projection only: never schedules, owns, cancels or recreates adapter work. */
export function reduceView(state: ViewState, ev: Event): ViewState {
  if (!['query','preflight.start','preflight.complete','plan.review','plan.accepted','control.held','control.resumed','inquiry.status','section.update','evidence.receipt','answer','complete'].includes(ev.type)) return state;
  const next = structuredClone(state);
  if (ev.type === 'query') { next.completed = false; next.answer = ''; next.tasks = {}; next.phase = 'working'; }
  if(ev.type==='preflight.start')next.phase='Browsing sources';
  if(ev.type==='preflight.complete')next.phase='Planning';
  if(ev.type==='plan.review')next.phase='Review plan';
  if(ev.type==='plan.accepted')next.phase='Writing';
  if (ev.type === 'control.held') next.held = true;
  if (ev.type === 'control.resumed') next.held = false;
  if (ev.type === 'inquiry.status' && ev.inquiry) next.tasks[ev.inquiry] = { text: next.tasks[ev.inquiry]?.text ?? '', status: ev.data.status };
  if (ev.type === 'section.update' && ev.inquiry) next.tasks[ev.inquiry] = { status: next.tasks[ev.inquiry]?.status ?? 'running', text: ev.data.text };
  if (ev.type === 'evidence.receipt') next.evidence[ev.data.id] = ev.data;
  if (ev.type === 'answer') next.answer = ev.data.text ?? '';
  if (ev.type === 'complete') { next.completed = true; next.phase = 'settled'; }
  return next;
}
