/**
 * @module localSearch — the local sandbox's remote search stand-in, composed.
 *
 * ```
 * food ──signed GET──▶ edge (verifies the signature, keeps answers)
 *                        └─▶ the search function (the REAL handler, handed in)
 *                              └─▶ USDA double ◀── food's own USDA adapter, when a cook picks a hit
 * ```
 *
 * The edge is the same stand-in food's own suites use, so "food signs what it sends" is held by one model in both
 * places. The USDA double is served here too, because a pick makes food fetch the item from USDA itself; a sandbox
 * that stood only the search side up would reach api.nal.usda.gov, with a real key, the first time anyone tapped a
 * remote food.
 *
 * @pattern Facade — one start call over the edge, the function and the double
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { text } from 'node:stream/consumers';
import type { KeyObject } from 'node:crypto';

import { USDA_QUOTA_HEADERS } from '@kitchensink/usda-client';

import { startSearchEdgeStandIn, type SearchOrigin } from './searchEdgeStandIn.js';
import { createUsdaFixture, type UsdaFixture } from './usdaFixture.js';

/** The path prefix of the USDA API the double answers under, as the real base URL's. */
const USDA_PREFIX = '/fdc/v1';

/** What {@link startLocalSearch} needs. */
export interface LocalSearchOptions {
    /** The search function. In the sandbox it is the Lambda bundle's `handler`. */
    readonly handler: SearchOrigin;
    /** The trusted CloudFront public key. */
    readonly publicKey: KeyObject;
    /** Its key pair id. */
    readonly keyPairId: string;
    /** The edge's port. The signature covers the host and port, so food's `REMOTE_SEARCH_ORIGIN` must name this one. */
    readonly port?: number;
    /** The USDA double's port. */
    readonly usdaPort?: number;
}

/** A running stand-in. */
export interface LocalSearch {
    /** The edge's origin: what food's `REMOTE_SEARCH_ORIGIN` is. */
    readonly origin: string;
    /** The USDA double's base URL: what `USDA_API_BASE_URL` is, for the search function and for food. */
    readonly usdaBaseUrl: string;
    /** Stop both. */
    close(): Promise<void>;
}

/** The quota headers api.data.gov sends on every answer. */
const QUOTA = {
    [USDA_QUOTA_HEADERS.limitHeader]: '1000',
    [USDA_QUOTA_HEADERS.remainingHeader]: '999',
};

/**
 * Read a request body as JSON.
 *
 * @param request - The request.
 * @returns The parsed body, or `undefined` when it is empty or not JSON.
 * @sideEffect Consumes the request stream.
 */
async function jsonBody(request: IncomingMessage): Promise<unknown> {
    const raw = await text(request);

    try {
        const parsed: unknown = raw === '' ? undefined : JSON.parse(raw);

        return parsed;
    } catch {
        return undefined;
    }
}

/**
 * Answer one USDA request. The routes are the three the repo calls, and anything else is a `404`.
 *
 * @param usda - The double.
 * @param request - The request.
 * @param response - The response.
 * @sideEffect Consumes the request and writes the response.
 */
async function answerUsda(usda: UsdaFixture, request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://usda.invalid');
    const route = url.pathname.startsWith(USDA_PREFIX) ? url.pathname.slice(USDA_PREFIX.length) : undefined;
    const method = request.method ?? 'GET';

    const json = (status: number, body: unknown): void => {
        response.writeHead(status, { 'content-type': 'application/json', ...QUOTA }).end(JSON.stringify(body));
    };

    if (route === '/foods/search' && method !== 'POST') {
        json(405, { error: { code: 'METHOD_NOT_ALLOWED' } });

        return;
    }

    if (route === '/foods/search') {
        const body = await jsonBody(request);
        const query =
            typeof body === 'object' && body !== null && 'query' in body && typeof body.query === 'string'
                ? body.query
                : undefined;

        json(
            query === undefined ? 400 : 200,
            query === undefined ? { error: { code: 'BAD_REQUEST' } } : usda.search(query),
        );

        return;
    }

    if (method === 'POST' && route === '/foods') {
        const body = await jsonBody(request);
        const ids =
            typeof body === 'object' && body !== null && 'fdcIds' in body && Array.isArray(body.fdcIds)
                ? (body.fdcIds as unknown[]).filter((id): id is number => typeof id === 'number')
                : undefined;

        json(
            ids === undefined ? 400 : 200,
            ids === undefined ? { error: { code: 'BAD_REQUEST' } } : ids.flatMap((id) => usda.detail(id) ?? []),
        );

        return;
    }

    const single = method === 'GET' && route !== undefined ? /^\/food\/(\d+)$/u.exec(route)?.[1] : undefined;
    const food = single === undefined ? undefined : usda.detail(Number(single));

    json(food === undefined ? 404 : 200, food ?? { error: { code: 'NOT_FOUND' } });
}

/**
 * Listen on a loopback port.
 *
 * @param server - The server.
 * @param port - The port; 0 for an ephemeral one.
 * @returns The port bound.
 * @sideEffect Opens a listening socket.
 */
async function listen(server: Server, port: number): Promise<number> {
    await new Promise<void>((resolve) => {
        server.listen(port, '127.0.0.1', resolve);
    });

    const address = server.address();

    return typeof address === 'object' && address !== null ? (address satisfies AddressInfo).port : 0;
}

/**
 * Start the stand-in.
 *
 * @param options - The function, the trusted key, and the ports.
 * @returns The running stand-in.
 * @sideEffect Opens two listening sockets.
 */
export async function startLocalSearch(options: LocalSearchOptions): Promise<LocalSearch> {
    const usda = createUsdaFixture();
    const usdaServer = createServer((request, response) => {
        void answerUsda(usda, request, response).catch(() => {
            response.destroy();
        });
    });
    const usdaPort = await listen(usdaServer, options.usdaPort ?? 0);
    const edge = await startSearchEdgeStandIn({
        origin: options.handler,
        publicKey: options.publicKey,
        keyPairId: options.keyPairId,
        ...(options.port === undefined ? {} : { port: options.port }),
    });

    return {
        origin: edge.origin,
        usdaBaseUrl: `http://127.0.0.1:${String(usdaPort)}${USDA_PREFIX}`,
        async close() {
            await edge.close();
            await new Promise<void>((resolve) => {
                usdaServer.close(() => {
                    resolve();
                });
                usdaServer.closeAllConnections();
            });
        },
    };
}
