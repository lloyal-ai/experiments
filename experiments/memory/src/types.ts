export type AdapterName = 'fieldnote' | 'langgraph';
export type JourneyName = 'J1' | 'J1-investigate' | 'J2';
export type Event = { seq: number; t_ms: number; type: string; inquiry?: string; stage: string; data: any };
export type Emit = (type: string, data?: any, inquiry?: string) => Event;
export interface Config {
  fieldnoteRoot: string; serverBinary: string; serverRevision: string; model: string;
  projector: string; reranker: string; context: number; parallel: number; port: number;
  maxOutputTokens: number; maxToolTurns: number; timeoutMs: number; holdMs: number;
  toolLatencyMs: number; maxProcessRssBytes: number;
  memoryInstrumentation?: boolean; cpuDiagnostic?: boolean; fieldnotePort?: number; rerankerPort?: number;
}
export interface Task { id: string; description: string }
export interface Source { id: string; title: string; path: string; text: string; page?: number }
export interface Fixture {
  version: number; root: string; pdf: string; image: string; diagram: string;
  sources: Source[]; journeys: Record<JourneyName, { question: string; followup: string; tasks: Task[] }>;
  hashes: Record<string, string>;
}
export interface Receipt {
  id: string; inquiry: string; source: string; text?: string; path?: string;
  digest: string; kind: 'text' | 'image' | 'pdf'; width?: number; height?: number; page?: number;
  status: 'selected' | 'submitted' | 'prefilled'; requestId?: string;
  scores?: { query: string; method: string; rows: any[] };
  attachment?: import('@lloyal-labs/media').Descriptor;
}
export interface Adapter {
  name: AdapterName;
  start(): Promise<void>;
  ask(question: string, journey: JourneyName, followup?: boolean): Promise<void>;
  accept(tasks: Task[]): Promise<void>;
  hold(): Promise<void>;
  resume(): Promise<void>;
  cancel(inquiry: string): Promise<void>;
  closeBrief(): Promise<void>;
  inspect(id: string): Promise<Receipt>;
  stop(): Promise<void>;
  pids(): number[];
  receipts: Map<string, Receipt>;
}
