/**
 * Integration (mocked, `docs/CODING_STANDARDS.md` §7.1a): the three paths FOOD-SERVICE-6 runs through, composed as they
 * are deployed — the REAL catalog Facades (`CatalogNameMatcher`, `CatalogOwnerReader`) and the REAL policies over
 * doubled DAOs, with the merge seam doubled at its port.
 *
 * - PATCH resolve, through the booted controller: a pick of a held item is forwarded to its holder, and picks naming two
 *   holders answer `409 CANDIDATE_MISMATCH`.
 * - Add-by-name, through the booted controller: a synonym answers its catalog root, and no food is created.
 * - The fan-out worker: a synonym is forwarded with no source call; a held hit is never fetched and its holder reaches
 *   the merge; and a change-refresh re-pulls the food's own rows without asking the catalog anything.
 *
 * What the merge then writes on a real Postgres — the forward, the refusal, the untouched seed row — is the LOCAL e2e
 * tier's (`tests/e2e/heldSourceItems.e2e.test.ts`).
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@kitchensink/clerk-verify', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@kitchensink/clerk-verify')>();

    return { ...actual, verifyClerkToken: vi.fn() };
});

import { verifyClerkToken } from '@kitchensink/clerk-verify';

import * as schema from '../src/db/schema/index.js';
import type { FoodCandidateRow, FoodRow, FoodSourceRow } from '../src/db/schema/index.js';
import { makeFoodRefFacts } from '../src/foods/__fixtures__/foodRefFacts.js';
import { CatalogNameMatcher } from '../src/foods/catalogNameMatcher.service.js';
import { CatalogOwnerReader } from '../src/foods/catalogOwnerReader.service.js';
import { FetchQueueDao, type ClaimedFetchQueueRow } from '../src/foods/dao/fetchQueue.dao.js';
import { FoodDao } from '../src/foods/dao/food.dao.js';
import type { CatalogSearchHit } from '../src/foods/dao/foodSearch.dao.js';
import { FoodSourcesDao, type ItemOwner } from '../src/foods/dao/foodSources.dao.js';
import { leaseFenceFrom } from '../src/foods/dao/leaseFence.js';
import { foodErrorSchema } from '../src/foods/foods.schema.js';
import { makeMergeCandidate } from '../src/foods/merge/__fixtures__/merge.fixtures.js';
import {
    MergeAndPersistService,
    type PersistResult,
    type ResolveAndPersistInput,
    type ResolveToHolderInput,
} from '../src/foods/merge/mergeAndPersist.service.js';
import { GoldenRecordMergeEngine } from '../src/foods/merge/mergeEngine.js';
import { FoodMetrics } from '../src/observability/emfMetrics.js';
import { SourceAdapterRegistry } from '../src/sources/SourceAdapterRegistry.js';
import type { CanonicalCandidate, SourceCandidate } from '../src/sources/foodSourceAdapter.js';
import { FoodConsumerService } from '../src/worker/foodConsumer.service.js';
import { SilentWorkerLogger } from '../src/worker/SilentWorkerLogger.js';
import { makeFoodRow } from './__fixtures__/foodRow.js';
import { bootMockedFoodsApi, principalFor, type MockedFoodsApi } from './support/mockedFoodsApi.js';

const mockVerify = vi.mocked(verifyClerkToken);

const FOOD_ID = '01JQZK8N7QF3B2X4M6T0V5C1FD';
const ROOT_ID = '01JQZK8N7QF3B2X4M6T0V5C1RT';
const KALE_ID = '01JQZK8N7QF3B2X4M6T0V5C1KA';
const GONE_ID = '01JQZK8N7QF3B2X4M6T0V5C1GN';
const HELD_KEY = '747447';
const BROCCOLI: CatalogSearchHit = { id: ROOT_ID, name: 'Broccoli', aliases: 'calabrese', score: 1 };

/** The crosswalk owner of each held key: a seed-owned root. */
const CROSSWALK: Readonly<Record<string, string>> = { [HELD_KEY]: ROOT_ID, '1001': KALE_ID, '9999': GONE_ID };

/** The crosswalk read, answering the owners of the keys it is asked about. */
async function ownersOf(_source: string, keys: readonly string[]): Promise<ItemOwner[]> {
    return keys.flatMap((externalKey): ItemOwner[] => {
        const id = CROSSWALK[externalKey];

        return id === undefined ? [] : [{ externalKey, kind: 'root', id, seedOwned: true }];
    });
}

/** The live catalog roots the owner reader may answer. */
const ROOT_FACTS = [
    makeFoodRefFacts({ id: ROOT_ID, name: 'Broccoli' }),
    makeFoodRefFacts({ id: KALE_ID, name: 'Kale' }),
    // Retired by the seed with no successor: its item is held by nothing live.
    makeFoodRefFacts({ id: GONE_ID, name: 'Broccoli, old', retired: true }),
];

/** One row of the food's candidate set. */
function candidateRow(id: string, externalKey: string): FoodCandidateRow {
    return {
        id,
        foodId: FOOD_ID,
        source: 'usda',
        externalKey,
        name: externalKey,
        summary: null,
        createdAt: new Date('2026-10-08T12:00:00.000Z'),
    };
}

describe('the API doors onto a held item (booted Nest, real catalog Facades, DAOs doubled)', () => {
    const resolveToHolder = vi.fn(async (input: ResolveToHolderInput): Promise<PersistResult> => ({
        outcome: 'RESOLVED',
        status: 'RESOLVED',
        forwardedTo: input.to,
    }));
    const createByName = vi.fn();
    let api: MockedFoodsApi;

    beforeAll(async () => {
        api = await bootMockedFoodsApi({
            foodDao: {
                getById: async (id: string) => ({ id, status: 'UNRESOLVED' }),
                readRefFacts: async (ids: readonly string[]) => ROOT_FACTS.filter((root) => ids.includes(root.id)),
                createByName,
            },
            candidates: {
                getCandidates: async () => [
                    candidateRow('c-held', HELD_KEY),
                    candidateRow('c-gone', '9999'),
                    candidateRow('c-free', '169967'),
                ],
            },
            sources: { ownersOf, citingSeedRoots: async () => new Map(), ownersOfLineage: async () => [] },
            // No forward anywhere: a retired root's chain ends at itself.
            forwards: {
                follow: async (ids: readonly string[]) =>
                    new Map(ids.map((id) => [id, { resolved: true, id, kind: undefined, hops: 0 }])),
            },
            searchDao: {
                searchCatalog: async (query: string) => (query.toLowerCase() === 'calabrese' ? [BROCCOLI] : []),
            },
            variants: { listLive: async () => [] },
            merge: { resolveToHolder },
        });
    });

    afterAll(async () => {
        await api.close();
    });

    beforeEach(() => {
        resolveToHolder.mockClear();
        createByName.mockClear();
        mockVerify.mockReset();
        mockVerify.mockImplementation(async (token: string) => principalFor(token));
    });

    it('PATCH: a pick of a held item answers 200 RESOLVED, forwarded to its holder', async () => {
        const res = await api.call('PATCH', `/api/v1/foods/${FOOD_ID}`, {
            token: 'author',
            body: { candidateIds: ['c-held'] },
        });

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ id: FOOD_ID, status: 'RESOLVED' });
        expect(resolveToHolder).toHaveBeenCalledWith({
            foodId: FOOD_ID,
            to: { kind: 'root', id: ROOT_ID },
            from: ['UNRESOLVED'],
        });
    });

    // One pick per resolve (MAX_RESOLVE_CANDIDATE_IDS), so the refusal the wire can reach is the retired item; two
    // holders are refused by the same policy (`heldCandidatePolicy.test.ts`).
    it('⛔ PATCH: a pick of an item the catalog retired with no forward answers 409 CANDIDATE_MISMATCH', async () => {
        const res = await api.call('PATCH', `/api/v1/foods/${FOOD_ID}`, {
            token: 'author',
            body: { candidateIds: ['c-gone'] },
        });

        expect(res.status).toBe(409);
        expect(foodErrorSchema.parse(res.body)).toMatchObject({ code: 'CANDIDATE_MISMATCH', details: { id: FOOD_ID } });
        expect(resolveToHolder).not.toHaveBeenCalled();
    });

    it('add-by-name: a synonym answers its catalog root RESOLVED, and no food is created', async () => {
        const res = await api.call('POST', '/api/v1/foods', { token: 'author', body: { name: 'Calabrese' } });

        expect(res.status).toBe(202);
        expect(res.body).toEqual({ id: ROOT_ID, status: 'RESOLVED' });
        expect(createByName).not.toHaveBeenCalled();
    });
});

describe('the fan-out worker over the real catalog Facades (DAOs and merge seam doubled)', () => {
    /** A database with no client: a DAO method a case did not replace fails on its first query. */
    const db = drizzle.mock({ schema });

    /** The worker over one leased food, with the spies a case asserts on. */
    function workerOver(food: FoodRow, hits: readonly SourceCandidate[], backing: readonly FoodSourceRow[] = []) {
        const at = new Date('2026-10-08T12:00:00.000Z');
        const claimed: ClaimedFetchQueueRow = {
            foodId: food.id,
            requestCount: 1,
            firstRequested: at,
            lastRequested: at,
            status: 'in_flight',
            attempts: 0,
            lastError: null,
            fetchedAt: null,
            leasedAt: at,
            fence: leaseFenceFrom('2026-10-08 12:00:00.000000+00'),
        };
        const usda = {
            source: 'usda' as const,
            searchByName: vi.fn(async () => [...hits]),
            fetchByKey: vi.fn(async (externalKey: string): Promise<CanonicalCandidate> =>
                makeMergeCandidate('usda', { externalKey, itemVersion: 'v2' }),
            ),
            fetchByKeys: vi.fn(async (keys: readonly string[]) =>
                keys.map((externalKey) => makeMergeCandidate('usda', { externalKey, name: externalKey })),
            ),
        };
        const registry = new SourceAdapterRegistry();
        registry.register(usda);

        const searchCatalog = vi.fn(async (query: string) => (query === 'calabrese' ? [BROCCOLI] : []));
        const crosswalk = vi.fn(ownersOf);
        const owners = new CatalogOwnerReader(
            { ownersOf: crosswalk, citingSeedRoots: async () => new Map(), ownersOfLineage: async () => [] },
            { follow: async () => new Map() },
            { readFacts: async () => [] },
            { readRefFacts: async (ids) => ROOT_FACTS.filter((root) => ids.includes(root.id)) },
            new FoodMetrics(() => undefined),
        );
        const resolveAndPersist = vi.fn(async (_input: ResolveAndPersistInput): Promise<PersistResult> => ({
            outcome: 'UNRESOLVED',
            status: 'UNRESOLVED',
        }));
        const resolveToHolderSpy = vi.fn(async (input: ResolveToHolderInput): Promise<PersistResult> => ({
            outcome: 'RESOLVED',
            status: 'RESOLVED',
            forwardedTo: input.to,
        }));
        const mergeChangedSources = vi.fn(async (): Promise<PersistResult> => ({
            outcome: 'RESOLVED',
            status: 'RESOLVED',
        }));
        const consumer = new FoodConsumerService({
            foodDao: Object.assign(new FoodDao(db, { notFoundTtlDays: 30 }), {
                getById: async (id: string): Promise<FoodRow | undefined> => (id === food.id ? food : undefined),
            }),
            sources: Object.assign(new FoodSourcesDao(db), {
                listRefreshableByFood: async (): Promise<FoodSourceRow[]> => [...backing],
            }),
            queue: Object.assign(new FetchQueueDao(db, { demoteThreshold: 50, leaseSeconds: 30 }), {
                leaseNext: async (): Promise<ClaimedFetchQueueRow | undefined> => claimed,
                listRequesterIds: async (): Promise<string[]> => ['01J9ZK8N7QF3B2X4M6T0V5C1AB'],
                resolve: async (): Promise<void> => undefined,
            }),
            registry,
            merge: Object.assign(new MergeAndPersistService(db, new GoldenRecordMergeEngine(registry)), {
                resolveAndPersist,
                resolveToHolder: resolveToHolderSpy,
                mergeChangedSources,
            }),
            catalog: { names: new CatalogNameMatcher({ searchCatalog }, { listLive: async () => [] }), owners },
            events: { publishFoodFetchCompleted: async () => undefined, publishFetchFailed: async () => undefined },
            logger: new SilentWorkerLogger(),
        });

        return { consumer, usda, searchCatalog, crosswalk, resolveAndPersist, resolveToHolderSpy, mergeChangedSources };
    }

    it('forwards a food named by a synonym to its root, asking no source', async () => {
        const worker = workerOver(makeFoodRow({ id: FOOD_ID, normalizedName: 'calabrese' }), []);

        await expect(worker.consumer.processNext()).resolves.toBe('forwarded');

        expect(worker.resolveToHolderSpy).toHaveBeenCalledWith({
            foodId: FOOD_ID,
            to: { kind: 'root', id: ROOT_ID },
            from: ['PENDING'],
        });
        expect(worker.usda.searchByName).not.toHaveBeenCalled();
    });

    it('never fetches a held hit, and hands its holder to the merge beside the offerable candidates', async () => {
        const worker = workerOver(makeFoodRow({ id: FOOD_ID, normalizedName: 'broccoli florets' }), [
            { source: 'usda', externalKey: HELD_KEY, name: 'Broccoli, raw', lineageKey: null },
            { source: 'usda', externalKey: '169967', name: 'Broccoli, frozen', lineageKey: null },
        ]);

        await expect(worker.consumer.processNext()).resolves.toBe('unresolved');

        expect(worker.usda.fetchByKeys).toHaveBeenCalledWith(['169967']);
        expect(worker.resolveAndPersist.mock.calls[0]?.[0].holders).toEqual([{ kind: 'root', id: ROOT_ID }]);
        expect(worker.resolveAndPersist.mock.calls[0]?.[0].candidates.map((c) => c.externalKey)).toEqual(['169967']);
    });

    it("change-refresh: re-pulls the RESOLVED food's own rows and asks the catalog nothing", async () => {
        const own: FoodSourceRow = {
            id: 'S-own',
            itemId: 'I-own',
            source: 'usda',
            externalKey: '555',
            itemVersion: 'v1',
            fetchState: 'fetched',
            fetchedAt: new Date('2026-10-01T00:00:00.000Z'),
            lineageKey: null,
        };
        const worker = workerOver(makeFoodRow({ id: FOOD_ID, status: 'RESOLVED' }), [], [own]);

        await expect(worker.consumer.processNext()).resolves.toBe('refreshed');

        expect(worker.mergeChangedSources).toHaveBeenCalledWith({
            foodId: FOOD_ID,
            changed: [expect.objectContaining({ externalKey: '555', itemVersion: 'v2' })],
        });
        expect(worker.searchCatalog).not.toHaveBeenCalled();
        expect(worker.crosswalk).not.toHaveBeenCalled();
    });
});
