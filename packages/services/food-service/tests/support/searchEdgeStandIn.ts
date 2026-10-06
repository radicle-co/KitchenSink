/**
 * A loopback stand-in for the remote search service's CloudFront distribution (ADR-0055 points 2 and 7, review
 * rulings 5 to 7), in front of a function-URL-shaped origin. It models the parts food's protocol depends on:
 *
 * - **the trusted key group**: a request whose canned-policy signature does not verify, or has expired, is refused
 *   `403` with no request-id echo, as CloudFront refuses it before the origin;
 * - **the cache key**: the path and `q`, and nothing else (no `admit`, no `rid`, no signing parameter);
 * - **the TTLs**: a `200` is kept for its `s-maxage`; anything else, `no-store` or a response with no `Cache-Control`,
 *   is never kept (default TTL 0, error-caching TTL 0);
 * - **one origin attempt** per miss;
 * - **a viewer that leaves**: an object is kept only once the viewer has received all of it.
 *
 * It proves food's protocol against a model, not CloudFront; the deployed distribution is S7.10's to prove.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { KeyObject } from 'node:crypto';

import { checkSignedUrl } from './cloudFrontSignature.js';

/** The part of a function URL event an origin reads. A `LambdaFunctionURLEvent` carries it. */
export interface OriginEvent {
    readonly rawPath: string;
    readonly rawQueryString: string;
    readonly requestContext: { readonly http: { readonly method: string } };
}

/** A function URL result. */
export interface OriginResult {
    readonly statusCode: number;
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string;
}

/** The function behind the distribution. */
export type SearchOrigin = (event: OriginEvent) => Promise<OriginResult>;

/** A kept object. */
interface CachedObject {
    readonly result: OriginResult;
    /** When it stops being served, epoch milliseconds. */
    readonly expiresAt: number;
}

/** A running stand-in. */
export interface SearchEdgeStandIn {
    /** The origin to set as `REMOTE_SEARCH_ORIGIN`. */
    readonly origin: string;
    /** The cache keys of every request that reached the origin, in order. */
    readonly originRequests: string[];
    /** The time the stand-in reads for expiry, TTLs and signature checks, epoch milliseconds.
     *
     * Unassigned it follows the wall clock LIVE — a real-time tier (the e2e suite) relies on the kept
     * "not admitted" second lapsing while the caller really waits out
     * `REMOTE_SEARCH_NOT_ADMITTED_RETRY_DELAY_MS`. Assigned, it stands PINNED at the value until moved
     * again — the integration suites pin it and advance it by hand through their pause port.
     */
    now: number;
    /** Forget every kept object. */
    clear(): void;
    /** Stop listening. */
    close(): Promise<void>;
}

/** The query parameters the distribution forwards to the origin. */
const FORWARDED_PARAMETERS = ['q', 'admit', 'rid'] as const;

/**
 * The seconds a response may be kept, or 0. Pure.
 *
 * @param result - The origin's result.
 * @returns Its `s-maxage` for a `200` that names one and is not `no-store`, else 0.
 */
function ttlSecondsOf(result: OriginResult): number {
    const cacheControl = Object.entries(result.headers).find(([name]) => name.toLowerCase() === 'cache-control')?.[1];

    if (result.statusCode !== 200 || cacheControl === undefined || /no-store/iu.test(cacheControl)) {
        return 0;
    }

    const maxAge = /s-maxage=(\d+)/iu.exec(cacheControl)?.[1];

    return maxAge === undefined ? 0 : Number(maxAge);
}

/**
 * Send a result to the viewer.
 *
 * @param response - The viewer's response.
 * @param result - What to send.
 * @returns Whether the viewer received all of it.
 * @sideEffect Writes the response.
 */
async function sendTo(response: ServerResponse, result: OriginResult): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
        response.once('finish', () => resolve(true));
        response.once('close', () => resolve(response.writableFinished));
        response.writeHead(result.statusCode, { ...result.headers });
        response.end(result.body);
    });
}

/**
 * Start the stand-in on an ephemeral loopback port.
 *
 * @param options - The function behind it, and the key group it trusts.
 * @param options.origin - The function.
 * @param options.publicKey - The trusted public key.
 * @param options.keyPairId - Its id.
 * @param options.now - Pins the stand-in's clock at this value, epoch milliseconds; defaults to the live
 * wall clock, because the e2e tier's transport waits out the retry delay for real.
 * @returns The running stand-in.
 * @sideEffect Opens a listening socket.
 */
export async function startSearchEdgeStandIn(options: {
    readonly origin: SearchOrigin;
    readonly publicKey: KeyObject;
    readonly keyPairId: string;
    readonly now?: number;
}): Promise<SearchEdgeStandIn> {
    const cache = new Map<string, CachedObject>();
    const originRequests: string[] = [];
    let base = '';

    const serve = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
        const signed = `${base}${request.url ?? '/'}`;
        const check = checkSignedUrl(
            signed,
            { publicKey: options.publicKey, keyPairId: options.keyPairId },
            Math.floor(standIn.now / 1_000),
        );

        if (!check.ok) {
            await sendTo(response, { statusCode: 403, headers: { 'content-type': 'text/plain' }, body: check.refusal });

            return;
        }

        const url = new URL(check.resource);
        const cacheKey = `${url.pathname}?q=${url.searchParams.get('q') ?? ''}`;
        const kept = cache.get(cacheKey);

        if (kept !== undefined && kept.expiresAt > standIn.now) {
            await sendTo(response, kept.result);

            return;
        }

        const forwarded = new URLSearchParams();

        for (const name of FORWARDED_PARAMETERS) {
            for (const value of url.searchParams.getAll(name)) {
                forwarded.append(name, value);
            }
        }

        originRequests.push(cacheKey);

        const result = await options.origin({
            rawPath: url.pathname,
            rawQueryString: forwarded.toString(),
            requestContext: { http: { method: request.method ?? 'GET' } },
        });
        const ttlSeconds = ttlSecondsOf(result);
        const received = await sendTo(response, result);

        if (received && ttlSeconds > 0) {
            cache.set(cacheKey, { result, expiresAt: standIn.now + ttlSeconds * 1_000 });
        }
    };

    const server: Server = createServer((request, response) => {
        void serve(request, response).catch(() => {
            response.destroy();
        });
    });

    await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', resolve);
    });

    const address = server.address();
    const port = typeof address === 'object' && address !== null ? (address satisfies AddressInfo).port : 0;

    base = `http://127.0.0.1:${String(port)}`;

    let pinnedNow: number | undefined = options.now;

    const standIn: SearchEdgeStandIn = {
        origin: base,
        originRequests,
        get now(): number {
            return pinnedNow ?? Date.now();
        },
        set now(value: number) {
            pinnedNow = value;
        },
        clear(): void {
            cache.clear();
        },
        async close(): Promise<void> {
            await new Promise<void>((resolve) => {
                server.close(() => resolve());
                server.closeAllConnections();
            });
        },
    };

    return standIn;
}
