/**
 * The per-user cap on `GET /api/v1/foods/search/live` over a real HTTP listener (plan 002 S3, R42). Booted by
 * `support/mockedFoodsApi.ts` with the live search doubled, so no source is called and no database is needed.
 *
 * R42 requires this cap to be live before the recipe service's proxy is deleted (S6), because the proxy's per-user
 * limit is today the only one on this path. Food's aggregate lane limiter protects the SOURCE's quota; it cannot tell
 * one cook from another.
 *
 * | What the cap must do                                            | Pinned here                                     |
 * | --------------------------------------------------------------- | ----------------------------------------------- |
 * | admit a caller up to the limit, and refuse the next request     | `200` × limit, then `429`                        |
 * | refuse in the one error envelope, with a wait the client can use | `code: TOO_MANY_REQUESTS` and `Retry-After`     |
 * | count per USER, not per address                                 | a second user from the same address gets `200`  |
 * | sit on this route only                                          | no rate-limit headers on `/refs/resolve`        |
 * | never spend source quota on a refused request                   | the doubled search is called `limit` times only |
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@kitchensink/clerk-verify', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@kitchensink/clerk-verify')>();

    return { ...actual, verifyClerkToken: vi.fn() };
});

import { verifyClerkToken } from '@kitchensink/clerk-verify';

import { LIVE_SEARCH_PER_USER_LIMIT } from '../src/common/throttle/throttle.config.js';
import { apiErrorSchema } from '../src/common/apiError.schema.js';
import { bootMockedFoodsApi, principalFor, type MockedFoodsApi } from './support/mockedFoodsApi.js';

const mockVerify = vi.mocked(verifyClerkToken);
const LIVE = '/api/v1/foods/search/live?query=broccoli';

describe('GET /api/v1/foods/search/live — the per-user cap (booted Nest, source doubled)', () => {
    const search = vi.fn(async () => ({ results: [] }));
    let api: MockedFoodsApi;

    beforeAll(async () => {
        api = await bootMockedFoodsApi({
            foodDao: { readRefFacts: async () => [] },
            liveSearch: { search },
        });
    });

    afterAll(async () => {
        await api.close();
    });

    beforeEach(() => {
        mockVerify.mockReset();
        mockVerify.mockImplementation(async (token: string) => principalFor(token));
    });

    // ⛔ ONE case on purpose. The counters live for the app's life, so the limit, the refusal and the per-user split
    // are observed on one run in order; split across cases they would depend on which ran first.
    it('admits a caller up to the limit, refuses the next one, and counts each user apart', async () => {
        for (let request = 1; request <= LIVE_SEARCH_PER_USER_LIMIT; request += 1) {
            const res = await api.call('GET', LIVE, { token: 'author' });

            expect(res.status, `request ${request} of ${LIVE_SEARCH_PER_USER_LIMIT}`).toBe(200);
        }

        const refused = await api.call('GET', LIVE, { token: 'author' });

        expect(refused.status).toBe(429);
        // The one envelope, not the throttler's bare string. `TOO_MANY_REQUESTS` is the shared generic code for a
        // `429`; a client maps it by status.
        expect(apiErrorSchema.parse(refused.body)).toMatchObject({ code: 'TOO_MANY_REQUESTS' });
        expect(Number(refused.headers.get('retry-after'))).toBeGreaterThan(0);
        // The refusal happened before the handler: the source was asked exactly `limit` times.
        expect(search).toHaveBeenCalledTimes(LIVE_SEARCH_PER_USER_LIMIT);

        // Every request in this file comes from 127.0.0.1. A tracker keyed on the address would refuse this one too.
        const otherUser = await api.call('GET', LIVE, { token: 'stranger' });

        expect(otherUser.status).toBe(200);
    });

    it('advertises the limit on the capped route', async () => {
        const res = await api.call('GET', LIVE, { token: 'service' });

        expect(res.status).toBe(200);
        expect(res.headers.get('x-ratelimit-limit')).toBe(String(LIVE_SEARCH_PER_USER_LIMIT));
    });

    it('leaves the server-to-server routes uncapped', async () => {
        const res = await api.call('POST', '/api/v1/foods/refs/resolve', {
            token: 'author',
            body: { refs: [{ kind: 'root', id: '01JCATA10GF00D000000000000' }] },
        });

        expect(res.status).toBe(200);
        expect(res.headers.get('x-ratelimit-limit')).toBeNull();
    });
});
