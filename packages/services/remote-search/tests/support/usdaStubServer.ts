/**
 * A loopback stand-in for USDA FoodData Central's search, for the suite that drives the real handler through the real
 * client. Every request that reaches it is recorded, so "the source was not called" is an assertion on what crossed
 * the wire. Every answer carries api.data.gov's quota headers, as the live API's do. Like the client (ADR-0055 point
 * 1), it takes a search only as a POST whose JSON body states the data types as an array, and answers anything else
 * `400`.
 *
 * Food-service's stub (`packages/services/food-service/tests/support/usdaStubServer.ts`) is not shared: it lives in
 * that service's test tree, sends no quota or `Retry-After` header, has no drifted-body mode, and keeps only the
 * `query` of each search, while this suite asserts on all of those.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { text } from 'node:stream/consumers';

import { USDA_QUOTA_HEADERS } from '@kitchensink/usda-client';
import { z } from 'zod';

import { makeUsdaSearchBody } from '../../src/sources/usda/__fixtures__/usdaSearchBody.js';

/** How the stub answers the next request. */
export type UsdaStubMode = 'hits' | 'empty' | 'throttled' | 'outage' | 'drift' | 'drop';

/** One request that reached the stub. */
export interface UsdaStubRequest {
    readonly method: string;
    readonly url: URL;
    /** The parsed JSON body, or `undefined` when the request had none or it was not JSON. */
    readonly body: unknown;
}

/** A running stub. */
export interface UsdaStubServer {
    /** The base URL to set as `USDA_API_BASE_URL`. */
    readonly baseUrl: string;
    /** How the stub answers; a suite sets it per case. */
    mode: UsdaStubMode;
    /** Every request that reached the stub, in order. */
    readonly requests: UsdaStubRequest[];
    /** Forget what reached the stub. */
    reset(): void;
    /** Stop listening. */
    close(): Promise<void>;
}

/**
 * The quota headers api.data.gov sends.
 *
 * @param remaining - The calls left in the key's window.
 * @returns The headers.
 */
function quota(remaining: number): Record<string, string> {
    return {
        [USDA_QUOTA_HEADERS.limitHeader]: '1000',
        [USDA_QUOTA_HEADERS.remainingHeader]: String(remaining),
    };
}

/** The search body USDA answers: the data types as an array. */
const searchBodySchema = z.object({ dataType: z.array(z.string()) });

/**
 * Read a request's body as JSON.
 *
 * @param request - The request.
 * @returns The parsed body, or `undefined` when it is empty or not JSON.
 * @sideEffect Consumes the request stream.
 */
async function bodyOf(request: IncomingMessage): Promise<unknown> {
    const raw = await text(request);

    try {
        const parsed: unknown = raw === '' ? undefined : JSON.parse(raw);

        return parsed;
    } catch {
        return undefined;
    }
}

/**
 * Whether a request is the search USDA answers. Pure.
 *
 * @param request - The recorded request.
 * @param contentType - Its `content-type` header.
 * @returns True for a POST to the search path with a JSON body whose `dataType` is an array.
 */
function isUsdaSearch(request: UsdaStubRequest, contentType: string | undefined): boolean {
    return (
        request.method === 'POST' &&
        request.url.pathname.endsWith('/foods/search') &&
        contentType === 'application/json' &&
        searchBodySchema.safeParse(request.body).success
    );
}

/**
 * Answer one request as the current mode says, once its body has been read.
 *
 * @param stub - The stub's state.
 * @param request - The request.
 * @param response - The response.
 * @sideEffect Consumes the request stream, then writes the response or destroys the socket for `drop`.
 */
async function answer(stub: UsdaStubServer, request: IncomingMessage, response: ServerResponse): Promise<void> {
    const recorded: UsdaStubRequest = {
        method: request.method ?? 'GET',
        url: new URL(request.url ?? '/', 'http://stub.invalid'),
        body: await bodyOf(request),
    };

    stub.requests.push(recorded);

    const json = { 'content-type': 'application/json' };

    if (!isUsdaSearch(recorded, request.headers['content-type'])) {
        response.writeHead(400, json).end(JSON.stringify({ error: { code: 'BAD_REQUEST' } }));

        return;
    }

    switch (stub.mode) {
        case 'hits':
            response.writeHead(200, { ...json, ...quota(997) }).end(JSON.stringify(makeUsdaSearchBody()));

            return;
        case 'empty':
            response.writeHead(200, { ...json, ...quota(996) }).end(JSON.stringify(makeUsdaSearchBody({ foods: [] })));

            return;
        case 'throttled':
            response.writeHead(429, { ...json, ...quota(0), 'Retry-After': '1800' }).end(
                JSON.stringify({
                    error: { code: 'OVER_RATE_LIMIT', message: 'You have exceeded your rate limit.' },
                }),
            );

            return;
        case 'outage':
            response.writeHead(503, { 'Retry-After': '120' }).end();

            return;
        case 'drift':
            response
                .writeHead(200, { ...json, ...quota(995) })
                .end(JSON.stringify({ totalHits: 1, foods: 'broccoli' }));

            return;
        case 'drop':
            request.socket.destroy();

            return;
    }
}

/**
 * Start a stub on an ephemeral loopback port.
 *
 * @returns The running stub, answering `hits` until told otherwise.
 * @sideEffect Opens a listening socket.
 */
export async function startUsdaStubServer(): Promise<UsdaStubServer> {
    const stub: UsdaStubServer = {
        baseUrl: '',
        mode: 'hits',
        requests: [],
        reset(): void {
            stub.requests.length = 0;
        },
        async close(): Promise<void> {
            await new Promise<void>((resolve) => {
                server.close(() => {
                    resolve();
                });
                server.closeAllConnections();
            });
        },
    };
    const server: Server = createServer((request, response) => {
        void answer(stub, request, response);
    });

    await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', resolve);
    });

    const address = server.address();
    const port = typeof address === 'object' && address !== null ? (address satisfies AddressInfo).port : 0;

    return Object.assign(stub, { baseUrl: `http://127.0.0.1:${String(port)}/fdc/v1` });
}
