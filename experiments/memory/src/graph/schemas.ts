import { z } from 'zod';
// Declarative contract transcribed from the pinned rig/dist/tools/output.js. No native capture hooks.
export const citedSchema=z.object({
 result:z.string().describe('Detailed findings with direct quotes and data points. Cite each claim inline as [title](url) using the exact URL seen in tool results. Include what was found and what was not found.'),
 sources:z.array(z.object({title:z.string(),url:z.string()})).describe('Every source you used: exact title and exact URL as seen in tool results. Empty array only if no URL sources exist.')
});
export const citedDescription='Submit your final research findings with specific evidence, direct quotes, and data points. Cite each claim inline as [title](url) using the exact URL seen in tool results. Fill the sources field with the structured list of every source you used. State what you found AND what you checked but could not find. Do not summarize — preserve detail.';
export const reportTool=(probe=false)=>({type:'function',function:{name:'report',description:probe?'Submit your final research findings with specific evidence, direct quotes, data points, and source URLs from the pages you read. State what you found AND what you checked but could not find. Do not summarize — preserve detail.':citedDescription,parameters:probe?{type:'object',properties:{result:{type:'string'}},required:['result']}:z.toJSONSchema(citedSchema)}});
export const planSchema=(maxTasks:number,protocols:string[])=>z.object({intent:z.enum(['clarify','passthrough','research']),tasks:z.array(z.object({description:z.string(),...(protocols.length?{ability:z.enum(protocols as [string,...string[]])}:{})})).max(maxTasks).optional(),clarifyQuestions:z.array(z.string()).optional()});
