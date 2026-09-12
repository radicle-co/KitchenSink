/**
 * The per-user caps on the routes a cook calls that make source calls, over a real HTTP listener (plan 002 S3, R42;
 * security review C2). Booted by `support/mockedFoodsApi.ts` with the handlers' collaborators doubled, so no source is
 * called and no database is needed. Food's aggregate lane limiter protects the SOURCE's quota; it cannot tell one cook
 * from another.
 *
 * Rewritten from the live search's cap suite when plan 002 S7.9 deleted that route: its cases now drive the remote
 * pick, which carries the same guard.
 *
 * | What the cap must do                                            | Pinned here                                     |
 * | --------------------------------------------------------------- | ----------------------------------------------- |
 * | admit a caller up to the limit, and refuse the next request     | `200` × limit, then `429`                        |
 * | refuse as the caller's own limit, with a wait the client can use | `REQUESTER_LIMIT_REACHED`, the window, header   |
 * | count per USER, not per address                                 | a second user from the same address gets `200`  |
 * | sit on the capped routes only                                   | no rate-limit headers on `/refs/resolve`        |
 * | never spend source quota on a refused request                   | the doubled handler is called `limit` times only |
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@kitchensink/clerk-verify', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@kitchensink/clerk-verify')>();

    return { ...actual, verifyClerkToken: vi.fn() };
});

import { verifyClerkToken } from '@kitchensink/clerk-verify';

import { ADOPT_PER_USER_LIMIT, RESOLVE_PER_USER_LIMIT } from '../src/common/throttle/throttle.config.js';
import { foodErrorSchema } from '../src/foods/foods.schema.js';
import { bootMockedFoodsApi, principalFor, type MockedFoodsApi } from './support/mockedFoodsApi.js';

const mockVerify = vi.mocked(verifyClerkToken);
const ADOPT = '/api/v1/foods/remote/adopt';
const PICK = { reference: 'sealed-reference' };

describe('POST /api/v1/foods/remote/adopt — the per-user cap (booted Nest, pick doubled)', () => {
    const execute = vi.fn(async () => ({ id: 'R-adopted' }));
    let api: MockedFoodsApi;

    beforeAll(async () => {
        api = await bootMockedFoodsApi({
            foodDao: { readRefFacts: async () => [] },
            remoteAdopt: { execute },
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
        for (let request = 1; request <= ADOPT_PER_USER_LIMIT; request += 1) {
            const res = await api.call('POST', ADOPT, { token: 'author', body: PICK });

            expect(res.status, `request ${request} of ${ADOPT_PER_USER_LIMIT}`).toBe(200);
        }

        const refused = await api.call('POST', ADOPT, { token: 'author', body: PICK });

        expect(refused.status).toBe(429);
        // The caller's own limit, in the code the hourly budget answers too (row editor item 10), with the window in
        // the body and the header alike.
        const body = foodErrorSchema.parse(refused.body);

        expect(body).toMatchObject({ code: 'REQUESTER_LIMIT_REACHED' });
        expect(Number(refused.headers.get('retry-after'))).toBeGreaterThan(0);
        expect(body.code === 'REQUESTER_LIMIT_REACHED' && body.details.retryAfterSeconds).toBe(
            Number(refused.headers.get('retry-after')),
        );
        // The refusal happened before the handler: the pick ran exactly `limit` times.
        expect(execute).toHaveBeenCalledTimes(ADOPT_PER_USER_LIMIT);

        // Every request in this file comes from 127.0.0.1. A tracker keyed on the address would refuse this one too.
        const otherUser = await api.call('POST', ADOPT, { token: 'stranger', body: PICK });

        expect(otherUser.status).toBe(200);
    });

    it('advertises the limit on the capped route', async () => {
        const res = await api.call('POST', ADOPT, { token: 'service', body: PICK });

        expect(res.status).toBe(200);
        expect(res.headers.get('x-ratelimit-limit')).toBe(String(ADOPT_PER_USER_LIMIT));
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

/**
 * The per-user cap on `PATCH /api/v1/foods/{id}` (security review C2). Each resolve calls the source once per pick, so
 * a caller who repeats it spends the shared window. The food double answers `RESOLVED`, the idempotent no-op, so no
 * source is called and the cap is the only thing observed.
 */
describe('PATCH /api/v1/foods/{id} — the per-user cap (booted Nest, food doubled)', () => {
    const getById = vi.fn(async (id: string) => ({ id, status: 'RESOLVED' }));
    const RESOLVE = '/api/v1/foods/01JCATA10GF00D000000000000';
    const body = { candidateIds: ['01JCAND1DATE00000000000000'] };
    let api: MockedFoodsApi;

    beforeAll(async () => {
        api = await bootMockedFoodsApi({ foodDao: { readRefFacts: async () => [], getById } });
    });

    afterAll(async () => {
        await api.close();
    });

    beforeEach(() => {
        mockVerify.mockReset();
        mockVerify.mockImplementation(async (token: string) => principalFor(token));
    });

    it('admits a caller up to the limit, refuses the next one before the handler, and counts each user apart', async () => {
        for (let request = 1; request <= RESOLVE_PER_USER_LIMIT; request += 1) {
            const res = await api.call('PATCH', RESOLVE, { token: 'author', body });

            expect(res.status, `request ${request} of ${RESOLVE_PER_USER_LIMIT}`).toBe(200);
        }

        const refused = await api.call('PATCH', RESOLVE, { token: 'author', body });

        expect(refused.status).toBe(429);
        expect(foodErrorSchema.parse(refused.body)).toMatchObject({ code: 'REQUESTER_LIMIT_REACHED' });
        expect(getById).toHaveBeenCalledTimes(RESOLVE_PER_USER_LIMIT);

        const otherUser = await api.call('PATCH', RESOLVE, { token: 'stranger', body });

        expect(otherUser.status).toBe(200);
    });
});
