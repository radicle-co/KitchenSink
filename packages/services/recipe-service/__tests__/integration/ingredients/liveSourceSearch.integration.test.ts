/**
 * Integration proof of the ON-DEMAND live source search (plan U29), over a REAL HTTP socket.
 *
 * The unit suites stub `fetch` and stub the gateway. This one stands up an actual `node:http` server
 * standing in for the food service and drives every real collaborator end to end —
 * `CallerToken` → `FoodServiceClients` → `FoodServiceClient` (its URL building, its status→error mapping,
 * its response parse) → the socket → `FoodCatalogGateway` → `IngredientsService`.
 *
 * ⛔ **What it exists to prove is that the THREE outcomes survive four hops.** They are produced by
 * food-service as three HTTP statuses, translated by the food client into three error types, folded by the
 * gateway into a three-member union and re-raised by the service as two distinct HTTP statuses. Every one of
 * those translations is a place a pair could silently collapse — and a mocked test at any single layer would
 * still pass while the chain was broken. A cook who cannot tell "the source has nothing for this" from "the
 * source did not answer" is stranded in the wrong loop: the first should make them stop looking, the second
 * should make them try again.
 *
 * It also pins two things no unit test can see:
 *  - the request really lands on `/api/v1/foods/search/live`, NOT the cheap local `/api/v1/foods/search`
 *    that a copy-paste would produce and that would silently make an explicit action fire a debounced read;
 *  - the caller's own bearer really arrives, since the food service admits only a verified Clerk token.
 *
 * No database is involved, so this runs with or without the Docker harness up. The DAL is doubled because
 * this path never touches it.
 *
 * @implements FR-007 FR-047 FR-010a
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpException, HttpStatus, Logger } from '@nestjs/common';

import { CallerToken } from '../../../src/auth/CallerToken.js';
import { FoodCatalogGateway } from '../../../src/ingredients/foodCatalog.gateway.js';
import { FoodServiceClients } from '../../../src/ingredients/FoodServiceClients.factory.js';
import { IngredientsService } from '../../../src/ingredients/ingredients.service.js';
import type { IngredientsDal } from '../../../src/ingredients/dal/ingredients.dal.js';

/** The caller credential every case forwards. */
const CALLER_SECRET = 'eyJhbGciOiJSUzI1NiJ9.COOK-SESSION-JWT-DO-NOT-LOG.sig';

/** How the stub food service should answer the next live-search request. */
type Behaviour = 'hits' | 'empty' | 'busy' | 'busy-without-window' | 'source-down';

/** One request as the stub food service saw it. */
interface ObservedRequest {
    readonly path: string;
    readonly authorization: string | undefined;
}

/** The client's fire-and-forget contract-skew probe — unauthenticated by design, and not what is under test. */
const SKEW_PROBE_PATH = '/health';

/** Wrap a raw bearer the way the `@CallerBearerToken()` decorator would. */
function callerToken(raw: string): CallerToken {
    const token = CallerToken.fromAuthorizationHeader(`Bearer ${raw}`);

    if (token === undefined) {
        throw new Error('fixture: expected a CallerToken');
    }

    return token;
}

/** A DAL double — the live path never touches the local catalog. */
function makeDal(): IngredientsDal {
    return { search: vi.fn(), findByFoodIds: vi.fn() } as unknown as IngredientsDal;
}

describe('the on-demand live source search over a REAL food-service socket (integration)', () => {
    let server: Server;
    let origin: string;
    let behaviour: Behaviour;
    let observed: ObservedRequest[];
    let service: IngredientsService;
    let clients: FoodServiceClients;

    beforeAll(async () => {
        server = createServer((req: IncomingMessage, res: ServerResponse) => {
            const path = (req.url ?? '').split('?')[0] ?? '';
            observed.push({ path, authorization: req.headers['authorization'] });

            if (path === SKEW_PROBE_PATH) {
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ status: 'ok', service: 'food' }));

                return;
            }

            const send = (status: number, body: unknown, headers: Record<string, string> = {}): void => {
                res.writeHead(status, { 'content-type': 'application/json', ...headers });
                res.end(JSON.stringify(body));
            };

            switch (behaviour) {
                case 'empty':
                    send(200, { results: [] });

                    return;
                case 'busy':
                    // Exactly what food-service answers when its reserved interactive lane is spent.
                    send(
                        503,
                        { code: 'FETCH_UNAVAILABLE', message: 'shed', details: { retryAfterSeconds: 60 } },
                        { 'retry-after': '60' },
                    );

                    return;
                case 'busy-without-window':
                    send(503, { code: 'FETCH_UNAVAILABLE', message: 'shed' });

                    return;
                case 'source-down':
                    send(502, { code: 'SOURCE_UNAVAILABLE', message: 'The food data source is unavailable' });

                    return;
                default:
                    send(200, { results: [{ name: 'Broccoli, raw', id: 'food-1' }, { name: 'Broccoli rabe' }] });
            }
        });

        await new Promise<void>((resolve) => {
            server.listen(0, '127.0.0.1', resolve);
        });
        origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

        // The gateway's degradation log is expected noise here; silence it so a real failure stands out.
        vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
        vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    });

    afterAll(async () => {
        vi.restoreAllMocks();
        await new Promise<void>((resolve) => {
            server.close(() => {
                resolve();
            });
        });
    });

    beforeEach(() => {
        behaviour = 'hits';
        observed = [];
        clients = new FoodServiceClients({ baseUrl: origin, typeaheadTimeoutMs: 150 });
        service = new IngredientsService(makeDal(), clients, new FoodCatalogGateway(clients, { enabled: true }));
    });

    /** The live-search requests the stub saw, excluding the background skew probe. */
    function liveRequests(): ObservedRequest[] {
        return observed.filter((request) => request.path !== SKEW_PROBE_PATH);
    }

    it('reaches the LIVE path with the caller’s own bearer — not the local search endpoint', async () => {
        await service.searchLive(callerToken(CALLER_SECRET), 'broccoli');

        // ⛔ `/api/v1/foods/search` would be the cheap local read: an explicit, quota-charging action quietly
        // wired to a debounced one, returning plausible results the whole time.
        expect(liveRequests()).toEqual([
            { path: '/api/v1/foods/search/live', authorization: `Bearer ${CALLER_SECRET}` },
        ]);
    });

    it('carries a hit’s food id through every hop, and omits it where the catalog has none', async () => {
        await expect(service.searchLive(callerToken(CALLER_SECRET), 'broccoli')).resolves.toEqual({
            hits: [{ name: 'Broccoli, raw', foodId: 'food-1' }, { name: 'Broccoli rabe' }],
        });
    });

    it('surfaces an EMPTY result set as a success — the source answered and has nothing', async () => {
        behaviour = 'empty';

        await expect(service.searchLive(callerToken(CALLER_SECRET), 'nosuchfood')).resolves.toEqual({ hits: [] });
    });

    it('translates food’s 503 into a 503 SOURCE_BUSY, carrying the retry window across four hops', async () => {
        behaviour = 'busy';

        const error = (await service
            .searchLive(callerToken(CALLER_SECRET), 'broccoli')
            .catch((thrown: unknown) => thrown)) as HttpException;

        expect(error).toBeInstanceOf(HttpException);
        expect(error.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
        expect(error.getResponse()).toMatchObject({ code: 'SOURCE_BUSY', details: { retryAfterSeconds: 60 } });
    });

    it('keeps the retry window ABSENT when food promised none, rather than inventing one', async () => {
        behaviour = 'busy-without-window';

        const error = (await service
            .searchLive(callerToken(CALLER_SECRET), 'broccoli')
            .catch((thrown: unknown) => thrown)) as HttpException;

        expect(error.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
        expect(error.getResponse()).toEqual({ code: 'SOURCE_BUSY', message: expect.any(String) });
    });

    it('translates food’s 502 into a 502 SOURCE_UNAVAILABLE — a DIFFERENT outcome from busy', async () => {
        behaviour = 'source-down';

        const error = (await service
            .searchLive(callerToken(CALLER_SECRET), 'broccoli')
            .catch((thrown: unknown) => thrown)) as HttpException;

        // ⛔ The collapse this whole suite guards: three statuses out of food, four translations, and a cook
        // must still be told three different things at the end of it.
        expect(error.getStatus()).toBe(HttpStatus.BAD_GATEWAY);
        expect(error.getResponse()).toMatchObject({ code: 'SOURCE_UNAVAILABLE' });
    });

    /**
     * ⛔ THE CASE THIS SUITE WAS MISSING, AND THE ONLY TIER THAT CAN HOLD IT. Every case above answers ON a
     * socket, so all of them exercise food's RESPONSE vocabulary; none of them ever asked what happens when
     * there is no socket at all. That is not a hypothetical — it is how the heavy k6 job and the
     * `recipes/ingredient-usda-search` Maestro flow both run food (`FOOD_SERVICE_URL` at a port with nothing
     * listening), and it is where the collapse hid: the client folds a raw transport failure into the same
     * `FetchUnavailableError` it raises for a response-borne `503`, so a dead service was reported to the
     * cook as "USDA searches are rate-limited and the limit is used up right now".
     *
     * A mocked client cannot prove this — the fold happens inside the client, at the boundary the mock
     * replaces. Only a genuinely refused connection reaches it.
     */
    it('translates an UNREACHABLE food service into SOURCE_UNAVAILABLE, never SOURCE_BUSY', async () => {
        // A port that is genuinely closed: bind one, learn its number, hand it back. Connecting is refused.
        const probe = createServer();

        await new Promise<void>((resolve) => {
            probe.listen(0, '127.0.0.1', resolve);
        });
        const deadPort = (probe.address() as AddressInfo).port;

        await new Promise<void>((resolve) => {
            probe.close(() => {
                resolve();
            });
        });

        const deadClients = new FoodServiceClients({
            baseUrl: `http://127.0.0.1:${String(deadPort)}`,
            typeaheadTimeoutMs: 150,
        });
        const deadService = new IngredientsService(
            makeDal(),
            deadClients,
            new FoodCatalogGateway(deadClients, { enabled: true }),
        );

        const error = (await deadService
            .searchLive(callerToken(CALLER_SECRET), 'broccoli')
            .catch((thrown: unknown) => thrown)) as HttpException;

        expect(error).toBeInstanceOf(HttpException);
        expect(error.getStatus()).toBe(HttpStatus.BAD_GATEWAY);
        expect(error.getResponse()).toMatchObject({ code: 'SOURCE_UNAVAILABLE' });
    });

    it('refuses a below-minimum query WITHOUT touching the socket at all (003-FR-010a)', async () => {
        const error = (await service
            .searchLive(callerToken(CALLER_SECRET), 'br')
            .catch((thrown: unknown) => thrown)) as HttpException;

        expect(error.getStatus()).toBe(HttpStatus.BAD_REQUEST);
        // The point of gating here rather than downstream: a query this short can never justify a request
        // against a shared external quota, so it must not become one.
        expect(liveRequests()).toEqual([]);
    });

    it('degrades to SOURCE_UNAVAILABLE without issuing a request when there is no caller credential', async () => {
        const error = (await service
            .searchLive(undefined, 'broccoli')
            .catch((thrown: unknown) => thrown)) as HttpException;

        expect(error.getStatus()).toBe(HttpStatus.BAD_GATEWAY);
        expect(liveRequests()).toEqual([]);
    });
});
