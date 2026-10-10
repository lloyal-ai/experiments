import { Lexer } from 'marked';

/** Markdown content work uses an ordinary JS parser, not a native model context. */
export function parseMarkdown(text: string) {
  if (!text) return [];
  const headings: { heading: string; level: number; startLine: number; endLine: number }[] = [];
  const plain = (tokens: any[]): string => tokens.map(t => t.tokens ? plain(t.tokens) : t.text ?? '').join('');
  let line = 1;
  for (const token of Lexer.lex(text)) {
    if (token.type === 'heading' && token.text) headings.push({ heading: plain(token.tokens ?? []), level: token.depth, startLine: line, endLine: 0 });
    line += (token.raw.match(/\n/g) ?? []).length;
  }
  if (!headings.length || headings[0].startLine > 1) headings.unshift({ heading: '', level: 0, startLine: 1, endLine: 0 });
  const lastLine = text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
  return headings.map((heading, i) => ({ ...heading, endLine: headings[i + 1] ? headings[i + 1].startLine - 1 : lastLine }));
}
