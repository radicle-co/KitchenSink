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
import { CONTRACT_HASH } from '@kitchensink/schema-recipe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NotFoundError, RecipeServiceClient } from '../index.js';
import { resetContractSkewLatchForTests } from '../contractSkew.js';
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
    /** API requests only — the `/health` skew probe is answered out-of-band, see {@link startServer}. */
    readonly received: ReceivedRequest[];
    /** The `/health` skew-probe requests this server answered (drift layer 3, §15.2.5). */
    readonly healthProbes: ReceivedRequest[];
    close(): Promise<void>;
}

/**
 * What the test server answers on `GET /health` — the drift-layer-3 skew probe (§15.2.5).
 *
 * `'agree'` publishes the client's OWN fingerprint (no warning — the default, so every unrelated scenario is
 * unaffected), `'skewed'` publishes a different well-formed one, and `'absent'` omits the field entirely, which
 * is what a service deployed before publication serves.
 */
type HealthPosture = 'agree' | 'skewed' | 'absent';

/** A well-formed fingerprint that is deliberately not this client's. */
const FOREIGN_HASH = 'd'.repeat(64);

/** The `/health` body for a posture. */
function healthBody(posture: HealthPosture): Record<string, string> {
    const base = { status: 'ok', service: 'recipe' };

    if (posture === 'absent') {
        return base;
    }

    return { ...base, contractHash: posture === 'skewed' ? FOREIGN_HASH : CONTRACT_HASH };
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
async function startServer(
    responses: readonly CannedResponse[],
    healthPosture: HealthPosture = 'agree',
): Promise<TestServer> {
    const received: ReceivedRequest[] = [];
    const healthProbes: ReceivedRequest[] = [];
    let i = 0;

    const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
        void (async (): Promise<void> => {
            const body = await readBody(req);
            const observed = {
                method: req.method ?? '',
                url: req.url ?? '',
                authorization: req.headers['authorization'],
                body,
            };

            // `/health` is the drift-layer-3 skew probe, NOT part of any scenario below. It is answered
            // out-of-band — outside the canned sequence and outside `received` — for two reasons: letting it
            // consume a queued response would silently shift every sequenced scenario by one (the identity-sync
            // retry test would have had its 401 eaten by the probe), and letting it land in `received` would
            // break every length/index assertion depending on unrelated network timing.
            if (observed.url === '/health') {
                healthProbes.push(observed);
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(JSON.stringify(healthBody(healthPosture)));

                return;
            }

            received.push(observed);

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
        healthProbes,
        close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
    };
}

describe('RecipeServiceClient (integration, real HTTP server)', () => {
    let server: TestServer | undefined;

    // The skew probe latches once per ORIGIN per process. Each test here gets a fresh ephemeral port (so a fresh
    // origin), but resetting keeps that an explicit guarantee rather than a side effect of port allocation.
    beforeEach(() => {
        resetContractSkewLatchForTests();
    });

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
        expect(server.received[0]!.url).toBe('/api/v1/recipes/rec_1');
        expect(server.received[0]!.authorization).toBe('Bearer tok-int');
    });

    it('serializes list + array query params onto the real request line', async () => {
        // All FOUR facet dimensions, not `facets: {}`. `recipeSearchFacetsSchema` declares every dimension
        // REQUIRED (deliberately — the server/client disagreement about whether a facet block could be absent
        // was reconciled in favour of required), so a `{}` canned body fails the client's own response parse and
        // this scenario died on a ZodError before it could assert anything about the request line. Pre-existing
        // red on this tier, unrelated to what the test is checking.
        server = await startServer([
            {
                status: 200,
                json: {
                    results: [],
                    total: 0,
                    page: 2,
                    pageSize: 20,
                    hasMore: false,
                    facets: { dietaryFlags: [], tags: [], cuisine: [], totalTime: [] },
                },
            },
        ]);
        const client = new RecipeServiceClient({ baseUrl: server.baseUrl, fetch });

        await client.searchRecipes({ query: 'chicken pie', dietaryFlags: ['vegan', 'gluten_free'], page: 2 });

        expect(server.received[0]!.url).toBe(
            '/api/v1/search/recipes?query=chicken+pie&dietaryFlags=vegan&dietaryFlags=gluten_free&page=2',
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

/**
 * DRIFT LAYER 3 (Skew) over a REAL socket — CODING_STANDARDS §15.2.5, owner ruling 2026-08-11 (warn, never
 * refuse).
 *
 * The unit tier proves the decision with a mocked `fetch`. This tier proves the thing a mock cannot: that the
 * probe is a real, separate, unauthenticated `GET /health` on the wire, that the caller's request completes
 * normally alongside it, and that the fingerprint survives a genuine JSON round-trip.
 */
describe('RecipeServiceClient contract skew (integration, real HTTP server)', () => {
    let server: TestServer | undefined;

    beforeEach(() => {
        resetContractSkewLatchForTests();
    });

    afterEach(async () => {
        await server?.close();
        server = undefined;
    });

    it('probes /health over the wire, unauthenticated, and warns once on a real mismatch', async () => {
        const recipe = makeRecipeDetail({ id: 'rec_1', title: 'Soup' });
        server = await startServer([{ status: 200, json: recipe }], 'skewed');
        const onContractSkew = vi.fn();
        const client = new RecipeServiceClient({
            baseUrl: server.baseUrl,
            token: 'tok-int',
            fetch,
            onContractSkew,
        });

        // The caller's call is completely unaffected — that IS the ruling.
        await expect(client.getRecipeById('rec_1')).resolves.toEqual(recipe);

        await vi.waitFor(() => {
            expect(onContractSkew).toHaveBeenCalledTimes(1);
        });
        expect(server.healthProbes).toHaveLength(1);
        expect(server.healthProbes[0]!.method).toBe('GET');
        // No credential on the probe: `/health` is public so a consumer can ask before it holds one.
        expect(server.healthProbes[0]!.authorization).toBeUndefined();
        expect(onContractSkew.mock.calls[0]?.[0]).toContain(FOREIGN_HASH.slice(0, 12));
    });

    it('stays silent when the real service publishes an agreeing fingerprint', async () => {
        const recipe = makeRecipeDetail({ id: 'rec_1' });
        server = await startServer([{ status: 200, json: recipe }], 'agree');
        const onContractSkew = vi.fn();
        const client = new RecipeServiceClient({ baseUrl: server.baseUrl, fetch, onContractSkew });

        await client.getRecipeById('rec_1');
        await vi.waitFor(() => {
            expect(server?.healthProbes).toHaveLength(1);
        });

        expect(onContractSkew).not.toHaveBeenCalled();
    });

    // A real service deployed before publication existed. Silence, not noise.
    it('stays silent when the real service publishes no fingerprint at all', async () => {
        const recipe = makeRecipeDetail({ id: 'rec_1' });
        server = await startServer([{ status: 200, json: recipe }], 'absent');
        const onContractSkew = vi.fn();
        const client = new RecipeServiceClient({ baseUrl: server.baseUrl, fetch, onContractSkew });

        await client.getRecipeById('rec_1');
        await vi.waitFor(() => {
            expect(server?.healthProbes).toHaveLength(1);
        });

        expect(onContractSkew).not.toHaveBeenCalled();
    });

    it('probes ONCE across many real requests to the same origin', async () => {
        const recipe = makeRecipeDetail({ id: 'rec_1' });
        server = await startServer([{ status: 200, json: recipe }], 'skewed');
        const onContractSkew = vi.fn();
        const client = new RecipeServiceClient({ baseUrl: server.baseUrl, fetch, onContractSkew });

        for (let n = 0; n < 5; n += 1) {
            await client.getRecipeById('rec_1');
        }

        await vi.waitFor(() => {
            expect(onContractSkew).toHaveBeenCalledTimes(1);
        });
        expect(server.received).toHaveLength(5);
        expect(server.healthProbes).toHaveLength(1);
    });
});
