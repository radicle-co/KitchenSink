/**
 * Food's browser boundary over a real HTTP listener (plan 002 S4, R41, ADR-0047): the CORS headers food sends on its
 * REAL routes, with `FoodAuthGuard` mounted exactly as `FoodsModule` mounts it. Booted by `support/mockedFoodsApi.ts`,
 * which installs CORS through the same `corsPolicyFromEnv` that `main.ts` calls. No database.
 *
 * Rewritten onto the progressive search, the search a browser calls, when plan 002 S7.9 deleted the live search.
 *
 * | What a browser needs                                             | Pinned here                                        |
 * | ---------------------------------------------------------------- | -------------------------------------------------- |
 * | the preflight is answered by CORS, not by the router or the guard | `204` with the admitted origin on each preflight path |
 * | a foreign origin gets nothing it can use                         | no allow-origin, and `Vary: Origin` still present  |
 * | the real response carries the allow-origin                       | the authenticated `200`                            |
 * | an auth failure is readable, so the client can refresh its token | the `401` carries the allow-origin too             |
 * | no credentials are granted, because food reads no cookie          | no `Access-Control-Allow-Credentials` anywhere     |
 * | the browser caches the preflight instead of repeating it          | `Access-Control-Max-Age: 600` on the preflight     |
 * | a refused caller can read how long to wait                        | the `429` exposes `Retry-After` to the script      |
 *
 * What the policy decides per stage is `src/config/__tests__/cors.test.ts`; that `main.ts` installs it is
 * `src/config/__tests__/corsWiring.test.ts`.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@kitchensink/clerk-verify', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@kitchensink/clerk-verify')>();

    return { ...actual, verifyClerkToken: vi.fn() };
});

import { verifyClerkToken } from '@kitchensink/clerk-verify';

import { SEARCH_PER_USER_LIMIT } from '../src/common/throttle/throttle.config.js';
import { foodErrorSchema } from '../src/foods/foods.schema.js';
import { bootMockedFoodsApi, principalFor, type MockedFoodsApi } from './support/mockedFoodsApi.js';

const mockVerify = vi.mocked(verifyClerkToken);

/** The origin the harness's `CLERK_AUTHORIZED_PARTIES` admits. */
const ADMITTED = 'https://app.example.com';

/** An origin nothing admits. */
const FOREIGN = 'https://evil.example';

const SEARCH = '/api/v1/foods/search/progressive?query=broccoli';

/** The preflight a browser sends before a credentialed `GET`. */
function preflightHeaders(origin: string): Record<string, string> {
    return {
        origin,
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'authorization,content-type',
    };
}

describe('food CORS on the real routes (booted Nest, persistence doubled)', () => {
    let api: MockedFoodsApi;

    beforeAll(async () => {
        api = await bootMockedFoodsApi({
            foodDao: {},
            // One frame, so the harness reads the body as one JSON value.
            progressive: {
                run: async (_request, sink) => {
                    sink.write({ type: 'complete' });
                },
            },
        });
    });

    afterAll(async () => {
        await api.close();
    });

    beforeEach(() => {
        mockVerify.mockReset();
        mockVerify.mockImplementation(async (token: string) => principalFor(token));
    });

    // ⛔ The red this suite was written against: before CORS was installed, every preflight got Nest's `404` (there is
    // no `OPTIONS` route) with no allow-origin, and a browser reads that as a CORS failure. A preflight carries no
    // `Authorization`, so it must be answered before `FoodAuthGuard` could ever see it.
    it.each([SEARCH, '/api/v1/foods/nutrition?ids=01JCATA10GF00D000000000000', '/v1/foods/nutrition?ids=x'])(
        'answers the preflight for %s itself, admitting the web origin',
        async (path) => {
            const res = await api.call('OPTIONS', path, { headers: preflightHeaders(ADMITTED) });

            expect(res.status).toBe(204);
            expect(res.headers.get('access-control-allow-origin')).toBe(ADMITTED);
            // Food is bearer-only, so it grants no credentials (plan 002 S4 review, F2). Rewritten from `'true'`:
            // with the header, a same-site cookie riding an `include` fetch would be readable by every admitted
            // origin the day something past the bearer-only guard read one.
            expect(res.headers.get('access-control-allow-credentials')).toBeNull();
            // F7: a browser that may cache this answer stops preflighting every few seconds.
            expect(res.headers.get('access-control-max-age')).toBe('600');
            expect(res.headers.get('access-control-allow-headers')).toContain('Authorization');
            expect(res.headers.get('access-control-allow-headers')).toContain('Content-Type');
            expect(res.headers.get('vary')).toContain('Origin');
        },
    );

    it('refuses a foreign origin on the preflight, where the browser checks', async () => {
        const res = await api.call('OPTIONS', SEARCH, { headers: preflightHeaders(FOREIGN) });

        expect(res.headers.get('access-control-allow-origin')).toBeNull();
        // The middleware still ran: the denial is a decision, so a cache keyed on `Origin` keeps the two apart.
        expect(res.headers.get('vary')).toContain('Origin');
    });

    it('echoes the admitted origin on the real authenticated response', async () => {
        const res = await api.call('GET', SEARCH, { token: 'author', headers: { origin: ADMITTED } });

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ type: 'complete' });
        expect(res.headers.get('access-control-allow-origin')).toBe(ADMITTED);
        expect(res.headers.get('vary')).toContain('Origin');
    });

    it('sends no allow-origin to a foreign origin on the real response', async () => {
        const res = await api.call('GET', SEARCH, { token: 'author', headers: { origin: FOREIGN } });

        expect(res.headers.get('access-control-allow-origin')).toBeNull();
    });

    it('makes a 401 readable by the admitted origin, so the client can refresh its token and retry', async () => {
        const res = await api.call('GET', SEARCH, { headers: { origin: ADMITTED } });

        expect(res.status).toBe(401);
        expect(foodErrorSchema.parse(res.body)).toMatchObject({ code: 'UNAUTHORIZED' });
        expect(res.headers.get('access-control-allow-origin')).toBe(ADMITTED);
        expect(res.headers.get('access-control-allow-credentials')).toBeNull();
    });

    // F3. Without `Access-Control-Expose-Headers`, a browser script reads `Retry-After` as `null` even though the
    // header is on the wire, so the client cannot wait the time the server asked for.
    it('lets the admitted origin read Retry-After on a 429', async () => {
        mockVerify.mockImplementation(async () => ({
            sub: 'user_cors_throttled',
            scopes: [],
            permissions: [],
            testPrincipal: false,
        }));

        for (let request = 1; request <= SEARCH_PER_USER_LIMIT; request += 1) {
            await api.call('GET', SEARCH, { token: 'throttled', headers: { origin: ADMITTED } });
        }

        const refused = await api.call('GET', SEARCH, { token: 'throttled', headers: { origin: ADMITTED } });

        expect(refused.status).toBe(429);
        expect(Number(refused.headers.get('retry-after'))).toBeGreaterThan(0);
        expect(refused.headers.get('access-control-allow-origin')).toBe(ADMITTED);
        expect(refused.headers.get('access-control-expose-headers')).toBe('Retry-After');
    });
});
