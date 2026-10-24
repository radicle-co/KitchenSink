/**
 * `getRecipeNutrition` against a REAL, booted `node:http` server driven through the client's REAL transport
 * — `ky` over the platform global `fetch`, with NO injected double.
 *
 * The unit tier stubs `fetch`, so it proves the client builds the call it intends to. What only a socket
 * can prove:
 *
 *  1. **The request as it actually ARRIVES.** Method, path, `Authorization` header and the streamed JSON
 *     body — a POST-shaped read whose body did not survive serialization would still pass a stubbed-fetch
 *     assertion that inspected the pre-flight object.
 *  2. **⛔ The DEADLINE ends a real hang.** The whole reason the wire union has no `pending` member is that
 *     a skeleton must be able to stop waiting. Against a server that accepts the connection and never
 *     answers — an ALB target draining mid-deploy, a stalled query — the promise must still SETTLE, as a
 *     typed rejection. A fetch double that ignores its signal cannot demonstrate this; this server can.
 *  3. **A cancelled read rejects rather than resolving empty.** `{ nutrition: {} }` is a legitimate answer
 *     ("none of these are yours"), so a cancellation that produced it would be indistinguishable from data.
 */
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';

import { FetchUnavailableError, RecipeServiceClient } from '../index.js';
import { resetContractSkewLatchForTests } from '../contractSkew.js';

const RECIPE_A = '00000000-0000-4000-8000-00000000000a';
const RECIPE_B = '00000000-0000-4000-8000-00000000000b';

/** The body the answering server returns. */
const BODY = {
    nutrition: {
        [RECIPE_A]: {
            state: 'known',
            caloriesPerServing: 350,
            proteinG: 12,
            carbsG: 70,
            fatG: 2,
            isComplete: true,
            freshness: 'stale',
        },
    },
};

/** One request as observed on the socket. */
interface Observed {
    readonly method: string;
    readonly url: string;
    readonly authorization: string | undefined;
    readonly body: string;
}

let server: Server | undefined;

/** Read a request body to completion. */
async function readBody(req: IncomingMessage): Promise<string> {
    const chunks: Buffer[] = [];

    for await (const chunk of req) {
        chunks.push(chunk as Buffer);
    }

    return Buffer.concat(chunks).toString('utf8');
}

/**
 * Boot a server that either answers the nutrition body or accepts the connection and NEVER answers.
 *
 * @sideEffect Listens on an ephemeral port.
 */
async function startServer(mode: 'answer' | 'hang'): Promise<{ baseUrl: string; received: Observed[] }> {
    const received: Observed[] = [];

    server = createServer((req: IncomingMessage, res: ServerResponse) => {
        void (async (): Promise<void> => {
            const body = await readBody(req);

            if ((req.url ?? '') === '/health') {
                // The drift-layer-3 skew probe rides the same transport; answer it out of band so it never
                // lands in `received` and never perturbs an index assertion.
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ status: 'ok', service: 'recipe' }));

                return;
            }

            received.push({
                method: req.method ?? '',
                url: req.url ?? '',
                authorization: req.headers['authorization'],
                body,
            });

            if (mode === 'hang') {
                // Deliberately no response and no socket close: the ONLY thing that can end this wait is the
                // caller's own deadline.
                return;
            }

            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify(BODY));
        })();
    });

    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));

    return { baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, received };
}

describe('getRecipeNutrition over a real socket', () => {
    afterEach(async () => {
        resetContractSkewLatchForTests();
        await new Promise<void>((resolve) => {
            if (server === undefined) {
                resolve();

                return;
            }

            server.closeAllConnections?.();
            server.close(() => resolve());
        });
        server = undefined;
    });

    it('sends a POST to /api/v1/recipes/nutrition-batch with the bearer and the id list', async () => {
        const { baseUrl, received } = await startServer('answer');
        const client = new RecipeServiceClient({ baseUrl, token: 'session-jwt' });

        const result = await client.getRecipeNutrition([RECIPE_A, RECIPE_B]);

        expect(result).toStrictEqual(BODY);
        expect(received).toHaveLength(1);
        expect(received[0]?.method).toBe('POST');
        expect(received[0]?.url).toBe('/api/v1/recipes/nutrition-batch');
        expect(received[0]?.authorization).toBe('Bearer session-jwt');
        expect(JSON.parse(received[0]?.body ?? '{}')).toStrictEqual({ recipeIds: [RECIPE_A, RECIPE_B] });
    });

    it('⛔ SETTLES against a server that never answers — a permanent skeleton is the failure', async () => {
        // The deadline is the caller's, supplied the way the read seam supplies it. Without one this promise
        // never settles and the card spins for the life of the page.
        const { baseUrl } = await startServer('hang');
        const client = new RecipeServiceClient({ baseUrl, token: 'session-jwt' });

        const failure = await client
            .getRecipeNutrition([RECIPE_A], { signal: AbortSignal.timeout(150) })
            .catch((error: unknown) => error);

        // A TYPED error, not a bare `DOMException`: the transport's contract is "a typed result or a typed
        // error", and a consumer branching on it must not have to know about DOM exception names.
        expect(failure).toBeInstanceOf(FetchUnavailableError);
    });

    it('⛔ rejects a cancelled read rather than resolving an empty map', async () => {
        // `{ nutrition: {} }` is a REAL answer ("none of these are readable by you"), so a cancellation that
        // produced it would be silently indistinguishable from data and would render every card as no-data.
        const { baseUrl } = await startServer('hang');
        const client = new RecipeServiceClient({ baseUrl, token: 'session-jwt' });
        const controller = new AbortController();
        const pending = client.getRecipeNutrition([RECIPE_A], { signal: controller.signal });

        setTimeout(() => controller.abort(), 50);

        await expect(pending).rejects.toBeInstanceOf(FetchUnavailableError);
    });

    it('⛔ carries `freshness: "stale"` through the parse — KTD-3b is "serve stale, MARKED"', async () => {
        // The field exists so a reader is TOLD the number may have moved. A parse that dropped it would be
        // invisible: the figure still renders, just silently unqualified.
        const { baseUrl } = await startServer('answer');
        const client = new RecipeServiceClient({ baseUrl, token: 'session-jwt' });

        const result = await client.getRecipeNutrition([RECIPE_A]);

        expect(result.nutrition[RECIPE_A]).toMatchObject({ state: 'known', freshness: 'stale' });
    });
});
