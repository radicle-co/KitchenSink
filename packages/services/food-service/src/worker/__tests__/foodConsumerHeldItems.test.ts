/**
 * The fan-out worker's catalog decisions (FOOD-SERVICE-6; ADR-0055 point 4: our catalog's foods come first, and a
 * remote hit for a food the catalog holds is hidden).
 *
 * - Before any source is asked, the worker asks the catalog which entry the food's name IS; an entry forwards the food
 *   to it, with no search and no fetch.
 * - A hit the catalog holds is never fetched, and its holder reaches the merge as a survivor.
 * - A merge refused because a contributor became held meanwhile resolves the food to that holder, or tombstones it
 *   when the item has no live holder; it never fails the row.
 * - A RESOLVED food's change-refresh asks the catalog nothing: it re-pulls the food's own rows only.
 *
 * Every collaborator is a double; what the merge then writes is `tests/e2e/heldSourceItems.e2e.test.ts`'s.
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import { describe, expect, it, vi } from 'vitest';

import * as schema from '../../db/schema/index.js';
import type { FoodRow, FoodSourceRow } from '../../db/schema/index.js';
import type { CatalogOwner, KeyStanding } from '../../foods/catalogOwnerReader.service.js';
import { FetchQueueDao, type ClaimedFetchQueueRow } from '../../foods/dao/fetchQueue.dao.js';
import { FoodDao } from '../../foods/dao/food.dao.js';
import { FoodSourcesDao } from '../../foods/dao/foodSources.dao.js';
import { leaseFenceFrom } from '../../foods/dao/leaseFence.js';
import type { FoodRef } from '../../foods/foods.schema.js';
import { makeMergeCandidate } from '../../foods/merge/__fixtures__/merge.fixtures.js';
import { SourceHeldError } from '../../foods/merge/merge.errors.js';
import {
    MergeAndPersistService,
    type PersistResult,
    type ResolveAndPersistInput,
    type ResolveToHolderInput,
} from '../../foods/merge/mergeAndPersist.service.js';
import { GoldenRecordMergeEngine } from '../../foods/merge/mergeEngine.js';
import { SourceAdapterRegistry } from '../../sources/SourceAdapterRegistry.js';
import type { CanonicalCandidate, FoodSourceId, SourceCandidate } from '../../sources/foodSourceAdapter.js';
import { FoodConsumerService, type WorkerCatalog } from '../foodConsumer.service.js';
import { SilentWorkerLogger } from '../SilentWorkerLogger.js';

const REQUESTER = '01J9ZK8N7QF3B2X4M6T0V5C1AB';
const FOOD_ID = '01JQZK8N7QF3B2X4M6T0V5C1FD';
const ROOT: FoodRef = { kind: 'root', id: 'R-broccoli' };

/** A database with no client: a DAO method a case did not replace fails on its first query. */
const db = drizzle.mock({ schema });

/** The food the leased row is for. */
function foodRow(overrides: Partial<FoodRow> = {}): FoodRow {
    const at = new Date('2026-10-08T12:00:00.000Z');

    return {
        id: FOOD_ID,
        name: 'broccoli florets',
        normalizedName: 'broccoli florets',
        description: null,
        kind: 'generic',
        brandOwner: null,
        brandName: null,
        barcode: null,
        aliases: null,
        status: 'PENDING',
        itemId: 'I-self',
        itemOwnerKind: 'root',
        seedKey: null,
        retiredAt: null,
        userId: null,
        visibility: 'public',
        tombstonedAt: null,
        withdrawnAt: null,
        createdAt: at,
        updatedAt: at,
        searchVector: null,
        aliasesSearchVector: null,
        rankFolded: null,
        rankTokens: null,
        rankHead: null,
        ...overrides,
    };
}

/** A root owner, as the owner reader answers one. */
function owner(id: string): CatalogOwner {
    return { kind: 'root', id, rootId: id, rootName: id, seedOwned: true, parts: [] };
}

/** A source's hit. */
function hit(externalKey: string, name: string): SourceCandidate {
    return { source: 'usda', externalKey, name, lineageKey: null };
}

interface WorldSpec {
    readonly food?: FoodRow;
    readonly entry?: FoodRef;
    readonly hits?: readonly SourceCandidate[];
    readonly held?: Readonly<Record<string, CatalogOwner>>;
    readonly persist?: (input: ResolveAndPersistInput) => Promise<PersistResult>;
    readonly backing?: readonly FoodSourceRow[];
}

/** The worker over one leased row, every collaborator a double, and the spies a case asserts on. */
function workerOver(spec: WorldSpec) {
    const food = spec.food ?? foodRow();
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
    const fetched = (keys: readonly string[]): CanonicalCandidate[] =>
        keys.map((externalKey) => {
            const named = spec.hits?.find((candidate) => candidate.externalKey === externalKey);

            return makeMergeCandidate('usda', { externalKey, name: named?.name ?? externalKey });
        });
    const usda = {
        source: 'usda' as const,
        searchByName: vi.fn(async (_name: string) => [...(spec.hits ?? [])]),
        fetchByKey: vi.fn(async (key: string) => fetched([key])[0] ?? makeMergeCandidate('usda')),
        fetchByKeys: vi.fn(async (keys: readonly string[]) => fetched(keys)),
    };
    const registry = new SourceAdapterRegistry();
    registry.register(usda);

    const resolve = vi.fn(async () => undefined);
    const tombstone = vi.fn(async () => undefined);
    const queue = Object.assign(new FetchQueueDao(db, { demoteThreshold: 50, leaseSeconds: 30 }), {
        leaseNext: async (): Promise<ClaimedFetchQueueRow | undefined> => claimed,
        listRequesterIds: async (): Promise<string[]> => [REQUESTER],
        resolve,
        tombstone,
    });
    const foodDao = Object.assign(new FoodDao(db, { notFoundTtlDays: 30 }), {
        getById: async (id: string): Promise<FoodRow | undefined> => (id === food.id ? food : undefined),
    });
    const sources = Object.assign(new FoodSourcesDao(db), {
        listRefreshableByFood: async (): Promise<FoodSourceRow[]> => [...(spec.backing ?? [])],
    });
    const resolveAndPersist = vi.fn(
        spec.persist ?? (async (): Promise<PersistResult> => ({ outcome: 'UNRESOLVED', status: 'UNRESOLVED' })),
    );
    const resolveToHolder = vi.fn(async (input: ResolveToHolderInput): Promise<PersistResult> => ({
        outcome: 'RESOLVED',
        status: 'RESOLVED',
        forwardedTo: input.to,
    }));
    const mergeChangedSources = vi.fn(async (): Promise<PersistResult> => ({
        outcome: 'RESOLVED',
        status: 'RESOLVED',
    }));
    const merge = Object.assign(new MergeAndPersistService(db, new GoldenRecordMergeEngine(registry)), {
        resolveAndPersist,
        resolveToHolder,
        mergeChangedSources,
    });
    const standingOf = (keys: readonly string[]): KeyStanding => ({
        owners: new Map(
            keys.flatMap((key): [string, CatalogOwner][] => {
                const held = spec.held?.[key];

                return held === undefined ? [] : [[key, held]];
            }),
        ),
        retired: new Set(),
    });
    const identicalEntryFor = vi.fn(async (_name: string) => spec.entry);
    const standingOfKeys = vi.fn(async (_source: FoodSourceId, keys: readonly { externalKey: string }[]) =>
        standingOf(keys.map((key) => key.externalKey)),
    );
    const standingOfItems = vi.fn(
        async (items: readonly { source: FoodSourceId; externalKey: string }[]) =>
            new Map([['usda' as const, standingOf(items.map((item) => item.externalKey))]]),
    );
    const catalog: WorkerCatalog = { names: { identicalEntryFor }, owners: { standingOfKeys, standingOfItems } };
    const published: { id: string; status: string }[] = [];
    const consumer = new FoodConsumerService({
        foodDao,
        sources,
        queue,
        registry,
        merge,
        catalog,
        events: {
            publishFoodFetchCompleted: async (input) => {
                published.push({ id: input.id, status: input.status });
            },
            publishFetchFailed: async () => undefined,
        },
        logger: new SilentWorkerLogger(),
    });

    return {
        consumer,
        usda,
        identicalEntryFor,
        standingOfKeys,
        standingOfItems,
        resolveAndPersist,
        resolveToHolder,
        mergeChangedSources,
        resolve,
        tombstone,
        published,
    };
}

describe('FoodConsumerService — catalog first', () => {
    it('asks the catalog with the food’s stable name, and forwards to the entry it IS with no source call', async () => {
        const worker = workerOver({ entry: ROOT });

        await expect(worker.consumer.processNext()).resolves.toBe('forwarded');

        expect(worker.identicalEntryFor).toHaveBeenCalledWith('broccoli florets');
        expect(worker.resolveToHolder).toHaveBeenCalledWith({ foodId: FOOD_ID, to: ROOT, from: ['PENDING'] });
        expect(worker.usda.searchByName).not.toHaveBeenCalled();
        expect(worker.resolve).toHaveBeenCalledTimes(1);
        expect(worker.published).toEqual([{ id: FOOD_ID, status: 'RESOLVED' }]);
    });

    it('states the status it observed, so a food that moved meanwhile is not forwarded over', async () => {
        const worker = workerOver({ entry: ROOT, food: foodRow({ status: 'UNRESOLVED' }) });

        await worker.consumer.processNext();

        expect(worker.resolveToHolder).toHaveBeenCalledWith({ foodId: FOOD_ID, to: ROOT, from: ['UNRESOLVED'] });
    });

    it('fans out as before when the name is no catalog entry', async () => {
        const worker = workerOver({ hits: [hit('1', 'Broccoli, frozen')] });

        await worker.consumer.processNext();

        expect(worker.usda.searchByName).toHaveBeenCalledWith('broccoli florets');
        expect(worker.resolveToHolder).not.toHaveBeenCalled();
    });

    it('asks the catalog nothing for a RESOLVED food: a change-refresh re-pulls only its own rows', async () => {
        const worker = workerOver({ entry: ROOT, food: foodRow({ status: 'RESOLVED' }) });

        await expect(worker.consumer.processNext()).resolves.toBe('refreshed');

        expect(worker.identicalEntryFor).not.toHaveBeenCalled();
        expect(worker.standingOfKeys).not.toHaveBeenCalled();
        expect(worker.resolveToHolder).not.toHaveBeenCalled();
    });
});

describe('FoodConsumerService — held hits', () => {
    it('reads the catalog’s standing for the hits, fetches only the unheld ones, and passes the holders on', async () => {
        const worker = workerOver({
            hits: [hit('1', 'Broccoli, raw'), hit('2', 'Broccoli, frozen'), hit('3', 'Broccoli raab')],
            held: { '1': owner('R-broccoli') },
        });

        await worker.consumer.processNext();

        expect(worker.standingOfKeys).toHaveBeenCalledWith('usda', [
            { externalKey: '1', lineageKey: null },
            { externalKey: '2', lineageKey: null },
            { externalKey: '3', lineageKey: null },
        ]);
        expect(worker.usda.fetchByKeys).toHaveBeenCalledWith(['2', '3']);
        expect(worker.resolveAndPersist.mock.calls[0]?.[0]).toMatchObject({
            foodId: FOOD_ID,
            holders: [ROOT],
        });
        expect(worker.resolveAndPersist.mock.calls[0]?.[0].candidates.map((c) => c.externalKey)).toEqual(['2', '3']);
    });

    it('fetches nothing when every hit is held, and still lets the merge decide over the holder', async () => {
        const worker = workerOver({
            hits: [hit('1', 'Broccoli, raw')],
            held: { '1': owner('R-broccoli') },
            persist: async () => ({ outcome: 'RESOLVED', status: 'RESOLVED', forwardedTo: ROOT }),
        });

        await expect(worker.consumer.processNext()).resolves.toBe('forwarded');

        expect(worker.usda.fetchByKeys).not.toHaveBeenCalled();
        expect(worker.resolveAndPersist.mock.calls[0]?.[0]).toMatchObject({ candidates: [], holders: [ROOT] });
        expect(worker.tombstone).not.toHaveBeenCalled();
    });

    it('⛔ resolves to the holder when a contributor became held after the fan-out read the catalog', async () => {
        let call = 0;
        const worker = workerOver({
            hits: [hit('1', 'Broccoli, raw')],
            held: {},
            persist: async (input) => {
                call += 1;

                if (call === 1) {
                    throw new SourceHeldError([{ source: 'usda', externalKey: '1' }]);
                }

                return { outcome: 'RESOLVED', status: 'RESOLVED', forwardedTo: input.holders[0] };
            },
        });
        // The race: the catalog took key 1 between the fan-out's read (nothing held) and the merge.
        worker.standingOfItems.mockResolvedValue(
            new Map([['usda', { owners: new Map([['1', owner('R-broccoli')]]), retired: new Set<string>() }]]),
        );

        await expect(worker.consumer.processNext()).resolves.toBe('forwarded');

        expect(worker.standingOfItems).toHaveBeenCalledWith([{ source: 'usda', externalKey: '1' }]);
        expect(worker.resolveAndPersist).toHaveBeenLastCalledWith({ foodId: FOOD_ID, candidates: [], holders: [ROOT] });
    });

    it('tombstones the food, rather than failing the row, when the held contributor has no live holder', async () => {
        const worker = workerOver({
            hits: [hit('1', 'Broccoli, raw')],
            persist: async (input) => {
                if (input.candidates.length > 0) {
                    throw new SourceHeldError([{ source: 'usda', externalKey: '1' }]);
                }

                return { outcome: 'NOT_FOUND', status: 'NOT_FOUND' };
            },
        });

        await expect(worker.consumer.processNext()).resolves.toBe('not_found');

        expect(worker.resolveAndPersist).toHaveBeenLastCalledWith({ foodId: FOOD_ID, candidates: [], holders: [] });
        expect(worker.tombstone).toHaveBeenCalledTimes(1);
    });
});
