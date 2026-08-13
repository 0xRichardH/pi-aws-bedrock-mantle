/**
 * SigV4 signing core for bedrock-mantle.
 *
 * Two surfaces:
 *
 *   1. In-process: `signAndForward({ method, path, headers, body, region })`
 *      → Pure async function. Signs the request with SigV4, forwards to
 *        bedrock-mantle in the given region, returns a `Response`. No HTTP
 *        loopback, no port. This is the public library API for callers that
 *        want bedrock-mantle without the HTTP indirection.
 *
 *   2. HTTP loopback: `createSigningProxy(region, { port })`
 *      → A node http.Server that wraps signAndForward in an HTTP listener.
 *        Pi's existing OpenAI/Anthropic drivers consume this via baseUrl.
 *        Default `port: 0` binds an ephemeral port — each pi process owns
 *        its own, so credentials/state never leak across processes.
 *
 * Supported endpoints are us-east-1 (IAD) and us-east-2 (CMH). The extension
 * chooses the active region before creating a proxy; direct callers pass it.
 */
import { type Server } from "node:http";
export declare function parsePortEnv(name: string, defaultPort: number): number;
/**
 * Desired port for the configured region's proxy. `0` binds an ephemeral port
 * per pi process (recommended). Pin a fixed port only when an external consumer
 * needs a stable local URL.
 */
export declare const PROXY_PORT: number;
export interface SignAndForwardInput {
    /** HTTP method. Defaults to "POST" if not set. */
    method?: string;
    /** Path on the bedrock-mantle host (e.g. "/openai/v1/responses"). */
    path: string;
    /**
     * Request headers from the caller. Hop-by-hop and auth headers are dropped;
     * `x-*` and `anthropic-*` headers are forwarded.
     */
    headers?: Record<string, string | undefined>;
    /** Request body. May be a Buffer, string, or undefined. */
    body?: Buffer | string;
    /** Bedrock region — currently "us-east-1" or "us-east-2". */
    region: string;
}
/**
 * Sign and forward a single request to bedrock-mantle, returning the upstream
 * `Response` for the caller to consume (status, headers, streaming body).
 *
 * The returned `Response.body` is a `ReadableStream` — callers should read it
 * directly to preserve streaming preserves (no buffering for SSE responses).
 */
export declare function signAndForward(input: SignAndForwardInput): Promise<Response>;
export interface SigningProxy {
    /** The actual bound port (resolved from the OS when desiredPort=0). */
    readonly port: number;
    /** The underlying http.Server — used by tests and lifecycle hooks. */
    readonly server: Server;
    /** Tear down the listener. Returns once the socket is closed. */
    close(): Promise<void>;
}
/**
 * Bind a SigV4 signing proxy for the given region.
 *
 * @param region - Bedrock region, e.g. "us-east-2".
 * @param desiredPort - Port to bind. `0` (default) requests an ephemeral port
 *   from the OS, which is the recommended setting — each pi process owns its
 *   own listener with no cross-process state. Pass a fixed port only if an
 *   external consumer needs a stable URL.
 */
export declare function createSigningProxy(region: string, desiredPort?: number): Promise<SigningProxy>;
/**
 * @deprecated Use `createSigningProxy(region, port)` which returns the actual
 * bound port. Retained for backward compatibility with the existing public API
 * and tests.
 */
export declare function startProxy(port: number, region: string): Promise<void>;
