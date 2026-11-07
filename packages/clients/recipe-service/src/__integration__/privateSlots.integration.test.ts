/**
 * The private-slot read and the `403 PRIVATE_SLOTS_FULL` refusal over a REAL socket (ADR-0073), through the client's REAL
 * transport (`ky` over the platform `fetch`, no injected double).
 *
 * What only a socket proves: the request as it ARRIVES (a GET on the right path with the bearer), the union parsing off a
 * real response body, and - the one that matters to an installed client - that a `403` carrying the typed envelope arrives
 * as a `PrivateSlotsFullError` with the count and the limit, and NOT as the version-conflict error a `409` would have
 * become. A `403` with a body this build does not know falls to the generic forbidden error, which is how an older build
 * reads a code it predates.
 */
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';

import {
    ForbiddenError,
    PrivateSlotsFullError,
    RecipeServiceClient,
    VersionConflictError,
    shouldRetryRecipeServiceFailure,
} from '../index.js';
import { resetContractSkewLatchForTests } from '../contractSkew.js';

const RECIPE_ID = '00000000-0000-4000-8000-00000000000a';

interface Observed {
    readonly method: string;
    readonly url: string;
    readonly authorization: string | undefined;
}

let server: Server | undefined;

/** Boot a server answering every non-health request with `status` and `body`. @sideEffect Listens on an ephemeral port. */
async function startServer(status: number, body: unknown): Promise<{ baseUrl: string; received: Observed[] }> {
    const received: Observed[] = [];

    server = createServer((req: IncomingMessage, res: ServerResponse) => {
        if ((req.url ?? '') === '/health') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok', service: 'recipe' }));

            return;
        }

        received.push({ method: req.method ?? '', url: req.url ?? '', authorization: req.headers['authorization'] });
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
    });

    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));

    return { baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, received };
}

describe('the private-slot read and refusal over a real socket', () => {
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

    it('getPrivateSlots GETs /api/v1/recipes/private-slots with the bearer and parses the limited arm', async () => {
        const { baseUrl, received } = await startServer(200, { kind: 'limited', used: 12, limit: 50 });
        const client = new RecipeServiceClient({ baseUrl, token: 'session-jwt' });

        const result = await client.getPrivateSlots();

        expect(result).toStrictEqual({ kind: 'limited', used: 12, limit: 50 });
        expect(received).toHaveLength(1);
        expect(received[0]).toStrictEqual({
            method: 'GET',
            url: '/api/v1/recipes/private-slots',
            authorization: 'Bearer session-jwt',
        });
    });

    it('parses the unlimited arm Premium gets', async () => {
        const { baseUrl } = await startServer(200, { kind: 'unlimited' });

        await expect(new RecipeServiceClient({ baseUrl, token: 't' }).getPrivateSlots()).resolves.toStrictEqual({
            kind: 'unlimited',
        });
    });

    it('⛔ a 403 PRIVATE_SLOTS_FULL on a visibility write arrives as PrivateSlotsFullError with used and limit - never a version conflict - and is not retried', async () => {
        const { baseUrl } = await startServer(403, {
            code: 'PRIVATE_SLOTS_FULL',
            message: 'All of your private slots are in use.',
            details: { used: 60, limit: 50 },
        });
        const client = new RecipeServiceClient({ baseUrl, token: 't' });

        const failure = await client.setRecipeVisibility(RECIPE_ID, 'private').catch((error: unknown) => error);

        expect(failure).toBeInstanceOf(PrivateSlotsFullError);
        expect(failure).not.toBeInstanceOf(VersionConflictError);
        expect(failure).not.toBeInstanceOf(ForbiddenError);
        expect(failure).toMatchObject({ status: 403, used: 60, limit: 50 });
        expect(shouldRetryRecipeServiceFailure(failure)).toBe(false);
    });

    it('a 403 body this build does not know stays a plain refusal (how an older build reads a newer code)', async () => {
        const { baseUrl } = await startServer(403, { code: 'SOME_FUTURE_CODE', message: 'no' });

        const failure = await new RecipeServiceClient({ baseUrl, token: 't' })
            .setRecipeVisibility(RECIPE_ID, 'private')
            .catch((error: unknown) => error);

        expect(failure).not.toBeInstanceOf(VersionConflictError);
        expect(failure).toMatchObject({ status: 403 });
    });
});
