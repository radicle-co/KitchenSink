/**
 * `getIngredientFoodNutrition` (plan 002 U9) against a REAL, booted `node:http` server, through the client's real
 * transport with no fetch double.
 *
 * What only a socket can prove: the POST arrives with its bearer and its JSON body intact; a server that accepts the
 * connection and never answers still ends in a typed rejection at the caller's deadline; and a stale, found entry
 * keeps its `freshness` through the parse.
 */
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';

import { FetchUnavailableError, RecipeServiceClient } from '../index.js';
import { resetContractSkewLatchForTests } from '../contractSkew.js';

const ROOT = { kind: 'root', id: '01JFOOD0000000000000000001' } as const;
const VARIANT = { kind: 'variant', id: '01JVARIANT00000000000000001' } as const;

/** The body the answering server returns. */
const BODY = {
    entries: [
        { outcome: 'found', ref: ROOT, freshness: 'stale', caloriesPer100g: 165, portions: [] },
        { outcome: 'unavailable', ref: VARIANT },
    ],
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
 * Boot a server that either answers {@link BODY} or accepts the connection and NEVER answers.
 *
 * @sideEffect Listens on an ephemeral port.
 */
async function startServer(mode: 'answer' | 'hang'): Promise<{ baseUrl: string; received: Observed[] }> {
    const received: Observed[] = [];

    server = createServer((req: IncomingMessage, res: ServerResponse) => {
        void (async (): Promise<void> => {
            const body = await readBody(req);

            if ((req.url ?? '') === '/health') {
                // The contract-skew probe rides the same transport; answer it out of band.
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
                return;
            }

            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify(BODY));
        })();
    });

    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));

    return { baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, received };
}

describe('getIngredientFoodNutrition over a real socket', () => {
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

    it('sends a POST to /api/v1/ingredients/food-nutrition with the bearer and the refs', async () => {
        const { baseUrl, received } = await startServer('answer');
        const client = new RecipeServiceClient({ baseUrl, token: 'session-jwt' });

        const result = await client.getIngredientFoodNutrition([ROOT, VARIANT]);

        expect(result).toStrictEqual(BODY);
        expect(received).toHaveLength(1);
        expect(received[0]?.method).toBe('POST');
        expect(received[0]?.url).toBe('/api/v1/ingredients/food-nutrition');
        expect(received[0]?.authorization).toBe('Bearer session-jwt');
        expect(JSON.parse(received[0]?.body ?? '{}')).toStrictEqual({ refs: [ROOT, VARIANT] });
    });

    it('⛔ SETTLES against a server that never answers, as a typed rejection', async () => {
        const { baseUrl } = await startServer('hang');
        const client = new RecipeServiceClient({ baseUrl, token: 'session-jwt' });

        const failure = await client
            .getIngredientFoodNutrition([ROOT], { signal: AbortSignal.timeout(150) })
            .catch((error: unknown) => error);

        expect(failure).toBeInstanceOf(FetchUnavailableError);
    });

    it('⛔ carries a found entry’s `freshness: "stale"` through the parse', async () => {
        const { baseUrl } = await startServer('answer');
        const client = new RecipeServiceClient({ baseUrl, token: 'session-jwt' });

        const [found] = (await client.getIngredientFoodNutrition([ROOT])).entries;

        expect(found).toMatchObject({ outcome: 'found', freshness: 'stale', caloriesPer100g: 165 });
    });
});
