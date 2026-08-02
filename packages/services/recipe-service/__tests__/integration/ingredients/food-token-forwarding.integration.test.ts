/**
 * Integration proof of the CALLER-TOKEN forwarding seam (issue #120), over a REAL HTTP server.
 *
 * The unit tests stub `fetch`; this spec does not. It stands up an actual `node:http` server standing in for
 * the food service, and drives the real collaborators end to end —
 * `CallerToken` → `FoodServiceClients` → `FoodServiceClient` → the socket → `FoodCatalogGateway` →
 * `IngredientsService`. So what it pins is what the food service would actually observe on the wire, which is
 * the only place the defect this closes could be verified:
 *
 *  1. The `Authorization: Bearer <caller token>` header REALLY arrives at the food origin. (Before #120 the
 *     header was built from a static `FOOD_SERVICE_TOKEN` that no environment ever set, at an origin that
 *     defaulted to `http://localhost:3002` — the container itself — so nothing arrived anywhere.)
 *  2. Two concurrent requests from different users do not cross credentials — the per-request client really is
 *     per request, not a memoised singleton.
 *  3. A food `401` (an expired/rejected token) degrades the typeahead to local-only rather than failing the
 *     request, and the credential appears in NO log line the gateway emits.
 *  4. The sub-second typeahead deadline is enforced by a REAL `AbortSignal` against a REAL hung socket, while
 *     the 8s standard client is unaffected — the two budgets are genuinely separate.
 *  5. `FoodCatalogGateway` issues NO request at all when the caller has no credential.
 *
 * No database is involved, so this runs with or without the Docker harness up (`tests/global-setup.ts` is a
 * no-op without `DATABASE_URL`); the DAL is the one collaborator doubled, because it is not what is under test
 * here (the DAL-and-real-SQL half of the blend is `blended-suggest.integration.test.ts`).
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { inspect } from 'node:util';
import type { AddressInfo } from 'node:net';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';

import { CallerToken } from '../../../src/auth/caller-token.js';
import { FoodCatalogGateway } from '../../../src/ingredients/food-catalog.gateway.js';
import { FoodServiceClients } from '../../../src/ingredients/food-service-clients.factory.js';
import { IngredientsService } from '../../../src/ingredients/ingredients.service.js';
import type { IngredientsDal } from '../../../src/ingredients/dal/ingredients.dal.js';
import { makeIngredient } from '../../../src/ingredients/__fixtures__/ingredients.fixtures.js';

/** Two distinguishable caller credentials — a leak or a swap is unmistakable. */
const ALICE_SECRET = 'eyJhbGciOiJSUzI1NiJ9.ALICE-SESSION-JWT-DO-NOT-LOG.sig';
const BOB_SECRET = 'eyJhbGciOiJSUzI1NiJ9.BOB-SESSION-JWT-DO-NOT-LOG.sig';

/** The sub-second typeahead deadline used throughout (short enough to keep the suite quick). */
const TYPEAHEAD_TIMEOUT_MS = 150;

/** How the stub food service should answer the next request. */
type Behaviour = 'ok' | 'unauthorized' | 'hang';

/** Wrap a raw bearer the way the `@CallerBearerToken()` decorator would. */
function callerToken(raw: string): CallerToken {
    const token = CallerToken.fromAuthorizationHeader(`Bearer ${raw}`);

    if (token === undefined) {
        throw new Error('fixture: expected a CallerToken');
    }

    return token;
}

/** A DAL double: the local half of the blend is proven elsewhere; here it just returns one row. */
function makeDal(): IngredientsDal {
    return {
        search: vi.fn().mockResolvedValue([makeIngredient({ id: 'local-1', name: 'Local chicken' })]),
        findByFoodIds: vi.fn().mockResolvedValue([]),
    } as unknown as IngredientsDal;
}

describe('forwarding the caller credential to a REAL food-service socket (integration)', () => {
    let server: Server;
    let origin: string;
    let behaviour: Behaviour;
    /** Every `Authorization` header the stub food service saw, in arrival order. */
    let observedAuthorization: (string | undefined)[];
    /** Sockets parked by the `hang` behaviour, destroyed on teardown so the suite cannot leak one. */
    let hungResponses: ServerResponse[];

    beforeAll(async () => {
        server = createServer((req: IncomingMessage, res: ServerResponse) => {
            observedAuthorization.push(req.headers['authorization']);

            if (behaviour === 'hang') {
                hungResponses.push(res);

                return; // Never answer: the client's AbortSignal is the only thing that can end this.
            }

            if (behaviour === 'unauthorized') {
                res.writeHead(401, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ error: 'Valid Clerk session or M2M token required' }));

                return;
            }

            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ results: [{ id: 'food-1', name: 'Chicken breast, raw', score: 0.9 }] }));
        });

        await new Promise<void>((resolve) => {
            server.listen(0, '127.0.0.1', resolve);
        });

        origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    afterAll(async () => {
        for (const res of hungResponses) {
            res.destroy();
        }

        await new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
        });
    });

    beforeEach(() => {
        behaviour = 'ok';
        observedAuthorization = [];
        hungResponses = [];
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    /** The real factory pointed at the stub server. */
    const clients = (): FoodServiceClients =>
        new FoodServiceClients({ baseUrl: origin, typeaheadTimeoutMs: TYPEAHEAD_TIMEOUT_MS });

    it('delivers the caller’s bearer to the food service on the blended typeahead path', async () => {
        const service = new IngredientsService(
            makeDal(),
            clients(),
            new FoodCatalogGateway(clients(), { enabled: true }),
        );

        const result = await service.suggest(callerToken(ALICE_SECRET), 'chicken', 10);

        expect(observedAuthorization).toEqual([`Bearer ${ALICE_SECRET}`]);
        expect(result.catalogAvailability).toBe('ok');
        expect(result.suggestions.some((suggestion) => suggestion.provenance === 'catalog')).toBe(true);
    });

    it('delivers the caller’s bearer on the 8s standard path too (addByName)', async () => {
        await clients().standard(callerToken(BOB_SECRET)).search('chicken');

        expect(observedAuthorization).toEqual([`Bearer ${BOB_SECRET}`]);
    });

    it('never crosses credentials between concurrent callers', async () => {
        const gateway = new FoodCatalogGateway(clients(), { enabled: true });

        await Promise.all([
            gateway.search(callerToken(ALICE_SECRET), 'chicken', 10),
            gateway.search(callerToken(BOB_SECRET), 'beef', 10),
        ]);

        // Order is not deterministic under concurrency; the SET is what matters — each request carried exactly
        // its own caller's token, and neither carried the other's.
        expect([...observedAuthorization].sort()).toEqual([`Bearer ${ALICE_SECRET}`, `Bearer ${BOB_SECRET}`].sort());
    });

    it('degrades to local-only on a food 401, and logs nothing containing the credential', async () => {
        behaviour = 'unauthorized';
        const logged: string[] = [];
        const capture = (...args: unknown[]): void => {
            logged.push(args.map((arg) => (typeof arg === 'string' ? arg : inspect(arg, { depth: null }))).join(' '));
        };
        vi.spyOn(Logger.prototype, 'warn').mockImplementation(capture);
        vi.spyOn(Logger.prototype, 'debug').mockImplementation(capture);
        vi.spyOn(Logger.prototype, 'error').mockImplementation(capture);
        const service = new IngredientsService(
            makeDal(),
            clients(),
            new FoodCatalogGateway(clients(), { enabled: true }),
        );

        const result = await service.suggest(callerToken(ALICE_SECRET), 'chicken', 10);

        // The user still gets their typeahead, with the catalog's absence reported honestly…
        expect(result.catalogAvailability).toBe('unavailable');
        expect(result.suggestions).toEqual([
            { provenance: 'local', ingredient: makeIngredient({ id: 'local-1', name: 'Local chicken' }) },
        ]);
        // …and the credential is nowhere in what we wrote about the failure.
        expect(logged.length).toBeGreaterThan(0);
        expect(logged.join('\n')).not.toContain(ALICE_SECRET);
        expect(logged.join('\n')).not.toContain('ALICE-SESSION-JWT');
    });

    it('enforces the sub-second typeahead deadline against a REAL hung socket', async () => {
        behaviour = 'hang';
        const gateway = new FoodCatalogGateway(clients(), { enabled: true });
        const startedAt = Date.now();

        const outcome = await gateway.search(callerToken(ALICE_SECRET), 'chicken', 10);
        const elapsed = Date.now() - startedAt;

        expect(outcome).toEqual({ hits: [], availability: 'unavailable' });
        // Bounded by the transport deadline, not by the 8s default. The upper bound is generous so the
        // assertion is about a bound EXISTING rather than about scheduler jitter.
        expect(elapsed).toBeLessThan(2_000);
        // The request DID go out (it is the socket that hung), so the header was on the wire.
        expect(observedAuthorization).toEqual([`Bearer ${ALICE_SECRET}`]);
    });

    it('does NOT abort the 8s standard client at the typeahead deadline (separate budgets)', async () => {
        const slowServer = createServer((_req: IncomingMessage, res: ServerResponse) => {
            setTimeout(() => {
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ results: [] }));
            }, TYPEAHEAD_TIMEOUT_MS * 3);
        });

        await new Promise<void>((resolve) => {
            slowServer.listen(0, '127.0.0.1', resolve);
        });

        try {
            const slowOrigin = `http://127.0.0.1:${(slowServer.address() as AddressInfo).port}`;
            const factory = new FoodServiceClients({
                baseUrl: slowOrigin,
                typeaheadTimeoutMs: TYPEAHEAD_TIMEOUT_MS,
            });

            await expect(factory.standard(callerToken(ALICE_SECRET)).search('chicken')).resolves.toEqual({
                results: [],
            });
        } finally {
            await new Promise<void>((resolve, reject) => {
                slowServer.close((error) => (error ? reject(error) : resolve()));
            });
        }
    });

    it('issues NO request when the caller has no credential (never an unauthenticated call)', async () => {
        const gateway = new FoodCatalogGateway(clients(), { enabled: true });

        const outcome = await gateway.search(undefined, 'chicken', 10);

        expect(outcome).toEqual({ hits: [], availability: 'unavailable' });
        expect(observedAuthorization).toEqual([]);
    });
});
