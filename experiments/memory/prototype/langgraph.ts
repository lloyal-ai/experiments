import { Annotation, StateGraph, START, END, Send, MemorySaver } from '@langchain/langgraph';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import type { Adapter, Config, Emit, Fixture, JourneyName, Receipt, Task } from './types.js';
import { HttpModel, type Message } from './http-model.js';
import { Evidence, tools } from './evidence.js';
import { Controls } from './controls.js';
import { launchServer, stopChild } from './server.js';
import { errorText, jsonFile } from './util.js';

const Loop = Annotation.Root({
  messages: Annotation<Message[]>({ reducer: (a,b) => [...a,...b], default: () => [] }),
  turns: Annotation<number>({ reducer: (_,b) => b, default: () => 0 }),
});
const Research = Annotation.Root({
  tasks: Annotation<Task[]>,
  results: Annotation<{ id: string; text: string; canceled?: boolean }[]>({ reducer: (a,b) => [...a,...b], default: () => [] }),
  answer: Annotation<string>,
});
const Planner = Annotation.Root({ tasks: Annotation<Task[]> });

export class LangGraphAdapter implements Adapter {
  name = 'langgraph' as const;
  private server?: ChildProcess;
  private model!: HttpModel;
  private evidence: Evidence;
  private control = new Controls();
  private inflight = new Map<string, AbortController>();
  private canceled = new Set<string>();
  private bufferedDrafts = new Map<string, string>();
  private question = '';
  private journey: JourneyName = 'J1';
  private previousAnswer = '';
  private continuation: Message[] = [];
  private runPromise?: Promise<void>;
  private exchange = 0;
  private lifetime = new AbortController();
  get receipts() { return this.evidence.receipts; }
  constructor(private config: Config, private fixture: Fixture, private dir: string, private emit: Emit) {
    this.evidence = new Evidence(fixture, emit, () => this.question, config.toolLatencyMs);
  }
  async start() {
    await mkdir(resolve(this.dir, 'requests'), { recursive: true });
    this.server = await launchServer(this.config, this.dir, this.emit, this.lifetime.signal);
    this.model = new HttpModel(`http://127.0.0.1:${this.config.port}`, resolve(this.dir,'requests'), this.emit, this.config.maxOutputTokens);
    this.emit('capabilities', { runtime: 'standalone LangGraph JS', controls: 'normal graph nodes, async requests, AbortController, hold buffers in-flight output', fullInspector: false, missing: ['full-vocabulary entropy','physical KV ownership','live whole-process RSS'], retrieval: 'BM25 with explicit task/global relevance scores', checkpoint: 'LangGraph MemorySaver', thinking: false, cachePrompt: true });
    this.emit('ready');
  }
  pids() { return this.server?.pid ? [this.server.pid, process.pid] : [process.pid]; }
  async ask(question: string, journey: JourneyName, followup = false) {
    if (this.runPromise) throw new Error('A run is already active');
    this.question = question; this.journey = journey; this.control = new Controls(); this.canceled.clear(); this.exchange++;
    this.emit('query', { question, followup, journey });
    if (followup || journey === 'J2') {
      this.launch(async () => {
        const task = { id: 'task:0', description: question };
        const result = await this.research(task, '', followup);
        await this.settle(result.text);
      });
      return;
    }
    this.launch(async () => {
      const graph = new StateGraph(Planner).addNode('plan', async () => {
        const response = await this.model.chat([{ role:'system', content: 'Propose a short research plan using only the available sources. Return JSON matching the schema. Each task is a distinct objective. The user will review and edit this plan.' }, { role:'user', content: `${question}\nSource inventory:\n${this.evidence.inventory()}\nAttached PDF: Harbor Water Pilot, two pages including a routing figure; attached site-map image. Propose ${journey === 'J1' ? 4 : 3} tasks.` }], { inquiry: 'planner', slot: 0, maxTokens: 700, jsonSchema: { type:'object', properties: { tasks: { type:'array', items:{ type:'object', properties:{ description:{type:'string'} }, required:['description'], additionalProperties:false } } }, required:['tasks'], additionalProperties:false } });
        const parsed = JSON.parse(response.content ?? '{}');
        if (!Array.isArray(parsed.tasks) || !parsed.tasks.length) throw new Error('Planner produced no tasks');
        return { tasks: parsed.tasks.map((t:any,i:number) => ({ id:`task:${i}`, description:String(t.description) })) };
      }).addEdge(START,'plan').addEdge('plan',END).compile();
      const result = await graph.invoke({});
      this.emit('plan.review', { tasks: result.tasks, revision: this.exchange });
    });
  }
  private launch(work: () => Promise<void>) {
    this.runPromise = work().catch(e => { this.emit('run.error', { message:errorText(e) }); }).finally(() => { this.runPromise = undefined; });
  }
  async accept(tasks: Task[]) {
    await this.runPromise;
    this.emit('plan.accepted', { tasks });
    this.launch(async () => {
      let graph: any;
      if (this.journey === 'J1-investigate') {
        graph = new StateGraph(Research).addNode('investigate', async (state) => {
          const results: {id:string; text:string; canceled?:boolean}[] = [];
          for (const task of state.tasks) {
            if (this.control.closing) break;
            results.push(await this.research(task, results.map(r => r.text).join('\n\n')));
          }
          return { results };
        }).addNode('synthesize', async s => ({ answer: await this.synthesize(s.results) }))
          .addEdge(START,'investigate').addEdge('investigate','synthesize').addEdge('synthesize',END).compile({ checkpointer: new MemorySaver() });
      } else {
        graph = new StateGraph(Research).addNode('dispatch', () => ({}))
          .addNode('research', async (state: any) => ({ results: [await this.research(state.task, '')] }))
          .addNode('synthesize', async s => ({ answer: await this.synthesize(s.results) }))
          .addEdge(START,'dispatch').addConditionalEdges('dispatch', s => s.tasks.map(task => new Send('research', { task })), ['research'])
          .addEdge('research','synthesize').addEdge('synthesize',END).compile({ checkpointer: new MemorySaver() });
      }
      const result = await graph.invoke({ tasks }, { configurable: { thread_id: `brief-${this.exchange}` }, maxConcurrency: this.config.parallel });
      await this.settle(result.answer);
    });
  }
  private draft(inquiry: string, text: string) {
    if (this.canceled.has(inquiry)) return;
    if (this.control.held) this.bufferedDrafts.set(inquiry,text);
    else this.emit('section.update', { text }, inquiry);
  }
  private async research(task: Task, prior: string, followup = false): Promise<{ id:string; text:string; canceled?:boolean }> {
    const id = task.id, ctrl = new AbortController(); this.inflight.set(id,ctrl);
    this.emit('inquiry.status', { status: 'running', description: task.description }, id);
    const slot = Math.max(0, Number(id.split(':')[1]) || 0) % this.config.parallel;
    let messages: Message[] = [{ role:'system', content: `You write concise, grounded research briefs. Use tools to read actual evidence before stating findings. Cite source IDs in square brackets, and visual facts as [PDF p.2]. Inspect the figure with view_figure before describing its routes. Distinguish contradictions and unknowns. Write a short useful finding as soon as you have evidence; keep each final section under 200 words. Available sources:\n${this.evidence.inventory()}` }, { role:'user', content: this.question }];
    const pending: Receipt[] = [];
    if (followup && this.continuation.length) messages = [...this.continuation, {role:'user',content:this.question}];
    if (!followup && this.journey !== 'J2') {
      const image = await this.evidence.imageReceipt(id,this.fixture.image,'site-map.png');
      messages.push(...await this.evidence.imageMessages([image])); pending.push(image);
    }
    messages.push({ role:'user', content: `${prior ? 'Prior accepted findings:\n'+prior+'\n\n' : ''}Your inquiry: ${task.description}` });
    let lastDraft = '';
    const graph = new StateGraph(Loop)
      .addNode('model', async state => {
        await this.control.boundary(ctrl.signal);
        if (this.control.closing) return { messages: [], turns: this.config.maxToolTurns };
        messages = state.messages;
        const response = await this.model.chat(state.messages, { inquiry:id, slot, tools, signal:ctrl.signal, onRequest: requestId => this.evidence.submit(pending.splice(0),requestId), onText:text => { lastDraft = text; this.draft(id,text); } });
        await this.control.boundary(ctrl.signal);
        messages = [...state.messages,response];
        return { messages:[response], turns: state.turns + 1 };
      })
      .addNode('tools', async state => {
        const results: Message[] = [], images: Receipt[] = [], admitted: Receipt[] = [];
        for (const call of state.messages.at(-1)?.tool_calls ?? []) {
          await this.control.boundary(ctrl.signal); if (this.control.closing) break;
          this.emit('tool.start', { id:call.id, name:call.function.name, args:call.function.arguments }, id);
          try {
            const result = await this.evidence.execute(call.function.name,JSON.parse(call.function.arguments),id);
            this.emit('tool.end', { id:call.id, name:call.function.name, chars:result.text.length },id);
            await this.control.boundary(ctrl.signal);
            results.push({ role:'tool', tool_call_id:call.id, content:result.text }); images.push(...result.images); admitted.push(...result.receipts);
          } catch(e) {
            if(ctrl.signal.aborted) throw e;
            results.push({ role:'tool', tool_call_id:call.id, content:`Tool error: ${errorText(e)}` });
            this.emit('tool.error',{id:call.id,message:errorText(e)},id);
          }
        }
        results.push(...await this.evidence.imageMessages(images));
        pending.push(...admitted);
        messages = [...state.messages,...results];
        return { messages:results };
      })
      .addEdge(START,'model')
      .addConditionalEdges('model', state => this.control.closing || state.turns >= this.config.maxToolTurns || !state.messages.at(-1)?.tool_calls?.length ? END : 'tools', ['tools',END])
      .addEdge('tools','model').compile({ checkpointer:new MemorySaver() });
    try {
      const result = await graph.invoke({ messages }, { configurable:{ thread_id:`${this.exchange}/${id}` }, recursionLimit: this.config.maxToolTurns*2+4 });
      messages = result.messages;
      if (this.control.closing || messages.at(-1)?.tool_calls?.length) lastDraft = await this.recover(id,messages,slot);
      else lastDraft = String(messages.at(-1)?.content ?? lastDraft);
      if (this.canceled.has(id)) return { id,text:'',canceled:true };
      if (this.journey === 'J2' || followup) this.continuation = messages;
      this.emit('inquiry.status',{status:'completed'},id); return { id,text:lastDraft };
    } catch(e) {
      if (this.canceled.has(id)) return { id,text:'',canceled:true };
      if (this.control.closing) { lastDraft = await this.recover(id,messages,slot); this.emit('inquiry.status',{status:'completed',recovered:true},id); return { id,text:lastDraft }; }
      this.emit('inquiry.status',{status:'failed',error:errorText(e)},id); throw e;
    } finally { this.inflight.delete(id); }
  }
  private async recover(id:string,messages:Message[],slot:number) {
    this.emit('recovery.start',{},id);
    const usable = recoveryHistory(messages);
    const res = await this.model.chat([...usable,{role:'user',content:'The user has closed the brief. Give the concise cited findings supported by evidence already supplied. State missing evidence plainly; do not start more research.'}], { inquiry:id,slot,onText:text=>this.draft(id,text),maxTokens:650 });
    this.emit('recovery.end',{},id); return String(res.content ?? '');
  }
  private async synthesize(results:{id:string;text:string;canceled?:boolean}[]) {
    await this.control.boundary();
    const useful = results.filter(r=>!r.canceled && r.text.trim());
    if (!useful.length) return '';
    const synthesisMessages: Message[] = [{role:'system',content:'Write a concise cited brief from the supplied findings. Preserve source references and disagreements. Do not invent facts or fill missing inquiry results. State partial coverage when work was canceled or closed early.'},{role:'user',content:`Question: ${this.question}\n\nFindings:\n${useful.map(r=>r.id+'\n'+r.text).join('\n\n')}`}];
    const res = await this.model.chat(synthesisMessages,{inquiry:'synthesis',slot:0,onText:text=>this.draft('synthesis',text)});
    this.continuation = [...synthesisMessages,res];
    return String(res.content ?? '');
  }
  private async settle(answer:string) {
    this.previousAnswer = answer;
    await jsonFile(resolve(this.dir,`brief-${this.exchange}.json`),{question:this.question,answer,receipts:[...this.receipts.values()]});
    await writeFile(resolve(this.dir,`brief-${this.exchange}.md`),answer);
    this.emit('document.saved',{exchange:this.exchange}); this.emit('answer',{text:answer}); this.emit('complete',{exchange:this.exchange});
  }
  async hold() { this.control.hold(); this.emit('control.held',{implementation:'finish in-flight HTTP requests into buffer; no new workflow steps',inferenceQuiescent:null}); }
  async resume() { this.control.resume(); this.emit('control.resumed'); for(const [id,text] of this.bufferedDrafts) this.draft(id,text); this.bufferedDrafts.clear(); }
  async cancel(inquiry:string) { this.canceled.add(inquiry); this.inflight.get(inquiry)?.abort(new Error('User canceled inquiry')); this.bufferedDrafts.delete(inquiry); this.emit('inquiry.status',{status:'canceled'},inquiry); }
  async closeBrief() { this.control.closing=true; this.control.resume(); for(const c of this.inflight.values()) c.abort(new Error('Close brief')); this.emit('control.closing'); }
  inspect(id:string) { return this.evidence.inspect(id); }
  async stop() { this.lifetime.abort(new Error('Run stopped'));this.control.resume(); for(const [id,c] of this.inflight) { this.canceled.add(id); c.abort(); } if(this.server) await stopChild(this.server); await this.runPromise; }
}

/** Interrupted tool batches must remain valid HTTP chat histories. Keep available evidence,
 * and add an explicit interruption result for each outstanding call instead of dropping it. */
export function recoveryHistory(messages:Message[]):Message[] {
  const result:Message[]=[];
  for(let i=0;i<messages.length;i++) {
    const message=messages[i];result.push(message);
    if(!message.tool_calls?.length)continue;
    const tools:Message[]=[];
    while(messages[i+1]?.role==='tool')tools.push(messages[++i]);
    for(const call of message.tool_calls)result.push(tools.find(t=>t.tool_call_id===call.id)??{role:'tool',tool_call_id:call.id,content:'The user closed the brief before this tool completed. No result is available.'});
  }
  return result;
}
