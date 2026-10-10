/**
 * Integration (mocked, `docs/CODING_STANDARDS.md` §7.1a): the remote pick route, `POST /api/v1/foods/remote/adopt`
 * (ADR-0055 point 10), over a real HTTP listener booted by `support/mockedFoodsApi.ts`: the real auth guard, the real
 * per-minute cap and source-budget interceptor, the real validation pipe, the real `AdoptRemoteFood` command and the
 * real sealer, with the catalog reads, the adoption write and the source doubled. The source's fetch is admitted
 * through a real `MeteredAdmission`, as the transport admits it, so the real meter decides what the budget gives back.
 * The write's SQL is `tests/e2e/remoteAdoption.e2e.test.ts`.
 *
 * | What the route must do on the wire                                     | Pinned here                                  |
 * | ---------------------------------------------------------------------- | -------------------------------------------- |
 * | answer the root that stands for a held item, spending nothing          | `200 { id }`, the one call given back        |
 * | adopt a new item with one fetch, kept on the budget                    | `200 { id }`, one fetch, nothing given back  |
 * | refuse an item it cannot adopt, as gone                                | `409 REMOTE_FOOD_GONE`, private, no-store    |
 * | refuse a busy source as busy, retryably                                | `503 FETCH_UNAVAILABLE` + `Retry-After`      |
 * | answer a named root holding a record, spending nothing                 | `200 { id }`, no lease, the call given back  |
 * | complete a named placeholder under its queue lease, with one fetch     | `200 { id }`, the lease presented            |
 * | refuse a pick while a drain fetches for that placeholder, as busy      | `503` + `Retry-After`, no fetch, given back  |
 * | refuse the cook's own limit before the command runs                    | `429 REQUESTER_LIMIT_REACHED`                |
 * | refuse a malformed body and an unauthenticated call                    | `400`, `401`                                 |
 */
import { randomBytes } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@kitchensink/clerk-verify', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@kitchensink/clerk-verify')>();

    return { ...actual, verifyClerkToken: vi.fn() };
});

import { verifyClerkToken } from '@kitchensink/clerk-verify';

import { MeteredAdmission } from '../src/common/throttle/meteredAdmission.js';
import { REQUESTER_SOURCE_BUDGET_PER_HOUR } from '../src/common/throttle/throttle.config.js';
import { AUTHOR_ID } from '../src/foods/__fixtures__/foodRefFacts.js';
import type { CatalogOwner, KeyStanding } from '../src/foods/catalogOwnerReader.service.js';
import type { FoodLease } from '../src/foods/dao/fetchQueue.dao.js';
import { leaseFenceFrom } from '../src/foods/dao/leaseFence.js';
import type { AdoptionWriteInput, NamedRoot } from '../src/foods/dao/remoteAdoption.dao.js';
import { foodErrorSchema } from '../src/foods/foods.schema.js';
import { makeMergeCandidate } from '../src/foods/merge/__fixtures__/merge.fixtures.js';
import { AdoptRemoteFood } from '../src/foods/remote/AdoptRemoteFood.js';
import { RemoteReferenceSealer, type RemoteFoodReference } from '../src/foods/remote/RemoteReferenceSealer.js';
import { SourceBusyError } from '../src/sources/foodSource.errors.js';
import type { Admission } from '../src/sources/transport/transportPorts.js';
import { bootMockedFoodsApi, principalFor, type MockedFoodsApi } from './support/mockedFoodsApi.js';
import { fakeSourceBudget, type FakeSourceBudget } from './support/sourceBudgetFake.js';

const mockVerify = vi.mocked(verifyClerkToken);
const ADOPT = '/api/v1/foods/remote/adopt';
const SEALER = new RemoteReferenceSealer(new Uint8Array(randomBytes(32)));
const FENCE = leaseFenceFrom('2026-10-02 05:00:00.123456+00');
const OWNER: CatalogOwner = {
    kind: 'root',
    id: 'R-kale',
    rootId: 'R-kale',
    rootName: 'kale',
    seedOwned: true,
    parts: [],
};

/** A remote hit, as the progressive search would have shown it. */
function hit(externalKey: string, name = 'Kale chips, baked'): RemoteFoodReference {
    return { source: 'usda', externalKey, lineageKey: null, name };
}

/** What the doubles hold and saw. */
interface World {
    held: Map<string, CatalogOwner>;
    retired: Set<string>;
    window: Admission;
    named: NamedRoot | undefined;
    lease: FoodLease;
    fetched: string[];
    written: AdoptionWriteInput[];
    leased: string[];
}

/** The doubles' world, reset per case. */
const world: World = {
    held: new Map(),
    retired: new Set(),
    window: { admitted: true },
    named: undefined,
    lease: { kind: 'leased', fence: FENCE },
    fetched: [],
    written: [],
    leased: [],
};

/** The window the metered admission asks: admits or refuses as the case says. */
const transport = new MeteredAdmission({ admit: async () => world.window });

const command = new AdoptRemoteFood({
    sealer: SEALER,
    owners: {
        standingOfKeys: async (_source, keys): Promise<KeyStanding> => ({
            owners: new Map(
                keys.flatMap((key): [string, CatalogOwner][] => {
                    const owner = world.held.get(key.externalKey);

                    return owner === undefined ? [] : [[key.externalKey, owner]];
                }),
            ),
            retired: new Set(keys.map((key) => key.externalKey).filter((key) => world.retired.has(key))),
        }),
    },
    registry: {
        adapterFor: () => ({
            source: 'usda',
            searchByName: async () => [],
            fetchByKey: async (externalKey) => {
                const admission = await transport.admit('usda', 'interactive');

                if (!admission.admitted) {
                    throw new SourceBusyError('usda', admission.reason, admission.retryAt);
                }

                world.fetched.push(externalKey);

                return makeMergeCandidate('usda', { externalKey, name: 'KALE CHIPS' });
            },
        }),
    },
    adoption: {
        liveCatalogRootNamed: async () => world.named,
        adopt: async (input) => {
            world.written.push(input);

            return world.named === undefined
                ? { kind: 'created', id: 'R-new' }
                : { kind: 'completed', id: world.named.id };
        },
    },
    queue: {
        leaseFood: async (foodId) => {
            world.leased.push(foodId);

            return world.lease;
        },
        deferLease: async () => undefined,
    },
    persistRoot: () => async () => undefined,
    logger: { warn: () => undefined },
});

let api: MockedFoodsApi;
let budget: FakeSourceBudget;

beforeAll(async () => {
    budget = fakeSourceBudget(1_777);
    api = await bootMockedFoodsApi({
        foodDao: {},
        remoteAdopt: command,
        sourceBudget: {
            charge: async (input) => budget.store.charge(input),
            refund: async (r, c) => budget.store.refund(r, c),
        },
    });
});

afterAll(async () => {
    await api.close();
});

beforeEach(() => {
    mockVerify.mockReset();
    mockVerify.mockImplementation(async (token: string) => principalFor(token));
    world.held = new Map();
    world.retired = new Set();
    world.window = { admitted: true };
    world.named = undefined;
    world.lease = { kind: 'leased', fence: FENCE };
    world.fetched = [];
    world.written = [];
    world.leased = [];
    budget = fakeSourceBudget(1_777);
});

/**
 * Pick a hit as the author.
 *
 * @param reference - The hit's reference.
 * @returns The answer.
 */
async function adopt(reference: string): Promise<Awaited<ReturnType<MockedFoodsApi['call']>>> {
    return api.call('POST', ADOPT, { token: 'author', body: { reference } });
}

describe('POST /api/v1/foods/remote/adopt', () => {
    it('answers the root that stands for a held item, fetching nothing, and gives the cook’s call back', async () => {
        world.held.set('900001', OWNER);

        const res = await adopt(await SEALER.seal(hit('900001')));

        expect(res.status).toBe(200);
        expect(res.body).toStrictEqual({ id: 'R-kale' });
        expect(res.headers.get('cache-control')).toBe('private, no-store');
        expect(world.fetched).toStrictEqual([]);
        expect(budget.spentBy(AUTHOR_ID)).toBe(0);
    });

    it('adopts a new item with one fetch under the picked name, and keeps the call on the cook’s budget', async () => {
        const res = await adopt(await SEALER.seal(hit('900002')));

        expect(res.status).toBe(200);
        expect(res.body).toStrictEqual({ id: 'R-new' });
        expect(world.fetched).toStrictEqual(['900002']);
        expect(world.written.map((input) => input.name)).toStrictEqual(['Kale chips, baked']);
        expect(budget.spentBy(AUTHOR_ID)).toBe(1);
    });

    it.each<[string, () => Promise<string>]>([
        [
            'an item the catalog retired with no forward',
            async () => {
                world.retired.add('900003');

                return SEALER.seal(hit('900003'));
            },
        ],
        [
            'a reference sealed under another key',
            async () => new RemoteReferenceSealer(new Uint8Array(randomBytes(32))).seal(hit('900004')),
        ],
        ['a reference that is not one food issued', async () => 'eyJ.not.a.reference.at-all'],
    ])('refuses %s as gone, privately, and gives the call back', async (_label, reference) => {
        const res = await adopt(await reference());

        expect(res.status).toBe(409);
        expect(foodErrorSchema.parse(res.body)).toMatchObject({ code: 'REMOTE_FOOD_GONE' });
        expect(res.headers.get('cache-control')).toBe('private, no-store');
        expect(world.written).toStrictEqual([]);
        expect(budget.spentBy(AUTHOR_ID)).toBe(0);
    });

    it('answers a full window as busy, with Retry-After, never retried, and gives the call back', async () => {
        world.window = { admitted: false, reason: 'ceiling', retryAt: new Date(Date.now() + 90_000).toISOString() };

        const res = await adopt(await SEALER.seal(hit('900005')));

        expect(res.status).toBe(503);
        expect(foodErrorSchema.parse(res.body)).toMatchObject({ code: 'FETCH_UNAVAILABLE' });
        expect(Number(res.headers.get('retry-after'))).toBeGreaterThanOrEqual(89);
        expect(world.fetched).toStrictEqual([]);
        expect(budget.spentBy(AUTHOR_ID)).toBe(0);
    });

    it('answers a named root holding a record with no lease and no fetch, and gives the call back', async () => {
        world.named = { id: 'R-chips', status: 'RESOLVED' };

        const res = await adopt(await SEALER.seal(hit('900009')));

        expect(res.status).toBe(200);
        expect(res.body).toStrictEqual({ id: 'R-chips' });
        expect(world.leased).toStrictEqual([]);
        expect(world.fetched).toStrictEqual([]);
        expect(budget.spentBy(AUTHOR_ID)).toBe(0);
    });

    it('completes a named placeholder under its queue lease with one fetch, kept on the cook’s budget', async () => {
        world.named = { id: 'R-pending', status: 'PENDING' };

        const res = await adopt(await SEALER.seal(hit('900010')));

        expect(res.status).toBe(200);
        expect(res.body).toStrictEqual({ id: 'R-pending' });
        expect(world.leased).toStrictEqual(['R-pending']);
        expect(world.fetched).toStrictEqual(['900010']);
        expect(world.written.map((input) => input.lease)).toStrictEqual([{ rootId: 'R-pending', fence: FENCE }]);
        expect(budget.spentBy(AUTHOR_ID)).toBe(1);
    });

    it('answers busy while a drain fetches for that placeholder, fetching nothing, and gives the call back', async () => {
        world.named = { id: 'R-pending', status: 'PENDING' };
        world.lease = { kind: 'draining' };

        const res = await adopt(await SEALER.seal(hit('900011')));

        expect(res.status).toBe(503);
        expect(foodErrorSchema.parse(res.body)).toMatchObject({ code: 'FETCH_UNAVAILABLE' });
        expect(res.headers.get('retry-after')).toBe('5');
        expect(world.fetched).toStrictEqual([]);
        expect(world.written).toStrictEqual([]);
        expect(budget.spentBy(AUTHOR_ID)).toBe(0);
    });

    it('refuses the cook’s own limit before the command runs', async () => {
        await budget.store.charge({
            requesterId: AUTHOR_ID,
            cost: REQUESTER_SOURCE_BUDGET_PER_HOUR,
            limit: REQUESTER_SOURCE_BUDGET_PER_HOUR,
            windowSeconds: 3_600,
        });

        const res = await adopt(await SEALER.seal(hit('900006')));

        expect(res.status).toBe(429);
        expect(foodErrorSchema.parse(res.body)).toMatchObject({
            code: 'REQUESTER_LIMIT_REACHED',
            details: { retryAfterSeconds: 1_777 },
        });
        expect(world.fetched).toStrictEqual([]);
    });

    it.each<[string, unknown]>([
        ['no reference', {}],
        ['an empty reference', { reference: '' }],
        ['the source’s own key instead', { source: 'usda', externalKey: '900007' }],
    ])('refuses a body with %s as a validation failure, and gives the call back', async (_label, body) => {
        const res = await api.call('POST', ADOPT, { token: 'author', body });

        expect(res.status).toBe(400);
        expect(foodErrorSchema.parse(res.body)).toMatchObject({ code: 'VALIDATION_FAILED' });
        expect(budget.spentBy(AUTHOR_ID)).toBe(0);
    });

    it('refuses an unauthenticated call before anything else', async () => {
        const res = await api.call('POST', ADOPT, { body: { reference: await SEALER.seal(hit('900008')) } });

        expect(res.status).toBe(401);
        expect(budget.charges).toStrictEqual([]);
    });
});
