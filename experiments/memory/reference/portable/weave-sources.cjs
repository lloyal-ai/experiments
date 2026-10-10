"use strict";
/**
 * The citation weave: turns a report's `result` and its grammar-forced
 * `sources: [{ title, url }]` into already-inline-cited text, at capture. A
 * synthesizer mirrors the citation FORMAT of its input, so the durable way to
 * get inline citations is to seed them in the findings themselves.
 *
 * For each source: replace every BARE occurrence of the exact url with
 * `[title](url)`, skipping urls already inside a markdown link (preceded by
 * `](`) or in parentheses (preceded by `(`), and stopping at a url boundary so
 * a shorter source url that is a prefix of a longer url in the body is not
 * corrupted; then append a trailing `Sources:` list. Sources are de-duplicated
 * by url and processed LONGEST-url-first. Pure and defensive: a non-string
 * result or an empty, absent or non-array `sources` returns `result` unchanged.
 *
 * @category Rig
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.weaveSourcesIntoResult = weaveSourcesIntoResult;
// A source url must not wrap when the very next character continues a url — else
// a declared root like `https://a.io` would corrupt a longer body url such as
// `https://a.io/guide`, and a query string would be severed from its link. Two
// lookaheads: the next char is not a url-continuation char, and not a `.` that
// itself continues the url (a `.` at end of string or before whitespace is a
// sentence terminator, so a sentence-final url still wraps).
const URL_BOUNDARY = '(?![\\w/?#=&~%+@:-])(?!\\.[\\w/])';
function weaveSourcesIntoResult(result, sources) {
    if (typeof result !== 'string' || !Array.isArray(sources) || sources.length === 0) {
        return result;
    }
    const seen = new Set();
    const clean = [];
    for (const s of sources) {
        if (!s || typeof s !== 'object')
            continue;
        const rec = s;
        if (typeof rec.url !== 'string' || typeof rec.title !== 'string')
            continue;
        const url = rec.url.trim();
        const title = rec.title.trim();
        if (!url || !title || seen.has(url))
            continue;
        seen.add(url);
        clean.push({ url, title });
    }
    // Longest url first — a shorter prefix url must not corrupt a longer occurrence.
    clean.sort((a, b) => b.url.length - a.url.length);
    let out = result;
    const lines = [];
    for (const { url, title } of clean) {
        // Escape `[`/`]` in the title so a bracketed page title cannot break the link syntax.
        const safeTitle = title.replace(/[[\]]/g, '\\$&');
        const esc = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // Capture a preceding `](` (already a link target) or `(` (parens) so those
        // occurrences are left untouched; a bare occurrence has no prefix → wrap it.
        const re = new RegExp('(\\]\\(|\\()?' + esc + URL_BOUNDARY, 'g');
        out = out.replace(re, (m, pre) => (pre ? m : `[${safeTitle}](${url})`));
        lines.push(`- [${safeTitle}](${url})`);
    }
    if (lines.length > 0)
        out = out + '\n\nSources:\n' + lines.join('\n');
    return out;
}
//# sourceMappingURL=weave-sources.js.map