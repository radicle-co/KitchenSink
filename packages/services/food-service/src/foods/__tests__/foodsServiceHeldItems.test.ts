/**
 * `FoodsService`'s two doors onto a held source item (FOOD-SERVICE-6; ADR-0055 point 4: our catalog's foods come first).
 *
 * - **Add-by-name, catalog first.** A name that IS a live catalog root's name or synonym answers that root, `RESOLVED`,
 *   with no row made and nothing queued. A name that is a root and one of its variants is NOT answered here, because
 *   the add's answer names a root id: it is created and queued, and the worker forwards it to the variant.
 * - **PATCH resolve.** A pick naming an item the catalog holds resolves the food to that holder with no source
 *   re-fetch; picks naming two holders, or an item the catalog retired with no forward, are refused `409` with nothing
 *   written; and a pick whose item became held during the re-fetch (the merge's `SourceHeldError`) resolves to the
 *   holder rather than failing.
 *
 * Every collaborator is a double over a database with no client, so a method a case did not replace fails loudly.
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { describe, expect, it, vi } from 'vitest';

import * as schema from '../../db/schema/index.js';
import type { FoodCandidateRow, FoodRow } from '../../db/schema/index.js';
import { FoodMetrics } from '../../observability/emfMetrics.js';
import { SourceAdapterRegistry } from '../../sources/SourceAdapterRegistry.js';
import type { CanonicalCandidate, FoodSourceId } from '../../sources/foodSourceAdapter.js';
import { CatalogOwnerReader, type CatalogOwner, type KeyStanding } from '../catalogOwnerReader.service.js';
import { AuthoredFoodsDao } from '../dao/authoredFoods.dao.js';
import { FoodDao, type CreateByNameResult } from '../dao/food.dao.js';
import { CandidateStore } from '../dao/foodCandidates.dao.js';
import { FoodForwardDao } from '../dao/foodForward.dao.js';
import { FoodSearchDao, type CatalogSearchHit } from '../dao/foodSearch.dao.js';
import { FoodSourcesDao } from '../dao/foodSources.dao.js';
import { FoodVariantDao, type LiveVariant } from '../dao/foodVariant.dao.js';
import { EnqueueEmitter } from '../enqueue.emitter.js';
import { isCandidateMismatchError } from '../foods.errors.js';
import { FoodsService } from '../foods.service.js';
import { makeMergeCandidate } from '../merge/__fixtures__/merge.fixtures.js';
import { SourceHeldError } from '../merge/merge.errors.js';
import {
    MergeAndPersistService,
    type PersistResult,
    type ResolveToHolderInput,
} from '../merge/mergeAndPersist.service.js';
import { GoldenRecordMergeEngine } from '../merge/mergeEngine.js';

const FOOD_ID = '01JQZK8N7QF3B2X4M6T0V5C1FD';
const REQUESTER = '01J9ZK8N7QF3B2X4M6T0V5C1AB';
const HELD_KEY = '747447';

/** A database with no client. */
const db = drizzle.mock({ schema });

/**
 * A pool that can never connect (port 1 refuses), for the two collaborators typed on a pooled client: a method a case
 * did not replace fails at once instead of reaching a developer's local database.
 */
const unreachable = new pg.Pool({ host: '127.0.0.1', port: 1 });

const BROCCOLI: CatalogSearchHit = { id: 'R-broccoli', name: 'Broccoli', aliases: 'calabrese', score: 1 };
const STEAMED: LiveVariant = {
    id: 'V-steamed',
    rootId: 'R-broccoli',
    itemId: 'I-steamed',
    parts: [{ attribute: 'cookingMethod', ordinal: 0, text: 'steamed' }],
    nutrients: [],
};

/** A catalog root owner, as the owner reader answers one. */
function owner(id: string): CatalogOwner {
    return { kind: 'root', id, rootId: id, rootName: id, seedOwned: true, parts: [] };
}

/** One candidate row of the food's set. */
function candidateRow(id: string, externalKey: string): FoodCandidateRow {
    return {
        id,
        foodId: FOOD_ID,
        source: 'usda',
        externalKey,
        name: 'Broccoli, raw',
        summary: null,
        createdAt: new Date('2026-10-08T12:00:00.000Z'),
    };
}

interface WorldSpec {
    readonly hits?: readonly CatalogSearchHit[];
    readonly variants?: readonly LiveVariant[];
    readonly set?: readonly FoodCandidateRow[];
    /** The catalog's standing, by key; read once per call in order when an array is given. */
    readonly standings?: readonly Readonly<Record<string, CatalogOwner>>[];
    readonly retired?: readonly string[];
    readonly resolveFromPicks?: () => Promise<PersistResult>;
}

/** The service over one world of doubles, and the spies a case asserts on. */
function serviceOver(spec: WorldSpec) {
    const placeholder: FoodRow = {
        id: FOOD_ID,
        name: 'broccoli florets',
        normalizedName: 'broccoli florets',
        description: null,
        kind: 'generic',
        brandOwner: null,
        brandName: null,
        barcode: null,
        aliases: null,
        status: 'UNRESOLVED',
        itemId: 'I-self',
        itemOwnerKind: 'root',
        seedKey: null,
        retiredAt: null,
        userId: null,
        visibility: 'public',
        tombstonedAt: null,
        withdrawnAt: null,
        createdAt: new Date('2026-10-08T12:00:00.000Z'),
        updatedAt: new Date('2026-10-08T12:00:00.000Z'),
        searchVector: null,
        aliasesSearchVector: null,
        rankFolded: null,
        rankTokens: null,
        rankHead: null,
    };
    const createByName = vi.fn(async (): Promise<CreateByNameResult> => ({
        id: FOOD_ID,
        created: true,
        reactivated: false,
    }));
    const foodDao = Object.assign(new FoodDao(db, { notFoundTtlDays: 30 }), {
        createByName,
        getById: async (id: string): Promise<FoodRow | undefined> => {
            if (id === 'R-broccoli') {
                return { ...placeholder, id, name: 'Broccoli', normalizedName: 'broccoli', status: 'RESOLVED' };
            }

            return id === FOOD_ID ? placeholder : undefined;
        },
    });
    const candidates = Object.assign(new CandidateStore(db, { ttlDays: 30 }), {
        getCandidates: async (): Promise<FoodCandidateRow[]> => [...(spec.set ?? [])],
    });
    const searchCatalog = vi.fn(async (_query: string) => [...(spec.hits ?? [])]);
    const searchDao = Object.assign(new FoodSearchDao(drizzle(unreachable, { schema })), { searchCatalog });
    const variants = Object.assign(new FoodVariantDao(db), {
        listLive: async (): Promise<LiveVariant[]> => [...(spec.variants ?? [])],
    });
    const fetchByKey = vi.fn(async (externalKey: string): Promise<CanonicalCandidate> =>
        makeMergeCandidate('usda', { externalKey }),
    );
    const registry = new SourceAdapterRegistry();
    registry.register({ source: 'usda', searchByName: async () => [], fetchByKey });
    const resolveToHolder = vi.fn(async (input: ResolveToHolderInput): Promise<PersistResult> => ({
        outcome: 'RESOLVED',
        status: 'RESOLVED',
        forwardedTo: input.to,
    }));
    const resolveFromPicks = vi.fn(
        spec.resolveFromPicks ?? (async (): Promise<PersistResult> => ({ outcome: 'RESOLVED', status: 'RESOLVED' })),
    );
    const merge = Object.assign(new MergeAndPersistService(db, new GoldenRecordMergeEngine(registry)), {
        resolveToHolder,
        resolveFromPicks,
    });
    const publishFoodRequested = vi.fn(async () => undefined);
    const publishFoodBatchRequested = vi.fn(async () => undefined);
    const enqueue = Object.assign(new EnqueueEmitter(unreachable), { publishFoodRequested, publishFoodBatchRequested });
    let read = 0;
    const standingOfItems = vi.fn(async (items: readonly { source: FoodSourceId; externalKey: string }[]) => {
        const held = spec.standings?.[Math.min(read, (spec.standings?.length ?? 1) - 1)] ?? {};

        read += 1;

        const standing: KeyStanding = {
            owners: new Map(
                items.flatMap((item): [string, CatalogOwner][] => {
                    const holder = held[item.externalKey];

                    return holder === undefined ? [] : [[item.externalKey, holder]];
                }),
            ),
            retired: new Set(spec.retired ?? []),
        };

        return new Map([['usda' as const, standing]]);
    });
    const owners = Object.assign(
        new CatalogOwnerReader(
            new FoodSourcesDao(db),
            new FoodForwardDao(db),
            new FoodVariantDao(db),
            new FoodDao(db, { notFoundTtlDays: 30 }),
            new FoodMetrics(() => undefined),
        ),
        { standingOfItems },
    );
    const service = new FoodsService(
        foodDao,
        candidates,
        new FoodSourcesDao(db),
        searchDao,
        merge,
        enqueue,
        registry,
        new FoodMetrics(() => undefined),
        new AuthoredFoodsDao(db),
        variants,
        owners,
    );

    return {
        service,
        createByName,
        searchCatalog,
        publishFoodRequested,
        publishFoodBatchRequested,
        fetchByKey,
        resolveToHolder,
        resolveFromPicks,
        standingOfItems,
    };
}

describe('FoodsService.addByName — catalog first', () => {
    it('answers the root a name is a synonym of, RESOLVED, creating and queueing nothing', async () => {
        const world = serviceOver({ hits: [BROCCOLI] });

        await expect(world.service.addByName('Calabrese', REQUESTER)).resolves.toEqual({
            id: 'R-broccoli',
            status: 'RESOLVED',
        });
        expect(world.searchCatalog).toHaveBeenCalledWith('Calabrese');
        expect(world.createByName).not.toHaveBeenCalled();
        expect(world.publishFoodRequested).not.toHaveBeenCalled();
    });

    it('⛔ creates and queues a name that is a root and one of its variants: the add answers a root id, not a variant', async () => {
        const world = serviceOver({ hits: [BROCCOLI], variants: [STEAMED] });

        await expect(world.service.addByName('steamed broccoli', REQUESTER)).resolves.toMatchObject({
            id: FOOD_ID,
            status: 'PENDING',
        });
        expect(world.createByName).toHaveBeenCalledTimes(1);
        expect(world.publishFoodRequested).toHaveBeenCalledTimes(1);
    });

    it('adds a name the catalog does not hold as before', async () => {
        const world = serviceOver({ hits: [BROCCOLI] });

        await expect(world.service.addByName('broccoli florets', REQUESTER)).resolves.toMatchObject({
            id: FOOD_ID,
            status: 'PENDING',
        });
        expect(world.createByName).toHaveBeenCalledTimes(1);
    });
});

describe('FoodsService.batchAdd — catalog first', () => {
    it('answers a synonym inline with its root, RESOLVED and named, and queues only the rest', async () => {
        const world = serviceOver({ hits: [BROCCOLI] });

        world.searchCatalog.mockImplementation(async (query: string) => (query === 'calabrese' ? [BROCCOLI] : []));

        await expect(world.service.batchAdd(['calabrese', 'kohlrabi'], REQUESTER)).resolves.toEqual({
            items: [
                { id: 'R-broccoli', status: 'RESOLVED', name: 'Broccoli' },
                { id: FOOD_ID, status: 'PENDING', estimatedWaitSeconds: 30 },
            ],
        });
        expect(world.createByName).toHaveBeenCalledTimes(1);
        expect(world.publishFoodBatchRequested).toHaveBeenCalledWith({
            foods: [{ id: FOOD_ID, reactivate: true }],
            requestedBy: REQUESTER,
        });
    });
});

describe('FoodsService.patchResolve — a pick of a held item', () => {
    it('resolves the food to the holder, with no source re-fetch, stating the status it observed', async () => {
        const world = serviceOver({
            set: [candidateRow('c-held', HELD_KEY)],
            standings: [{ [HELD_KEY]: owner('R-broccoli') }],
        });

        await expect(world.service.patchResolve(FOOD_ID, ['c-held'])).resolves.toEqual({
            id: FOOD_ID,
            status: 'RESOLVED',
        });
        expect(world.standingOfItems).toHaveBeenCalledWith([{ source: 'usda', externalKey: HELD_KEY }]);
        expect(world.resolveToHolder).toHaveBeenCalledWith({
            foodId: FOOD_ID,
            to: { kind: 'root', id: 'R-broccoli' },
            from: ['UNRESOLVED'],
        });
        expect(world.fetchByKey).not.toHaveBeenCalled();
        expect(world.resolveFromPicks).not.toHaveBeenCalled();
    });

    it('⛔ refuses picks naming two holders with 409, writing nothing and fetching nothing', async () => {
        const world = serviceOver({
            set: [candidateRow('c-1', '1'), candidateRow('c-2', '2')],
            standings: [{ '1': owner('R-broccoli'), '2': owner('R-kale') }],
        });

        const refused = await world.service.patchResolve(FOOD_ID, ['c-1', 'c-2']).catch((error: unknown) => error);

        expect(isCandidateMismatchError(refused)).toBe(true);
        expect(world.resolveToHolder).not.toHaveBeenCalled();
        expect(world.fetchByKey).not.toHaveBeenCalled();
    });

    it('⛔ refuses a pick of an item the catalog retired with no forward', async () => {
        const world = serviceOver({ set: [candidateRow('c-gone', '9')], retired: ['9'] });

        const refused = await world.service.patchResolve(FOOD_ID, ['c-gone']).catch((error: unknown) => error);

        expect(isCandidateMismatchError(refused)).toBe(true);
        expect(world.fetchByKey).not.toHaveBeenCalled();
    });

    it('merges a pick the catalog does not hold, as before', async () => {
        const world = serviceOver({ set: [candidateRow('c-free', '169967')] });

        await expect(world.service.patchResolve(FOOD_ID, ['c-free'])).resolves.toEqual({
            id: FOOD_ID,
            status: 'RESOLVED',
        });
        expect(world.fetchByKey).toHaveBeenCalledWith('169967');
        expect(world.resolveFromPicks).toHaveBeenCalledTimes(1);
        expect(world.resolveToHolder).not.toHaveBeenCalled();
    });

    it('⛔ resolves to the holder when the item became held during the re-fetch (the merge refused it)', async () => {
        const world = serviceOver({
            set: [candidateRow('c-raced', HELD_KEY)],
            standings: [{}, { [HELD_KEY]: owner('R-broccoli') }],
            resolveFromPicks: async () => {
                throw new SourceHeldError([{ source: 'usda', externalKey: HELD_KEY }]);
            },
        });

        await expect(world.service.patchResolve(FOOD_ID, ['c-raced'])).resolves.toEqual({
            id: FOOD_ID,
            status: 'RESOLVED',
        });
        expect(world.resolveToHolder).toHaveBeenCalledWith({
            foodId: FOOD_ID,
            to: { kind: 'root', id: 'R-broccoli' },
            from: ['UNRESOLVED'],
        });
    });

    it('⛔ refuses with 409 when the item became held and no single live holder answers it', async () => {
        const world = serviceOver({
            set: [candidateRow('c-raced', HELD_KEY)],
            resolveFromPicks: async () => {
                throw new SourceHeldError([{ source: 'usda', externalKey: HELD_KEY }]);
            },
        });

        const refused = await world.service.patchResolve(FOOD_ID, ['c-raced']).catch((error: unknown) => error);

        expect(isCandidateMismatchError(refused)).toBe(true);
        expect(world.resolveToHolder).not.toHaveBeenCalled();
    });
});
