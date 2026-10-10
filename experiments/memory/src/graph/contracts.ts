import type { BaseMessage, AIMessage } from '@langchain/core/messages';
import type { Descriptor } from '@lloyal-labs/media';
import type { SourceInfo } from '../prompts.js';
export type WireEvent = { type: string; [key: string]: any };
export type Wire = (event: WireEvent) => void;
export type Effort = 'low' | 'medium' | 'high' | 'ultra';
export type ResearchTask = { description: string; ability?: string };
export type Plan = { intent: 'clarify' | 'research' | 'passthrough'; tasks: ResearchTask[]; clarifyQuestions: string[]; tokenCount: number; timeMs: number };
export interface Ask { docId: string; text: string; mode: 'flat' | 'deep'; effort: Effort; direct: boolean; followup: boolean; roots: Descriptor[]; history: BaseMessage[]; sources: SourceInfo[] }
export interface Finding { index: number; task: string; body: string; tokens: number; toolCalls: number; failed?: string }
export interface ModelCall { signal: AbortSignal; agentId: number; tools?: any[]; toolChoice?: string; responseSchema?: { name: string; schema: Record<string, any> }; temperature?: number; thinking?: boolean; seed?: number; onChunk?: (message: any) => void; onReasoning?: (text:string)=>void; onRequest?: (id: string) => void }
export interface Model { chat(messages: BaseMessage[], options: ModelCall): Promise<AIMessage> }
