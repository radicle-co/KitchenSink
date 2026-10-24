/**
 * The per-requester source budget on the remote pick and resolve, over a real HTTP listener (plan 002, the hourly cap
 * owed before S6). Booted by `support/mockedFoodsApi.ts` with the budget's store doubled by
 * `support/sourceBudgetFake.ts`, which keeps its contract, so no database is needed. The store's own behaviour is
 * `tests/e2e/requesterSourceBudget.e2e.test.ts`.
 *
 * Rewritten onto the remote pick when plan 002 S7.9 deleted the live search, which charged the same budget.
 *
 * A doubled pick "makes" its source call the way the transport does: by being admitted through a real
 * {@link MeteredAdmission}. So what is refunded is decided by the real meter, through Nest's real interceptor chain.
 *
 * | What the budget must do on the wire                                      | Pinned here                                     |
 * | ------------------------------------------------------------------------ | ----------------------------------------------- |
 * | refuse past the budget before the handler, as the requester's own limit  | `429 REQUESTER_LIMIT_REACHED`, the window, header |
 * | count one budget across the remote pick AND resolve                      | a pick's spend refuses a resolve                |
 * | count per requester                                                      | a second user is admitted                       |
 * | keep a call that was made                                                | a pick that fetched is not refunded             |
 * | refund the calls not made                                                | a busy pick, a resolved food, a refused body    |
 * | run after the per-minute cap                                             | a per-minute refusal charges nothing            |
 * | fail closed, retryably, when its store fails                             | `503 FETCH_UNAVAILABLE` + `Retry-After`         |
 * | key a user on the app id, deferring one whose id has not synced           | `401 IDENTITY_SYNC_PENDING`, no charge          |
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('@kitchensink/clerk-verify', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@kitchensink/clerk-verify')>();

    return { ...actual, verifyClerkToken: vi.fn() };
});

import { verifyClerkToken } from '@kitchensink/clerk-verify';

import { apiErrorSchema } from '../src/common/apiError.schema.js';
import { MeteredAdmission } from '../src/common/throttle/meteredAdmission.js';
import {
    REQUESTER_SOURCE_BUDGET_PER_HOUR,
    REQUESTER_SOURCE_BUDGET_RETRY_SECONDS,
    REQUESTER_SOURCE_BUDGET_WINDOW_SECONDS,
    RESOLVE_PER_USER_LIMIT,
} from '../src/common/throttle/throttle.config.js';
import { AUTHOR_ID } from '../src/foods/__fixtures__/foodRefFacts.js';
import { FetchUnavailableError } from '../src/foods/foods.errors.js';
import { foodErrorSchema } from '../src/foods/foods.schema.js';
import type { AdoptRemoteFood } from '../src/foods/remote/AdoptRemoteFood.js';
import { bootMockedFoodsApi, principalFor, type MockedFoodsApi } from './support/mockedFoodsApi.js';
import { fakeSourceBudget } from './support/sourceBudgetFake.js';

const mockVerify = vi.mocked(verifyClerkToken);
const ADOPT = '/api/v1/foods/remote/adopt';
const PICK = { reference: 'sealed-reference' };
const RESOLVE = '/api/v1/foods/01JCATA10GF00D000000000000';

/** The wait the fake answers a refusal with, so the header can be traced to the store's answer. */
const FAKE_RETRY_SECONDS = 2_917;

/** The transport's admission, as the API composes it; the window behind it admits every call. */
const transport = new MeteredAdmission({ admit: async () => ({ admitted: true }) });

/**
 * A remote pick double that fetches its item once, through the metered transport, and answers a new root.
 *
 * @returns The double.
 */
function pickThatCalls(): Mock<AdoptRemoteFood['execute']> {
    return vi.fn<AdoptRemoteFood['execute']>(async () => {
        await transport.admit('usda', 'interactive');

        return { id: 'R-adopted' };
    });
}

/** `count` distinct candidate ids. */
function picks(count: number): string[] {
    return Array.from({ length: count }, (_, index) => `01JCAND1DATE0000000000${String(index).padStart(4, '0')}`);
}

beforeEach(() => {
    mockVerify.mockReset();
    mockVerify.mockImplementation(async (token: string) => principalFor(token));
});

describe('one budget across the remote pick and resolve (booted Nest, store doubled)', () => {
    const pick = pickThatCalls();
    const getById = vi.fn(async (id: string) => ({ id, status: 'RESOLVED' }));
    const budget = fakeSourceBudget(FAKE_RETRY_SECONDS);
    let api: MockedFoodsApi;

    beforeAll(async () => {
        api = await bootMockedFoodsApi({
            foodDao: { readRefFacts: async () => [], getById },
            remoteAdopt: { execute: pick },
            sourceBudget: budget.store,
        });
    });

    afterAll(async () => {
        await api.close();
    });

    // ⛔ ONE case on purpose: the fake's counts live for the app's life, so the spend, the refusal and the per-user split
    // are observed on one run in order.
    it('keeps the call a pick made, then refuses both routes before their handlers, per requester', async () => {
        // The rest of the author's hour is spent before the first request, as on another task: the budget is held in the
        // database, and the pick's per-minute cap is below it.
        await budget.store.charge({
            requesterId: AUTHOR_ID,
            cost: REQUESTER_SOURCE_BUDGET_PER_HOUR - 1,
            limit: REQUESTER_SOURCE_BUDGET_PER_HOUR,
            windowSeconds: REQUESTER_SOURCE_BUDGET_WINDOW_SECONDS,
        });

        expect((await api.call('POST', ADOPT, { token: 'author', body: PICK })).status).toBe(200);
        // The pick asked the source, so nothing was given back.
        expect(budget.refunds).toStrictEqual([]);
        expect(budget.spentBy(AUTHOR_ID)).toBe(REQUESTER_SOURCE_BUDGET_PER_HOUR);

        const refused = await api.call('POST', ADOPT, { token: 'author', body: PICK });

        expect(refused.status).toBe(429);
        expect(foodErrorSchema.parse(refused.body)).toMatchObject({
            code: 'REQUESTER_LIMIT_REACHED',
            details: { retryAfterSeconds: FAKE_RETRY_SECONDS },
        });
        expect(refused.headers.get('retry-after')).toBe(String(FAKE_RETRY_SECONDS));
        expect(pick).toHaveBeenCalledTimes(1);

        const resolve = await api.call('PATCH', RESOLVE, { token: 'author', body: { candidateIds: picks(1) } });

        expect(resolve.status).toBe(429);
        expect(foodErrorSchema.parse(resolve.body)).toMatchObject({ code: 'REQUESTER_LIMIT_REACHED' });
        expect(getById).not.toHaveBeenCalled();

        // Every charge is keyed on the app id, never on the token subject.
        expect(new Set(budget.charges.map((charge) => charge.requesterId))).toEqual(new Set([AUTHOR_ID]));

        const otherUser = await api.call('POST', ADOPT, { token: 'stranger', body: PICK });

        expect(otherUser.status).toBe(200);
    });
});

describe('the calls a request did not make are refunded (booted Nest, store doubled)', () => {
    const busyPick = vi.fn(async () => {
        throw new FetchUnavailableError(60);
    });
    const getById = vi.fn(async (id: string) => ({ id, status: 'RESOLVED' }));
    const budget = fakeSourceBudget();
    let api: MockedFoodsApi;

    beforeAll(async () => {
        api = await bootMockedFoodsApi({
            foodDao: { readRefFacts: async () => [], getById },
            remoteAdopt: { execute: busyPick },
            sourceBudget: budget.store,
        });
    });

    afterAll(async () => {
        await api.close();
    });

    // A resolve takes one pick (owner ruling, 2026-10-02), so it costs one call.
    it('charges a resolve its one pick, and gives it back when the food was already resolved', async () => {
        expect((await api.call('PATCH', RESOLVE, { token: 'author', body: { candidateIds: picks(1) } })).status).toBe(
            200,
        );

        expect(budget.charges.map((charge) => charge.cost)).toEqual([1]);
        expect(budget.refunds.map((refund) => refund.calls)).toEqual([1]);
        expect(budget.spentBy(AUTHOR_ID)).toBe(0);
    });

    it('charges one call for a body the pipe refuses, and gives it back', async () => {
        const before = budget.refunds.length;

        expect((await api.call('PATCH', RESOLVE, { token: 'author', body: { candidateIds: 'x' } })).status).toBe(400);

        expect(budget.charges.at(-1)?.cost).toBe(1);
        expect(budget.refunds.slice(before)).toStrictEqual([{ requesterId: AUTHOR_ID, calls: 1 }]);
    });

    it('gives back a pick whose source was busy, and still answers the busy 503', async () => {
        const before = budget.refunds.length;
        const res = await api.call('POST', ADOPT, { token: 'author', body: PICK });

        expect(res.status).toBe(503);
        expect(foodErrorSchema.parse(res.body)).toMatchObject({ code: 'FETCH_UNAVAILABLE' });
        expect(budget.refunds.slice(before)).toStrictEqual([{ requesterId: AUTHOR_ID, calls: 1 }]);
        expect(budget.spentBy(AUTHOR_ID)).toBe(0);
    });
});

describe('the budget runs after the per-minute cap (booted Nest, store doubled)', () => {
    const getById = vi.fn(async (id: string) => ({ id, status: 'RESOLVED' }));
    const budget = fakeSourceBudget();
    let api: MockedFoodsApi;

    beforeAll(async () => {
        api = await bootMockedFoodsApi({
            foodDao: { readRefFacts: async () => [], getById },
            sourceBudget: budget.store,
        });
    });

    afterAll(async () => {
        await api.close();
    });

    it('charges nothing for a request the per-minute cap refuses', async () => {
        for (let request = 1; request <= RESOLVE_PER_USER_LIMIT; request += 1) {
            await api.call('PATCH', RESOLVE, { token: 'author', body: { candidateIds: picks(1) } });
        }

        const refused = await api.call('PATCH', RESOLVE, { token: 'author', body: { candidateIds: picks(1) } });

        expect(refused.status).toBe(429);
        expect(foodErrorSchema.parse(refused.body)).toMatchObject({ code: 'REQUESTER_LIMIT_REACHED' });
        expect(budget.charges).toHaveLength(RESOLVE_PER_USER_LIMIT);
    });
});

describe('the budget fails closed when its store fails (booted Nest, store doubled)', () => {
    const pick = pickThatCalls();
    const refund = vi.fn(async () => 'refunded' as const);
    let api: MockedFoodsApi;

    beforeAll(async () => {
        api = await bootMockedFoodsApi({
            foodDao: { readRefFacts: async () => [] },
            remoteAdopt: { execute: pick },
            sourceBudget: {
                charge: async () => {
                    throw new Error('connection terminated unexpectedly');
                },
                refund,
            },
        });
    });

    afterAll(async () => {
        await api.close();
    });

    it('answers a retryable 503, never reaches the handler, and refunds nothing it did not charge', async () => {
        const res = await api.call('POST', ADOPT, { token: 'author', body: PICK });

        expect(res.status).toBe(503);
        expect(apiErrorSchema.parse(res.body)).toMatchObject({ code: 'FETCH_UNAVAILABLE' });
        expect(res.headers.get('retry-after')).toBe(String(REQUESTER_SOURCE_BUDGET_RETRY_SECONDS));
        // Nothing about the store reaches the caller.
        expect(res.text).not.toContain('connection terminated');
        expect(pick).not.toHaveBeenCalled();
        expect(refund).not.toHaveBeenCalled();
    });
});

describe('who the budget charges (booted Nest, store doubled)', () => {
    const pick = pickThatCalls();
    const budget = fakeSourceBudget();
    let api: MockedFoodsApi;

    beforeAll(async () => {
        api = await bootMockedFoodsApi({
            foodDao: { readRefFacts: async () => [] },
            remoteAdopt: { execute: pick },
            sourceBudget: budget.store,
        });
    });

    afterAll(async () => {
        await api.close();
    });

    it('defers a user whose app id has not synced, with 401 IDENTITY_SYNC_PENDING, charging nothing', async () => {
        const res = await api.call('POST', ADOPT, { token: 'unsynced', body: PICK });

        expect(res.status).toBe(401);
        expect(apiErrorSchema.parse(res.body)).toMatchObject({ code: 'IDENTITY_SYNC_PENDING' });
        expect(budget.charges).toHaveLength(0);
        expect(pick).not.toHaveBeenCalled();
    });

    it('charges a service principal under its own id', async () => {
        const res = await api.call('POST', ADOPT, { token: 'service', body: PICK });

        expect(res.status).toBe(200);
        expect(budget.charges.map((charge) => charge.requesterId)).toEqual(['svc_recipe']);
    });
});
