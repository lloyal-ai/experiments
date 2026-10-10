import { Eta } from 'eta';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { INSTRUCTIONS } from '../reference/fieldnote-app/src/harness/instructions.js';
import { ROOT } from './util.js';

export { BUDGETS } from '../reference/fieldnote-app/src/harness/budgets.js';
export type SourceName = 'corpus' | 'documents';
export interface SourceInfo { name: SourceName; protocol: string; useWhen: string; tools: string[]; toc: string }
const eta = new Eta({ views: resolve(ROOT, 'reference/fieldnote-app/src/harness/prompts'), cache: false, autoEscape: false });
export const render = (name: string, input: object = {}) => eta.render(`${name}.eta`, { ...INSTRUCTIONS, ...input }).trim();
export const prompt = (name: string, input: object = {}) => ({ system: render(`${name}.system`, input), user: render(`${name}.user`, input) });
export function sourceInfo(name: SourceName, toc: string): SourceInfo {
  const manifest = JSON.parse(readFileSync(resolve(ROOT, `reference/abilities/${name}/ability.json`), 'utf8'));
  return { name, protocol: manifest.protocol.name, useWhen: manifest.protocol.useWhen, tools: manifest.protocol.tools, toc };
}
export function preamble(source: SourceInfo, tasks: { description: string }[], index: number, parallel: boolean, maxTurns: number) {
  const skill = readFileSync(resolve(ROOT, `reference/abilities/${source.name}/skill.eta`), 'utf8');
  return `Apply the **${source.protocol}** protocol.\n\n` + eta.renderString(skill, { maxTurns, date: new Date().toISOString().slice(0, 10), agentCount: parallel ? tasks.length : 1, siblingTasks: parallel ? tasks.filter((_, i) => i !== index).map(t => t.description) : [], taskIndex: parallel ? 0 : index });
}
export function sharedCatalog(sources: SourceInfo[]) {
  return 'You are an assistant working as part of a multi-agent workflow. You have access to the tools below, grouped by protocol. You should only use the tools for a given protocol when that particular protocol is requested explicitly in your task instructions.' +
    '\n\n# Protocols\n\n' + sources.map(s => `## ${s.protocol}\nTools: ${s.tools.join(', ')}\nUse when: ${s.useWhen}\n`).join('\n') +
    '\n# Tool selection rule\n\nThe agent system message will tell you which protocol to apply. Use only that protocol\'s tools. The agent system message also carries an engineered PROCESS that dictates intra-protocol ordering. Follow that PROCESS, but constrained to the assigned protocol\'s tools.' +
    sources.filter(s => s.toc.trim()).map(s => `\n\n# ${s.protocol} — available files\n${s.toc}`).join('');
}
