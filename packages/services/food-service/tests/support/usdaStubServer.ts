/**
 * A loopback stand-in for USDA FoodData Central, for suites that drive the REAL client through the REAL rate-limited
 * transport (ADR-0053 §3). A suite points `USDA_API_BASE_URL` at {@link UsdaStubServer.baseUrl} and steers each
 * answer with {@link UsdaStubServer.mode}; every request that reaches it is recorded, so "the source was not called"
 * is an assertion on what crossed the wire, not on a mock.
 *
 * A double of the client could not show this: admission lives in the `fetch` the client is given, so only a client
 * that really sends requests is admitted at all.
 *
 * In `hits` mode it answers the three requests the client sends: a search page ({@link UsdaStubServer.searchBody}), one
 * item's detail, and the worker's batch of details. Like the client (ADR-0055 point 1), it takes a search only as a POST
 * whose JSON body states the data types as an array, and answers any other search `400` in every mode. A detail carries the description the search page shows for its
 * item, so a drain that searches a name and fetches the hits merges an item with that name. {@link UsdaStubServer.hold}
 * holds every request to one path open until released, so a suite can race two callers at a known point.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { text } from 'node:stream/consumers';

import { z } from 'zod';

import {
    makeUsdaFoodDetailBody,
    makeUsdaSearchResultBody,
    type UsdaFoodDetailBody,
    type UsdaSearchResultBody,
} from '../../src/sources/usda/__fixtures__/usda.fixtures.js';

/** How the stub answers the next request. */
export type UsdaStubMode = 'hits' | 'empty' | 'throttled' | 'server-error' | 'timeout';

/** A held path: its requests wait until {@link StubHold.release}. */
export interface StubHold {
    /** Settles when the first request to the path reaches the stub. */
    readonly reached: Promise<void>;
    /** Answer every held request, and stop holding the path. */
    release(): void;
}

/** A running stub. */
export interface UsdaStubServer {
    /** The base URL to set as `USDA_API_BASE_URL`. */
    readonly baseUrl: string;
    /** How the stub answers; a suite sets it per case. */
    mode: UsdaStubMode;
    /** The search page `hits` mode answers. */
    searchBody: UsdaSearchResultBody;
    /** The `query` of every search the stub answered, in order. */
    readonly searches: string[];
    /** Every request path that reached the stub, in order. */
    readonly requests: string[];
    /**
     * Hold every request whose path ends with `path` until the hold is released.
     *
     * @param path - The path suffix, for example `/food/900001` or `/foods/search`.
     * @returns The hold.
     */
    hold(path: string): StubHold;
    /** Forget what reached the stub, answer the default search page, and release every hold. */
    reset(): void;
    /** Stop listening. */
    close(): Promise<void>;
}

/** A registered hold, with what releases it. */
interface PendingHold {
    readonly path: string;
    readonly released: Promise<void>;
    readonly arrive: () => void;
    readonly release: () => void;
}

/**
 * A promise and the function that settles it.
 *
 * @returns The pair.
 */
function signal(): [Promise<void>, () => void] {
    let settle: () => void = () => undefined;
    const settled = new Promise<void>((resolve) => {
        settle = resolve;
    });

    return [settled, settle];
}

/** The search body USDA answers: the term, and the data types as an array. */
const searchBodySchema = z.object({ query: z.string(), dataType: z.array(z.string()) });

/** The batch body: the ids to fetch. */
const batchBodySchema = z.object({ fdcIds: z.array(z.number()) });

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
 * One item's detail, carrying the description the search page shows for it.
 *
 * @param stub - The stub's state.
 * @param fdcId - The item.
 * @returns Its detail body.
 */
function detailOf(stub: UsdaStubServer, fdcId: number): UsdaFoodDetailBody {
    const shown = stub.searchBody.foods.find((food) => food.fdcId === fdcId);

    return makeUsdaFoodDetailBody(shown === undefined ? { fdcId } : { fdcId, description: shown.description });
}

/**
 * The `hits` answer to a request: an item's detail, the worker's batch of details, or the search page. Pure.
 *
 * @param stub - The stub's state.
 * @param method - The request's method.
 * @param pathname - Its path.
 * @param body - Its parsed body.
 * @returns The JSON body.
 */
function hitsBodyOf(stub: UsdaStubServer, method: string | undefined, pathname: string, body: unknown): unknown {
    const fdcId = /\/food\/(\d+)$/u.exec(pathname)?.[1];

    if (fdcId !== undefined) {
        return detailOf(stub, Number(fdcId));
    }

    if (method === 'POST' && pathname.endsWith('/foods')) {
        const batch = batchBodySchema.safeParse(body);

        return (batch.success ? batch.data.fdcIds : []).map((id) => detailOf(stub, id));
    }

    return stub.searchBody;
}

/**
 * Answer one request as the current mode says, once any hold on its path is released.
 *
 * @param stub - The stub's state.
 * @param holds - The registered holds.
 * @param request - The request.
 * @param response - The response.
 * @sideEffect Writes the response, or destroys the socket for `timeout`.
 */
async function answer(
    stub: UsdaStubServer,
    holds: readonly PendingHold[],
    request: IncomingMessage,
    response: ServerResponse,
): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://stub.invalid');
    stub.requests.push(url.pathname);

    const body = await bodyOf(request);

    if (url.pathname.endsWith('/foods/search')) {
        const search = searchBodySchema.safeParse(body);

        if (request.method !== 'POST' || request.headers['content-type'] !== 'application/json' || !search.success) {
            response.writeHead(400, { 'content-type': 'application/json' });
            response.end(JSON.stringify({ error: { code: 'BAD_REQUEST' } }));

            return;
        }

        stub.searches.push(search.data.query);
    }

    const held = holds.find((hold) => url.pathname.endsWith(hold.path));

    if (held !== undefined) {
        held.arrive();
        await held.released;
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

        case 'hits': {
            response.writeHead(200, { 'content-type': 'application/json' });
            response.end(JSON.stringify(hitsBodyOf(stub, request.method, url.pathname, body)));

            return;
        }
    }
}

/**
 * Start a stub on an ephemeral loopback port.
 *
 * @returns The running stub, answering `hits` until told otherwise.
 * @sideEffect Opens a listening socket.
 */
export async function startUsdaStubServer(): Promise<UsdaStubServer> {
    const holds: PendingHold[] = [];

    const releaseAll = (): void => {
        for (const hold of holds.splice(0)) {
            hold.release();
        }
    };

    const stub: UsdaStubServer = {
        baseUrl: '',
        mode: 'hits',
        searchBody: makeUsdaSearchResultBody(),
        searches: [],
        requests: [],
        hold(path: string): StubHold {
            const [reached, arrive] = signal();
            const [released, release] = signal();
            const pending: PendingHold = { path, released, arrive, release };

            holds.push(pending);

            return {
                reached,
                release: (): void => {
                    holds.splice(holds.indexOf(pending), 1);
                    release();
                },
            };
        },
        reset(): void {
            stub.searches.length = 0;
            stub.requests.length = 0;
            stub.searchBody = makeUsdaSearchResultBody();
            releaseAll();
        },
        async close(): Promise<void> {
            releaseAll();
            await new Promise<void>((resolve) => {
                server.close(() => resolve());
                server.closeAllConnections();
            });
        },
    };
    const server: Server = createServer((request, response) => {
        void answer(stub, holds, request, response);
    });

    await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', resolve);
    });

    const address = server.address();
    const port = typeof address === 'object' && address !== null ? (address satisfies AddressInfo).port : 0;

    return Object.assign(stub, { baseUrl: `http://127.0.0.1:${String(port)}/fdc/v1` });
}
