// @vitest-environment jsdom
/**
 * The progressive food search through the client's hook, over a REAL socket (ADR-0055 point 9; staff-architect review
 * "Tests owed": the client hook over a mocked stream). A `node:http` server writes the frames the way food does, with
 * gaps between writes, and `useProgressiveFoodSearch` reads them through the platform `fetch` with no double. It proves
 * what a `fetch` double cannot:
 *
 *   - the answer grows as each frame is written, not when the body ends;
 *   - a frame cut across two TCP writes, in the middle of a multi-byte character, still arrives whole;
 *   - the client's per-request timeout does not cut a slow body off (it bounds only the headers);
 *   - a body that ends without `complete` leaves an incomplete answer, and the read ends;
 *   - a refusal before the first byte is a failed read with the typed error, a proxy's page that is not JSON included.
 *
 * Self-contained (no Docker, no external service) and runs in CI via `npm run test:integration`.
 */
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetContractSkewLatchForTests } from '../contractSkew.js';
import { FoodServiceProvider, useProgressiveFoodSearch } from '../hooks.js';
import { FoodServiceClient, isSearchRateLimitedError, isUnexpectedResponseError } from '../index.js';

/** One write the server makes: bytes, after a pause. */
interface Write {
    readonly afterMs: number;
    readonly bytes: Buffer;
}

/** A booted server: its origin, a way to let a held write go, and a shutdown hook. */
interface TestServer {
    readonly origin: string;
    close(): Promise<void>;
}

const pause = (ms: number): Promise<void> =>
    new Promise((resolve) => {
        setTimeout(resolve, ms);
    });

/**
 * Boot a server that answers the progressive search with `status` and then each of `writes`, and `/health` with a 404.
 *
 * @sideEffect Opens a listening TCP socket on an ephemeral localhost port.
 */
async function startServer(
    status: number,
    writes: readonly Write[],
    headers: Record<string, string> = {},
): Promise<TestServer> {
    const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
        req.resume();

        if (req.url === '/health') {
            res.writeHead(404).end();

            return;
        }

        res.writeHead(status, {
            'content-type': status === 200 ? 'application/x-ndjson; charset=utf-8' : 'application/json',
            ...headers,
        });
        res.flushHeaders();

        void (async () => {
            for (const write of writes) {
                await pause(write.afterMs);
                res.write(write.bytes);
            }

            res.end();
        })();
    });

    await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', resolve);
    });
    const { port } = server.address() as AddressInfo;

    return {
        origin: `http://127.0.0.1:${port}`,
        close: () =>
            new Promise<void>((resolve, reject) => {
                server.closeAllConnections();
                server.close((error) => (error ? reject(error) : resolve()));
            }),
    };
}

const DATABASE_LINE =
    '{"type":"database","catalog":{"outcome":"answered","results":[{"id":"food_1","name":"egg","score":0.9}]},"authored":{"outcome":"answered","results":[]}}\n';
const SOURCE_LINE =
    '{"type":"source","source":"usda","outcome":"answered","items":[{"name":"Crème brûlée","reference":"r1"}]}\n';
const COMPLETE_LINE = '{"type":"complete"}\n';

/** `line`'s bytes cut inside its first multi-byte character, as two writes. */
function cutInsideMultiByte(line: string, afterMs: number): readonly Write[] {
    const bytes = Buffer.from(line, 'utf8');
    const cut = Buffer.byteLength(line.slice(0, line.indexOf('è')), 'utf8') + 1;

    return [
        { afterMs, bytes: bytes.subarray(0, cut) },
        { afterMs: 30, bytes: bytes.subarray(cut) },
    ];
}

describe('useProgressiveFoodSearch over a real stream (integration)', () => {
    const servers: TestServer[] = [];

    /** Boot a server this test owns. */
    async function serve(
        status: number,
        writes: readonly Write[],
        headers?: Record<string, string>,
    ): Promise<TestServer> {
        const server = await startServer(status, writes, headers);

        servers.push(server);

        return server;
    }

    /** Render the hook against `origin` for the cook `user_a`, with the client's per-request timeout at `timeoutMs`. */
    function renderSearch(origin: string, timeoutMs = 8_000) {
        const client = new FoodServiceClient({ baseUrl: origin, token: 'tok-cook', timeoutMs });
        const queryClient = new QueryClient({ defaultOptions: { queries: { networkMode: 'offlineFirst' } } });
        const wrapper = ({ children }: { readonly children: ReactNode }) =>
            createElement(
                QueryClientProvider,
                { client: queryClient },
                createElement(FoodServiceProvider, { client, subject: 'user_a', children }),
            );

        return renderHook(() => useProgressiveFoodSearch('egg'), { wrapper });
    }

    beforeEach(() => {
        resetContractSkewLatchForTests();
    });

    afterEach(async () => {
        cleanup();
        await Promise.all(servers.splice(0).map((server) => server.close()));
    });

    it('grows the answer as each frame is written, and ends it at complete', async () => {
        const food = await serve(200, [
            { afterMs: 0, bytes: Buffer.from(DATABASE_LINE) },
            ...cutInsideMultiByte(SOURCE_LINE, 200),
            { afterMs: 200, bytes: Buffer.from(COMPLETE_LINE) },
        ]);

        const { result } = renderSearch(food.origin);

        await waitFor(() => expect(result.current.data?.database?.type).toBe('database'));
        expect(result.current.data?.sources).toStrictEqual([]);
        expect(result.current.fetchStatus).toBe('fetching');

        await waitFor(() => expect(result.current.data?.sources).toHaveLength(1));
        expect(result.current.data?.sources[0]).toStrictEqual({
            type: 'source',
            source: 'usda',
            outcome: 'answered',
            items: [{ name: 'Crème brûlée', reference: 'r1' }],
        });
        expect(result.current.data?.complete).toBe(false);

        await waitFor(() => expect(result.current.data?.complete).toBe(true));
        expect(result.current.fetchStatus).toBe('idle');
    });

    it('lets a body outlive the client’s per-request timeout, which bounds only the headers', async () => {
        const food = await serve(200, [
            { afterMs: 0, bytes: Buffer.from(DATABASE_LINE) },
            { afterMs: 300, bytes: Buffer.from(COMPLETE_LINE) },
        ]);

        const { result } = renderSearch(food.origin, 100);

        await waitFor(() => expect(result.current.data?.complete).toBe(true), { timeout: 2_000 });
        expect(result.current.isError).toBe(false);
    });

    it('leaves an incomplete answer when the body ends without complete, and ends the read', async () => {
        const food = await serve(200, [{ afterMs: 0, bytes: Buffer.from(DATABASE_LINE) }]);

        const { result } = renderSearch(food.origin);

        await waitFor(() => expect(result.current.fetchStatus).toBe('idle'));
        expect(result.current.data?.database?.type).toBe('database');
        expect(result.current.data?.complete).toBe(false);
    });

    it('fails the read with the typed refusal when food refuses before the first byte', async () => {
        const food = await serve(
            429,
            [
                {
                    afterMs: 0,
                    bytes: Buffer.from(
                        JSON.stringify({
                            code: 'SEARCH_RATE_LIMITED',
                            message: 'limit',
                            details: { retryAfterSeconds: 30 },
                        }),
                    ),
                },
            ],
            { 'retry-after': '30' },
        );

        const { result } = renderSearch(food.origin);

        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(isSearchRateLimitedError(result.current.error)).toBe(true);
        expect(result.current.data).toBeUndefined();
    });

    it('fails the read with the status’s typed error when a gateway answers its own HTML page', async () => {
        const food = await serve(
            502,
            [{ afterMs: 0, bytes: Buffer.from('<html><body>502 Bad Gateway</body></html>') }],
            {
                'content-type': 'text/html',
            },
        );

        const { result } = renderSearch(food.origin);

        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(isUnexpectedResponseError(result.current.error)).toBe(true);
        expect(result.current.error).toHaveProperty('status', 502);
    });
});
