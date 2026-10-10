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
/** A structured source as the `report` output emits it. */
export interface WeaveSource {
    title: string;
    url: string;
}
export declare function weaveSourcesIntoResult(result: string, sources: unknown): string;
export declare function weaveSourcesIntoResult(result: unknown, sources: unknown): unknown;
//# sourceMappingURL=weave-sources.d.ts.map