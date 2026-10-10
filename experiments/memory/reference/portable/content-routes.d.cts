import type { IncomingMessage, ServerResponse } from 'node:http';
import { type Attachment } from '@lloyal-labs/media';
import type { AttachmentStore } from '@lloyal-labs/media';
/**
 * One request, reduced to what the route table actually reads.
 *
 * Not `IncomingMessage`: Electron's `protocol.handle` hands over a `Request`,
 * and neither shape is available to the other. Three fields is the whole
 * dependency, so taking them by value is what lets ONE table answer on a
 * socket and on a custom scheme without either knowing the other exists.
 *
 * @category Runtime
 */
export interface ContentRequest {
    method: string;
    /** Path ONLY — the adapter strips any query string. */
    path: string;
    /** The `If-None-Match` header verbatim, when the client sent one. */
    ifNoneMatch?: string;
}
/**
 * One answer, in the shape every transport can write.
 *
 * Deliberately NOT a union over outcome kind. A 404 and a 200 are the same
 * concern — a status, headers, and possibly bytes — differing only in value;
 * splitting them would make every adapter branch on a distinction it does not
 * act on. `body` absent means send none: a HEAD, or a 304. `headers` still
 * carries `Content-Length` in that case, because HEAD must declare the length
 * of the body it is not sending.
 *
 * CORS headers are NOT here. They are transport policy — an HTTP host has a
 * configured origin, a custom scheme's requests arrive with none — whereas
 * everything in this shape describes the CONTENT and is byte-identical
 * wherever it is served. Each adapter adds its own.
 *
 * @category Runtime
 */
export interface ContentReply {
    status: number;
    headers: Record<string, string>;
    body?: Uint8Array;
}
/**
 * Whether a path belongs to the content plane at all.
 *
 * The ONE place that answers it, so an adapter can decline a request before
 * doing any transport work and cannot drift from what {@link resolveContent}
 * will accept.
 *
 * @category Runtime
 */
export declare const isContentPath: (path: string) => boolean;
/**
 * The content plane's read routes: HTTP carries bytes, the WebSocket carries
 * references.
 *
 * ```
 * GET  /v1/media/<manifest>                     the manifest itself, by digest
 * GET  /v1/media/<manifest>/config              its typed config blob (a document's sidecar; OCI's empty blob for an image)
 * GET  /v1/media/<manifest>/source              the original as supplied, when the ingest retained it
 * GET  /v1/media/<manifest>/representations/<i> the bytes the model actually saw
 * HEAD /v1/content/<digest>                     existence, for pre-flight dedupe
 * ```
 *
 * `null` means the path is not ours at all, so a host can compose this with
 * whatever else it serves. Every other outcome is a {@link ContentReply},
 * including 405 — a path under our prefixes is answered here, never passed on.
 *
 * **A digest is identity, not authorization.** These routes authenticate
 * nothing; they are safe only behind the loopback default, a fronting proxy,
 * or a scheme reachable solely from the app's own renderers. There is
 * deliberately no enumeration route — HEAD answers about a digest you already
 * hold, and never lists what the store contains.
 *
 * **The ingress is not here.** Every route above is a READ, fully answerable
 * from the store. An upload is a WRITE, and both its bytes and its limits come
 * from the transport: a byte cap and a deadline on an HTTP host, a hand-off to
 * whichever process owns the store on a desktop scheme. So each adapter serves
 * `POST /v1/media/ingress` itself, under that same path — which is what lets a
 * client derive the ingress from its origin exactly as it derives the reads,
 * and stay ignorant of which target it is on. A marked door, not an oversight.
 *
 * **Nothing thrown here may escape.** A handler that threw inside a server's
 * `request` emit would become an uncaught exception and take the whole process
 * down — the resident model and every live Session with it. The `catch` is
 * here rather than in each adapter so that every adapter inherits it.
 *
 * @category Runtime
 */
export declare function resolveContent(req: ContentRequest, store: AttachmentStore): ContentReply | null;
/**
 * @category Runtime
 */
export interface ContentRoutesOpts {
    /** The project's content store. Reads resolve through it; nothing else. */
    store: AttachmentStore;
    /**
     * Normalize, commit, and return the root descriptor for an upload.
     *
     * Injected because the HTTP layer must not decide what "admitted" means, and
     * because normalization is a native dependency (`sharp`) that a harness
     * accepting no media should never load. **Absent ⇒ POST answers 501.** It
     * deliberately does NOT fall back to committing the raw bytes: an upload
     * that skipped normalization is not admitted content, and storing it as
     * though it were would put unvalidated pixels behind a digest the fold
     * trusts.
     *
     * **Bytes only, no declared type.** This route used to forward the request's
     * `Content-Type` header — a value the client writes and nothing verifies —
     * as authority over content the client did not produce. The bytes answer
     * that question, and the ingress is where they are decoded.
     */
    ingest?: (bytes: Uint8Array, signal?: AbortSignal) => Promise<Attachment>;
    /** Ceiling on a single upload body. @default 8 MiB — sized for an image. A
     *  host that installs the content ingress passes `MAX_DOCUMENT_BYTES` from
     *  `@lloyal-labs/media/node` beside `DOCUMENT_UPLOAD_TIMEOUT_MS`, so every
     *  host that mounts the plane admits the same. */
    maxUploadBytes?: number;
    /**
     * Ceiling on how long one upload may take, end to end.
     *
     * One deadline spans body transfer AND ingress: the signal handed to
     * `ingest` aborts at the same ceiling, so a completed body cannot hold the
     * handler while normalization queues behind other work. (A decode already
     * inside sharp has no abort — the 408 still goes out at the deadline; only
     * that decode runs on.)
     *
     * A byte cap alone does not bound a request: a client that opens a POST and
     * then trickles — or sends nothing at all — holds the promise, the socket and
     * the handler open indefinitely, and enough of them starve the host without
     * ever exceeding a single limit. Total duration rather than idle time,
     * because an idle timer is reset by exactly the one byte a slow-loris sends.
     *
     * @default 30s
     */
    uploadTimeoutMs?: number;
    /**
     * Exact origin permitted to call these routes cross-origin, e.g.
     * `http://localhost:5173`. Omitted ⇒ NO CORS headers at all, which is the
     * right default: in development Vite proxies content so requests stay
     * same-origin, and `*` on a route that serves a tenant's uploads is not a
     * default anyone should inherit.
     */
    allowedOrigin?: string;
}
/**
 * Mount the content plane on a Node `http.Server`, beside a `WebSocketServer`.
 *
 * Returns a predicate — true when it handled the request — so a host can
 * compose it with whatever else it serves. The reads are
 * {@link resolveContent}'s; this adds the three things that are HTTP's own:
 * CORS, the preflight, and `POST /v1/media/ingress`.
 *
 * @category Runtime
 */
export declare function createContentRoutes(opts: ContentRoutesOpts): (req: IncomingMessage, res: ServerResponse) => boolean;
//# sourceMappingURL=content-routes.d.ts.map