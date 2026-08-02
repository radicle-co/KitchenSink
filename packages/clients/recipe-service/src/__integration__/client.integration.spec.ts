/**
 * Integration tests for {@link RecipeServiceClient} against a REAL, booted in-process HTTP server
 * (`node:http`) driven through the client's REAL transport — `ky` over the platform global `fetch`, with
 * NO injected fetch double. This proves the end-to-end wire behavior a mocked `fetch` cannot: the
 * request as it actually arrives on the socket (method, path, serialized query string, `Authorization`
 * header, streamed JSON body), real status-code handling, and the identity-sync retry replaying a real
 * second HTTP request with a force-refreshed token. Self-contained — needs no Docker or external service
 * — and runs in CI via `npm run test:integration` (excluded from the default unit run).
 */
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';

import { NotFoundError, RecipeServiceClient } from '../index.js';
import { makeRecipeDetail } from '../__fixtures__/recipes.js';

/** A single request as observed on the server socket. */
interface ReceivedRequest {
    readonly method: string;
    readonly url: string;
    readonly authorization: string | undefined;
    readonly body: string;
}

/** A programmable response the test server returns for the Nth request (last entry repeats). */
interface CannedResponse {
    readonly status: number;
    readonly json?: unknown;
}

/** A booted test server: its base URL, the requests it received (in order), and a shutdown hook. */
interface TestServer {
    readonly baseUrl: string;
    readonly received: ReceivedRequest[];
    close(): Promise<void>;
}

/** Read a request's full body off the socket as a UTF-8 string. */
async function readBody(req: IncomingMessage): Promise<string> {
    const chunks: Buffer[] = [];

    for await (const chunk of req) {
        chunks.push(chunk as Buffer);
    }

    return Buffer.concat(chunks).toString('utf8');
}

/**
 * Boot a real HTTP server that answers each request with the next {@link CannedResponse} (the last
 * repeats) and records what it received.
 *
 * @sideEffect Opens a listening TCP socket on an ephemeral localhost port.
 */
async function startServer(responses: readonly CannedResponse[]): Promise<TestServer> {
    const received: ReceivedRequest[] = [];
    let i = 0;

    const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
        void (async (): Promise<void> => {
            const body = await readBody(req);
            received.push({
                method: req.method ?? '',
                url: req.url ?? '',
                authorization: req.headers['authorization'],
                body,
            });

            const canned = responses[Math.min(i, responses.length - 1)]!;
            i += 1;

            if (canned.json === undefined) {
                res.writeHead(canned.status);
                res.end();

                return;
            }

            res.writeHead(canned.status, { 'content-type': 'application/json' });
            res.end(JSON.stringify(canned.json));
        })();
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;

    return {
        baseUrl: `http://127.0.0.1:${port}`,
        received,
        close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
    };
}

describe('RecipeServiceClient (integration, real HTTP server)', () => {
    let server: TestServer | undefined;

    afterEach(async () => {
        await server?.close();
        server = undefined;
    });

    it('GETs a recipe over the wire, attaching the bearer token, and parses the JSON body', async () => {
        const recipe = makeRecipeDetail({ id: 'rec_1', ownerId: 'usr_1', title: 'Soup' });
        server = await startServer([{ status: 200, json: recipe }]);
        const client = new RecipeServiceClient({ baseUrl: server.baseUrl, token: 'tok-int', fetch });

        const result = await client.getRecipeById('rec_1');

        expect(result).toEqual(recipe);
        expect(server.received).toHaveLength(1);
        expect(server.received[0]!.method).toBe('GET');
        expect(server.received[0]!.url).toBe('/v1/recipes/rec_1');
        expect(server.received[0]!.authorization).toBe('Bearer tok-int');
    });

    it('serializes list + array query params onto the real request line', async () => {
        server = await startServer([
            { status: 200, json: { results: [], total: 0, page: 2, pageSize: 20, hasMore: false, facets: {} } },
        ]);
        const client = new RecipeServiceClient({ baseUrl: server.baseUrl, fetch });

        await client.searchRecipes({ query: 'chicken pie', dietaryFlags: ['vegan', 'gluten_free'], page: 2 });

        expect(server.received[0]!.url).toBe(
            '/v1/search/recipes?query=chicken+pie&dietaryFlags=vegan&dietaryFlags=gluten_free&page=2',
        );
    });

    it('streams a JSON request body on a POST and returns the created resource', async () => {
        const created = makeRecipeDetail({ id: 'rec_new', title: 'Soup' });
        server = await startServer([{ status: 201, json: created }]);
        const client = new RecipeServiceClient({ baseUrl: server.baseUrl, token: 'tok', fetch });
        const input = {
            title: 'Soup',
            ingredients: [],
            steps: [],
            servings: 2,
            prepTimeMinutes: 5,
            cookTimeMinutes: 10,
            totalTimeMinutes: 15,
        };

        const result = await client.createRecipe(input);

        expect(result).toEqual(created);
        expect(server.received[0]!.method).toBe('POST');
        expect(JSON.parse(server.received[0]!.body)).toEqual(input);
    });

    it('maps a real 404 response to NotFoundError', async () => {
        server = await startServer([{ status: 404, json: { code: 'RECIPE_NOT_FOUND', message: 'gone' } }]);
        const client = new RecipeServiceClient({ baseUrl: server.baseUrl, fetch });

        await expect(client.getRecipeById('rec_missing')).rejects.toBeInstanceOf(NotFoundError);
    });

    it('resolves void on a real 204 delete', async () => {
        server = await startServer([{ status: 204 }]);
        const client = new RecipeServiceClient({ baseUrl: server.baseUrl, token: 'tok', fetch });

        await expect(client.deleteRecipe('rec_1')).resolves.toBeUndefined();
        expect(server.received[0]!.method).toBe('DELETE');
    });

    it('retries a real 401 IDENTITY_SYNC_PENDING with a force-refreshed token, then succeeds', async () => {
        const recipe = makeRecipeDetail({ id: 'rec_1', title: 'Soup' });
        server = await startServer([
            { status: 401, json: { code: 'IDENTITY_SYNC_PENDING', message: 'not yet' } },
            { status: 200, json: recipe },
        ]);
        const forceRefreshFlags: (boolean | undefined)[] = [];
        const client = new RecipeServiceClient({
            baseUrl: server.baseUrl,
            token: (opts) => {
                forceRefreshFlags.push(opts?.forceRefresh);

                return 'tok';
            },
            fetch,
            sleep: () => Promise.resolve(),
        });

        const result = await client.getRecipeById('rec_1');

        expect(result).toEqual(recipe);
        expect(server.received).toHaveLength(2);
        expect(forceRefreshFlags).toEqual([false, true]);
    });
});
