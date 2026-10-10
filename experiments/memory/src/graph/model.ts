import { ChatOpenAI } from '@langchain/openai';
import type { BaseMessage, AIMessageChunk } from '@langchain/core/messages';
import { AIMessage } from '@langchain/core/messages';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Config, Emit } from '../types.js';
import type { Model, ModelCall } from './contracts.js';

/** Standard LangChain Chat Completions client; logging observes bytes without altering prompts. */
export class LocalChatModel implements Model {
  constructor(private config: Config, private dir: string, private emit: Emit) {}
  async chat(messages: BaseMessage[], options: ModelCall): Promise<AIMessage> {
    const requestId = randomUUID(), at = performance.now();
    const folder=resolve(this.dir,'http'); await mkdir(folder,{recursive:true});
    const observedFetch: typeof fetch = async (input, init) => {
      const body=typeof init?.body==='string'?init.body:'';
      await writeFile(resolve(folder,requestId+'.request.json'),body);
      this.emit('http.request',{requestId,agentId:options.agentId,wireBytes:Buffer.byteLength(body),transport:'transcript-resent-over-HTTP'});
      options.onRequest?.(requestId);
      const response=await fetch(input,init);
      // Stream the exact response to disk in the same pull path; never an unbounded tee buffer.
      const file=await import('node:fs/promises').then(fs=>fs.open(resolve(folder,requestId+'.response.txt'),'w'));
      let closed=false;
      const close=async()=>{if(!closed){closed=true;await file.close();}};
      if(!response.body){await close();return response;}
      const reader=response.body.getReader();
      const decoder=new TextDecoder();let pending='';
      // Use one presentation callback for this provider extension. Do not also render additional_kwargs.
      const observe=(bytes:Uint8Array)=>{pending+=decoder.decode(bytes,{stream:true});let end:number;while((end=pending.indexOf('\n'))>=0){const line=pending.slice(0,end).trim();pending=pending.slice(end+1);if(!line.startsWith('data:')||line==='data: [DONE]')continue;let data:any;try{data=JSON.parse(line.slice(5));}catch{continue;}const text=data.choices?.[0]?.delta?.reasoning_content;if(!options.signal.aborted&&typeof text==='string'&&text)options.onReasoning?.(text);}};
      return new Response(new ReadableStream({
        async pull(controller){try{const {done,value}=await reader.read();if(done){await close();controller.close();}else{await file.write(value);observe(value);controller.enqueue(value);}}catch(e){await close();controller.error(e);}},
        async cancel(reason){try{await reader.cancel(reason);}finally{await close();}}
      }),{status:response.status,statusText:response.statusText,headers:response.headers});
    };
    const model=new ChatOpenAI({model:'local',apiKey:'local',temperature:options.temperature??0.8,
      maxRetries:0,streamUsage:true,useResponsesApi:false,
      configuration:{baseURL:`http://127.0.0.1:${this.config.port}/v1`,fetch:observedFetch},
      modelKwargs:{cache_prompt:true,chat_template_kwargs:{enable_thinking:options.thinking??true},...(options.seed!==undefined?{seed:options.seed}:{})}
    });
    // This stock server revision accepts auto/none/required, not OpenAI's named-tool object.
    // A singleton tool list + required is its supported way to force planning/recovery.
    const namedTool=options.toolChoice&&!['auto','none','required'].includes(options.toolChoice)?options.toolChoice:undefined;
    const tools=namedTool?options.tools?.filter(t=>t.function?.name===namedTool):options.tools;
    if(namedTool&&tools?.length!==1)throw new Error('Requested tool is not uniquely registered: '+namedTool);
    const choice=namedTool?'required':options.toolChoice;
    if(options.responseSchema&&tools?.length)throw new Error('Use either a response schema or tools for this call');
    const bound=tools?.length?model.bindTools(tools,{...(choice?{tool_choice:choice}:{})}):model;
    let full:AIMessageChunk|undefined;
    try {
      for await(const chunk of await bound.stream(messages,{signal:options.signal,
        ...(options.responseSchema?{response_format:{type:'json_schema' as const,json_schema:{...options.responseSchema,strict:true}}}:{})})) {
        options.signal.throwIfAborted();full=full?full.concat(chunk):chunk;options.onChunk?.(chunk);
      }
      if(!full)throw new Error('Model returned an empty stream');
      this.emit('http.response',{requestId,agentId:options.agentId,durationMs:performance.now()-at,usage:full.usage_metadata,metadata:full.response_metadata});
      if(full.response_metadata?.finish_reason==='length')throw new Error('Model output reached the server context/output limit; incomplete output is not a successful report');
      return new AIMessage({content:full.content,tool_calls:full.tool_calls,invalid_tool_calls:full.invalid_tool_calls,usage_metadata:full.usage_metadata,response_metadata:full.response_metadata,additional_kwargs:full.additional_kwargs});
    }catch(error){this.emit('http.failure',{requestId,agentId:options.agentId,durationMs:performance.now()-at,error:String(error)});throw error;}
  }
}
