/**
 * A loopback stand-in for USDA FoodData Central, for suites that drive the REAL client through the REAL rate-limited
 * transport (ADR-0053 §3). A suite points `USDA_API_BASE_URL` at {@link UsdaStubServer.baseUrl} and steers each
 * answer with {@link UsdaStubServer.mode}; every request that reaches it is recorded, so "the source was not called"
 * is an assertion on what crossed the wire, not on a mock.
 *
 * A double of the client could not show this: admission lives in the `fetch` the client is given, so only a client
 * that really sends requests is admitted at all.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { makeUsdaSearchResultBody } from '../../src/sources/usda/__fixtures__/usda.fixtures.js';

/** How the stub answers the next request. */
export type UsdaStubMode = 'hits' | 'empty' | 'throttled' | 'server-error' | 'timeout';

/** A running stub. */
export interface UsdaStubServer {
    /** The base URL to set as `USDA_API_BASE_URL`. */
    readonly baseUrl: string;
    /** How the stub answers; a suite sets it per case. */
    mode: UsdaStubMode;
    /** The `query` of every search that reached the stub, in order. */
    readonly searches: string[];
    /** Every request path that reached the stub, in order. */
    readonly requests: string[];
    /** Forget what reached the stub. */
    reset(): void;
    /** Stop listening. */
    close(): Promise<void>;
}

/**
 * Answer one request as the current mode says.
 *
 * @param stub - The stub's state.
 * @param request - The request.
 * @param response - The response.
 * @sideEffect Writes the response, or destroys the socket for `timeout`.
 */
function answer(stub: UsdaStubServer, request: IncomingMessage, response: ServerResponse): void {
    const url = new URL(request.url ?? '/', 'http://stub.invalid');
    stub.requests.push(url.pathname);

    if (url.pathname.endsWith('/foods/search')) {
        stub.searches.push(url.searchParams.get('query') ?? '');
    }

    switch (stub.mode) {
        case 'throttled':
            response.writeHead(429).end();

            return;
        case 'server-error':
            response.writeHead(503).end();

            return;
        case 'timeout':
            // No answer at all: the client sees a transport failure, which it classifies as a timeout.
            request.socket.destroy();

            return;
        case 'empty':
            response.writeHead(200, { 'content-type': 'application/json' });
            response.end(JSON.stringify({ foods: [], totalHits: 0 }));

            return;
        case 'hits':
            response.writeHead(200, { 'content-type': 'application/json' });
            response.end(JSON.stringify(makeUsdaSearchResultBody()));

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
        searches: [],
        requests: [],
        reset(): void {
            stub.searches.length = 0;
            stub.requests.length = 0;
        },
        async close(): Promise<void> {
            await new Promise<void>((resolve) => {
                server.close(() => resolve());
                server.closeAllConnections();
            });
        },
    };
    const server: Server = createServer((request, response) => answer(stub, request, response));

    await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', resolve);
    });

    const address = server.address();
    const port = typeof address === 'object' && address !== null ? (address satisfies AddressInfo).port : 0;

    return Object.assign(stub, { baseUrl: `http://127.0.0.1:${String(port)}/fdc/v1` });
}
