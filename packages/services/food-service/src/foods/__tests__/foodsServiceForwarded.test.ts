/**
 * `GET /api/v1/foods/{id}` and `GET /api/v1/foods/{id}/status` for a RETIRED root (curated catalog plan U8 S6; ADR-0050
 * §4): a root the service or the seed retired names its successor in `food_forward`, and the read serves the live end
 * of that chain UNDER THE REQUESTED ID, naming the live entry in `forwardedTo`.
 *
 * Before this, both routes read the retired row itself, so a caller polling the id add-by-name had handed back got a
 * `200` carrying a `RESOLVED` food with no nutrients, and never learned where the food went.
 *
 * - a root forwarded to a live root, and to a live VARIANT (whose own nutrients answer);
 * - a root retired with NO successor still answers as itself (R29), with no `forwardedTo`;
 * - a chain that reaches nothing that answers is the plain 404, never the retired row's empty record;
 * - the target's status decides the answer (a `PENDING` target is a `202`), reported under the requested id;
 * - a live root costs no forward read at all.
 *
 * Every collaborator is a double over a database with no client, so a method a case did not replace fails loudly.
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { describe, expect, it, vi } from 'vitest';

import * as schema from '../../db/schema/index.js';
import { FoodMetrics } from '../../observability/emfMetrics.js';
import { SourceAdapterRegistry } from '../../sources/SourceAdapterRegistry.js';
import { CatalogOwnerReader } from '../catalogOwnerReader.service.js';
import { AuthoredFoodsDao } from '../dao/authoredFoods.dao.js';
import { FoodDao, type FoodRefFacts, type GoldenFoodRecord } from '../dao/food.dao.js';
import { CandidateStore } from '../dao/foodCandidates.dao.js';
import { FoodForwardDao, type ForwardOutcome } from '../dao/foodForward.dao.js';
import { FoodSearchDao } from '../dao/foodSearch.dao.js';
import { FoodSourcesDao } from '../dao/foodSources.dao.js';
import { FoodVariantDao, type VariantFacts } from '../dao/foodVariant.dao.js';
import type { RefFacts } from '../domain/foodRefResolution.js';
import { EnqueueEmitter } from '../enqueue.emitter.js';
import { isFoodNotFoundError, isFoodPendingError } from '../foods.errors.js';
import { FoodsService } from '../foods.service.js';
import { MergeAndPersistService } from '../merge/mergeAndPersist.service.js';
import { GoldenRecordMergeEngine } from '../merge/mergeEngine.js';
import { makeGoldenFoodRecord } from '../__fixtures__/goldenFoodRecord.js';

const CALLER = '01J9ZK8N7QF3B2X4M6T0V5C1AB';
const RETIRED = 'R-retired';
const LIVE_ROOT = 'R-live';
const LIVE_VARIANT = 'V-live';

/** A database with no client: a DAO method a case did not replace fails on its first query. */
const db = drizzle.mock({ schema });

/** A pool that can never connect (port 1 refuses), for the collaborators typed on a pooled client. */
const unreachable = new pg.Pool({ host: '127.0.0.1', port: 1 });

const rootFacts = (overrides: Partial<FoodRefFacts> & Pick<FoodRefFacts, 'id'>): FoodRefFacts => ({
    name: 'Broccoli',
    status: 'RESOLVED',
    userId: null,
    visibility: 'public',
    retired: false,
    ...overrides,
});

const variantFacts = (overrides: Partial<VariantFacts> & Pick<VariantFacts, 'id' | 'rootId'>): VariantFacts => ({
    retired: false,
    parts: [{ attribute: 'cookingMethod', ordinal: 0, text: 'steamed' }],
    ...overrides,
});

/** What the owner reader reads for the retired root: the facts of its chain's roots, variants and forward. */
function factsOf(spec: {
    readonly end?: ForwardOutcome;
    readonly extraRoots?: readonly FoodRefFacts[];
    readonly variants?: readonly VariantFacts[];
}): RefFacts {
    return {
        roots: new Map(
            [rootFacts({ id: RETIRED, retired: true }), ...(spec.extraRoots ?? [])].map((facts) => [facts.id, facts]),
        ),
        variants: new Map((spec.variants ?? []).map((facts) => [facts.id, facts])),
        forwards: spec.end === undefined ? new Map() : new Map([[RETIRED, spec.end]]),
    };
}

/** The golden record a read of `id` answers, with the nutrients that say whose it is. */
const recordOf = (id: string, name: string, overrides: Partial<GoldenFoodRecord> = {}): GoldenFoodRecord =>
    makeGoldenFoodRecord({
        id,
        name,
        nutrients: [
            {
                nutrientId: 'n1',
                name: 'Energy',
                unit: 'kcal',
                infoodsTag: null,
                amount: '34',
                basis: 'per_100g',
                source: 'usda',
            },
        ],
        ...overrides,
    });

/**
 * The service over a retired root `RETIRED`, whose chain ends as `spec` says.
 *
 * @param spec - The chain's facts, and the records each read answers.
 * @returns The service and the doubles a case asserts on.
 */
function serviceOver(spec: { readonly facts: RefFacts; readonly records: Record<string, GoldenFoodRecord | null> }) {
    const readGoldenRecord = vi.fn(
        async (id: string, options?: { readonly variantId?: string }): Promise<GoldenFoodRecord | null> =>
            spec.records[options?.variantId === undefined ? id : `${id}#${options.variantId}`] ?? null,
    );
    const foodDao = Object.assign(new FoodDao(db, { notFoundTtlDays: 30 }), { readGoldenRecord });
    const refFacts = vi.fn(async () => spec.facts);
    const owners = Object.assign(
        new CatalogOwnerReader(
            new FoodSourcesDao(db),
            new FoodForwardDao(db),
            new FoodVariantDao(db),
            new FoodDao(db, { notFoundTtlDays: 30 }),
            new FoodMetrics('test', () => undefined),
        ),
        { refFacts },
    );
    const variants = Object.assign(new FoodVariantDao(db), { listLive: async () => [] });
    const registry = new SourceAdapterRegistry();
    const service = new FoodsService(
        foodDao,
        new CandidateStore(db, { ttlDays: 30 }),
        new FoodSourcesDao(db),
        new FoodSearchDao(drizzle(unreachable, { schema })),
        new MergeAndPersistService(db, new GoldenRecordMergeEngine(registry)),
        new EnqueueEmitter(unreachable),
        registry,
        new FoodMetrics('test', () => undefined),
        new AuthoredFoodsDao(db),
        variants,
        owners,
    );

    return { service, readGoldenRecord, refFacts };
}

const retiredRecord = recordOf(RETIRED, 'Broccoli', { retired: true, nutrients: [] });

describe('GET /{id} for a retired root serves the live end of its forward chain', () => {
    it('answers a root forwarded to a live root under the REQUESTED id, naming the live root', async () => {
        const { service } = serviceOver({
            facts: factsOf({
                end: { resolved: true, id: LIVE_ROOT, kind: 'root', hops: 1 },
                extraRoots: [rootFacts({ id: LIVE_ROOT })],
            }),
            records: { [RETIRED]: retiredRecord, [LIVE_ROOT]: recordOf(LIVE_ROOT, 'Broccoli, raw') },
        });

        const food = await service.getFood(RETIRED, CALLER);

        expect(food.id).toBe(RETIRED);
        expect(food.name).toBe('Broccoli, raw');
        expect(food.nutrients).toHaveLength(1);
        expect(food.forwardedTo).toEqual({ kind: 'root', id: LIVE_ROOT });
    });

    it("answers a root forwarded to a live VARIANT with the variant's own numbers, and no variants of its own", async () => {
        const { service, readGoldenRecord } = serviceOver({
            facts: factsOf({
                end: { resolved: true, id: LIVE_VARIANT, kind: 'variant', hops: 1 },
                extraRoots: [rootFacts({ id: LIVE_ROOT, name: 'Broccoli, raw' })],
                variants: [variantFacts({ id: LIVE_VARIANT, rootId: LIVE_ROOT })],
            }),
            records: {
                [RETIRED]: retiredRecord,
                [`${LIVE_ROOT}#${LIVE_VARIANT}`]: recordOf(LIVE_ROOT, 'Broccoli, raw'),
            },
        });

        const food = await service.getFood(RETIRED, CALLER);

        expect(readGoldenRecord).toHaveBeenCalledWith(LIVE_ROOT, { variantId: LIVE_VARIANT });
        expect(food.id).toBe(RETIRED);
        expect(food.nutrients).toHaveLength(1);
        expect(food.variants).toEqual([]);
        expect(food.forwardedTo).toEqual({ kind: 'variant', id: LIVE_VARIANT });
    });

    it('answers a root the seed retired with NO successor as itself (R29), with no forwardedTo', async () => {
        const own = recordOf(RETIRED, 'Broccoli', { retired: true });
        const { service } = serviceOver({
            facts: factsOf({ end: { resolved: true, id: RETIRED, kind: undefined, hops: 0 } }),
            records: { [RETIRED]: own },
        });

        const food = await service.getFood(RETIRED, CALLER);

        expect(food.id).toBe(RETIRED);
        expect(food.nutrients).toHaveLength(1);
        expect(food.forwardedTo).toBeUndefined();
    });

    it('answers the plain 404 when the chain reaches nothing that answers, never the retired empty record', async () => {
        const { service } = serviceOver({
            facts: factsOf({ end: { resolved: false, reason: 'cycle' } }),
            records: { [RETIRED]: retiredRecord },
        });

        const error = await service.getFood(RETIRED, CALLER).catch((caught: unknown) => caught);

        expect(isFoodNotFoundError(error)).toBe(true);
    });

    it("lets the target's status decide the answer, reported under the requested id", async () => {
        const { service } = serviceOver({
            facts: factsOf({
                end: { resolved: true, id: LIVE_ROOT, kind: 'root', hops: 1 },
                extraRoots: [rootFacts({ id: LIVE_ROOT, status: 'PENDING' })],
            }),
            records: {
                [RETIRED]: retiredRecord,
                [LIVE_ROOT]: recordOf(LIVE_ROOT, 'Broccoli, raw', { status: 'PENDING' }),
            },
        });

        const error = await service.getFood(RETIRED, CALLER).catch((caught: unknown) => caught);

        expect(isFoodPendingError(error)).toBe(true);
        expect(error).toMatchObject({ id: RETIRED, status: 'PENDING' });
    });

    it('reads no forwards at all for a live root', async () => {
        const live = recordOf(LIVE_ROOT, 'Broccoli, raw');
        const { service, refFacts } = serviceOver({ facts: factsOf({}), records: { [LIVE_ROOT]: live } });

        const food = await service.getFood(LIVE_ROOT, CALLER);

        expect(food.id).toBe(LIVE_ROOT);
        expect(food.forwardedTo).toBeUndefined();
        expect(refFacts).not.toHaveBeenCalled();
    });
});

describe('GET /{id}/status for a retired root serves the live end too', () => {
    it('answers the requested id with the live root as the golden record, naming it', async () => {
        const { service } = serviceOver({
            facts: factsOf({
                end: { resolved: true, id: LIVE_ROOT, kind: 'root', hops: 1 },
                extraRoots: [rootFacts({ id: LIVE_ROOT })],
            }),
            records: { [RETIRED]: retiredRecord, [LIVE_ROOT]: recordOf(LIVE_ROOT, 'Broccoli, raw') },
        });

        const status = await service.getStatus(RETIRED, CALLER);

        expect(status.id).toBe(RETIRED);
        expect(status.status).toBe('RESOLVED');
        expect(status.food?.id).toBe(RETIRED);
        expect(status.food?.nutrients).toHaveLength(1);
        expect(status.food?.forwardedTo).toEqual({ kind: 'root', id: LIVE_ROOT });
    });

    it("reports a forwarded target's PENDING status under the requested id, with no food", async () => {
        const { service } = serviceOver({
            facts: factsOf({
                end: { resolved: true, id: LIVE_ROOT, kind: 'root', hops: 1 },
                extraRoots: [rootFacts({ id: LIVE_ROOT, status: 'PENDING' })],
            }),
            records: {
                [RETIRED]: retiredRecord,
                [LIVE_ROOT]: recordOf(LIVE_ROOT, 'Broccoli, raw', { status: 'PENDING' }),
            },
        });

        const status = await service.getStatus(RETIRED, CALLER);

        expect(status).toMatchObject({ id: RETIRED, status: 'PENDING' });
        expect(status.food).toBeUndefined();
    });

    it('answers the plain 404 for a broken chain', async () => {
        const { service } = serviceOver({
            facts: factsOf({ end: { resolved: false, reason: 'depth' } }),
            records: { [RETIRED]: retiredRecord },
        });

        const error = await service.getStatus(RETIRED, CALLER).catch((caught: unknown) => caught);

        expect(isFoodNotFoundError(error)).toBe(true);
    });
});
