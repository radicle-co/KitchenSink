/**
 * The client's transport as the apps use it from a browser (plan 002 S5), over a REAL socket: a real `node:http` server
 * driven through the platform `fetch`, with no double. It proves what a mocked `fetch` cannot:
 *
 *   - a redirect is refused, so the cook's bearer never reaches a second origin, and that origin sees no request at all;
 *   - a `503` food sends is `SourceBusyError`, and a port nobody answers is a plain `FetchUnavailableError` with no
 *     status;
 *   - a `Retry-After` HTTP date on a real response is read as the seconds until it;
 *   - a real `429 SEARCH_RATE_LIMITED` holds its route, so the next search on it never reaches the server;
 *   - a caller's signal still aborts the request on a runtime without `AbortSignal.any`.
 *
 * Self-contained (no Docker, no external service) and runs in CI via `npm run test:integration`.
 */
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetContractSkewLatchForTests } from '../contractSkew.js';
import { FoodServiceClient, isFetchUnavailableError, isSearchRateLimitedError, isSourceBusyError } from '../index.js';

/** What a server answers: a status, a JSON body and headers. */
interface Answer {
    readonly status: number;
    readonly body?: unknown;
    readonly headers?: Record<string, string>;
    /** Never answer, so only the client's abort can end the request. */
    readonly hang?: boolean;
}

/** A booted server: its origin, the API requests it saw (the `/health` probe excluded), and a shutdown hook. */
interface TestServer {
    readonly origin: string;
    readonly received: { readonly url: string; readonly authorization: string | undefined }[];
    /** Resolves when a request's connection closes before an answer was sent. */
    readonly closedEarly: Promise<void>;
    close(): Promise<void>;
}

/**
 * Boot a server that answers every API request with `answer(url)` and `/health` with a `404` (no skew to report).
 *
 * @sideEffect Opens a listening TCP socket on an ephemeral localhost port.
 */
async function startServer(answer: (url: string) => Answer): Promise<TestServer> {
    const received: { url: string; authorization: string | undefined }[] = [];
    let signalClosedEarly = (): void => undefined;
    const closedEarly = new Promise<void>((resolve) => {
        signalClosedEarly = resolve;
    });

    const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
        const url = req.url ?? '';

        req.resume();

        if (url === '/health') {
            res.writeHead(404).end();

            return;
        }

        received.push({ url, authorization: req.headers['authorization'] });
        const reply = answer(url);

        if (reply.hang === true) {
            res.on('close', () => {
                if (!res.writableEnded) {
                    signalClosedEarly();
                }
            });

            return;
        }

        res.writeHead(reply.status, { 'content-type': 'application/json', ...reply.headers });
        res.end(reply.body === undefined ? '' : JSON.stringify(reply.body));
    });

    await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', resolve);
    });
    const { port } = server.address() as AddressInfo;

    return {
        origin: `http://127.0.0.1:${port}`,
        received,
        closedEarly,
        close: () =>
            new Promise<void>((resolve, reject) => {
                server.closeAllConnections();
                server.close((error) => (error ? reject(error) : resolve()));
            }),
    };
}

describe('FoodServiceClient browser transport (integration, real HTTP server)', () => {
    const servers: TestServer[] = [];

    /** Boot a server this test owns. */
    async function serve(answer: (url: string) => Answer): Promise<TestServer> {
        const server = await startServer(answer);

        servers.push(server);

        return server;
    }

    beforeEach(() => {
        resetContractSkewLatchForTests();
    });

    afterEach(async () => {
        await Promise.all(servers.splice(0).map((server) => server.close()));
    });

    it('refuses a redirect, so the second origin receives nothing and the bearer goes nowhere else', async () => {
        const elsewhere = await serve(() => ({ status: 200, body: { results: [] } }));
        const food = await serve(() => ({
            status: 302,
            headers: { location: `${elsewhere.origin}/api/v1/foods/catalog/search?query=egg` },
        }));
        const client = new FoodServiceClient({ baseUrl: food.origin, token: 'tok-cook' });

        const error = await client.searchCatalog('egg').catch((thrown: unknown) => thrown);

        expect(isFetchUnavailableError(error)).toBe(true);
        expect(food.received).toHaveLength(1);
        expect(elsewhere.received).toHaveLength(0);
    });

    it('reads a 503 food sent as SourceBusyError', async () => {
        const food = await serve(() => ({
            status: 503,
            body: { code: 'FETCH_UNAVAILABLE', message: 'busy', details: { retryAfterSeconds: 7 } },
            headers: { 'retry-after': '7' },
        }));
        const client = new FoodServiceClient({ baseUrl: food.origin, token: 'tok-cook' });

        const error = await client.searchCatalog('egg').catch((thrown: unknown) => thrown);

        expect(isSourceBusyError(error)).toBe(true);
        expect(error).toHaveProperty('retryAfterSeconds', 7);
    });

    // RFC 9110 §10.2.3: a `Retry-After` may be an HTTP date. It used to read as `NaN` and hide the body's window.
    it('reads an HTTP-date Retry-After from a real response as the seconds until it', async () => {
        const food = await serve(() => ({
            status: 503,
            body: { code: 'FETCH_UNAVAILABLE', message: 'busy', details: { retryAfterSeconds: 7 } },
            headers: { 'retry-after': new Date(Date.now() + 30_000).toUTCString() },
        }));
        const client = new FoodServiceClient({ baseUrl: food.origin, token: 'tok-cook' });

        const error = await client.searchCatalog('egg').catch((thrown: unknown) => thrown);

        expect(isSourceBusyError(error)).toBe(true);
        // A date has whole seconds, so up to a second of the wait has already passed when it is read.
        expect((error as { readonly retryAfterSeconds: number }).retryAfterSeconds).toBeGreaterThanOrEqual(29);
        expect((error as { readonly retryAfterSeconds: number }).retryAfterSeconds).toBeLessThanOrEqual(30);
    });

    // Nothing answered, so there is no status: the app retries a write on a refusal's status, never on a lost socket.
    it('gives a port nobody answers no status', async () => {
        const gone = await serve(() => ({ status: 200 }));
        const origin = gone.origin;
        await servers.splice(0)[0]!.close();
        const client = new FoodServiceClient({ baseUrl: origin, token: 'tok-cook' });

        await expect(client.addByName('egg')).rejects.toHaveProperty('status', undefined);
    });

    it('reads a port nobody answers as a plain FetchUnavailableError, not SourceBusyError', async () => {
        const gone = await serve(() => ({ status: 200 }));
        const origin = gone.origin;
        await servers.splice(0)[0]!.close();
        const client = new FoodServiceClient({ baseUrl: origin, token: 'tok-cook' });

        const error = await client.searchAuthored('egg').catch((thrown: unknown) => thrown);

        expect(isFetchUnavailableError(error)).toBe(true);
        expect(isSourceBusyError(error)).toBe(false);
    });

    it('holds a route after a real 429, so the next search on it never reaches the server', async () => {
        const food = await serve((url) =>
            url.startsWith('/api/v1/foods/catalog/search')
                ? {
                      status: 429,
                      body: { code: 'SEARCH_RATE_LIMITED', message: 'limit', details: { retryAfterSeconds: 30 } },
                      headers: { 'retry-after': '30' },
                  }
                : { status: 200, body: { results: [] } },
        );
        const client = new FoodServiceClient({ baseUrl: food.origin, token: 'tok-cook' });

        await expect(client.searchCatalog('egg')).rejects.toSatisfy(isSearchRateLimitedError);
        await expect(client.searchCatalog('eggs')).rejects.toSatisfy(isSearchRateLimitedError);
        await expect(client.searchAuthored('eggs')).resolves.toStrictEqual({ results: [] });

        expect(food.received.map(({ url }) => url.split('?')[0])).toStrictEqual([
            '/api/v1/foods/catalog/search',
            '/api/v1/foods/authored/search',
        ]);
    });

    describe('on a runtime without AbortSignal.any', () => {
        let saved: PropertyDescriptor | undefined;

        beforeEach(() => {
            saved = Object.getOwnPropertyDescriptor(AbortSignal, 'any');
            Object.defineProperty(AbortSignal, 'any', { value: undefined, configurable: true, writable: true });
        });

        afterEach(() => {
            if (saved !== undefined) {
                Object.defineProperty(AbortSignal, 'any', saved);
            }
        });

        it('closes the connection when the caller aborts a request in flight', async () => {
            const food = await serve(() => ({ status: 200, hang: true }));
            const client = new FoodServiceClient({ baseUrl: food.origin, token: 'tok-cook', timeoutMs: 60_000 });
            const caller = new AbortController();

            const pending = client.searchCatalog('egg', { signal: caller.signal }).catch((thrown: unknown) => thrown);
            await expect.poll(() => food.received.length).toBe(1);
            caller.abort();

            expect(isFetchUnavailableError(await pending)).toBe(true);
            await food.closedEarly;
        });
    });
});
