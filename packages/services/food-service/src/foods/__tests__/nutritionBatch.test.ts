/**
 * `GET /api/v1/foods/nutrition` — the service-level behaviour (plan U8).
 *
 * ⛔ The load-bearing invariant here is **caller independence**. ADR-0020 keys food's CloudFront
 * distribution on the URL ALONE, which is sound only while this response depends on nothing about the
 * requester. If that ever stops being true, the edge serves one user's response to another — and nothing in
 * the distribution's configuration would look wrong. It is asserted here as a standing property, not a
 * one-time check.
 *
 * The DAO seam is `readNutritionBatch` — ONE batched read for the whole id list, replacing the per-id
 * `readGoldenRecord` fan-out. What that read returns is a set of stored rows in NO guaranteed order, so the
 * ordering, the unknown-id reporting and the projection are this layer's job and are asserted as such.
 * `tests/foodNutritionBatch.integration.test.ts` proves the read itself against a real database; nothing
 * here can, and nothing here tries to.
 */
import { describe, it, expect, vi } from 'vitest';

import { FoodsService } from '../foods.service.js';
import type { NutritionRecord } from '../dao/food.dao.js';

/** A food's nutrition rows in the DAO's STORED shape (string amounts — SC-008 arbitrary precision). */
function nutritionRecord(id: string, over: Partial<NutritionRecord> = {}): NutritionRecord {
    return {
        id,
        status: 'RESOLVED',
        nutrients: [
            { nutrient: 'Energy', amount: '239', unit: 'kcal', basis: 'per_100g' },
            { nutrient: 'Energy', amount: '1000', unit: 'kJ', basis: 'per_100g' },
            { nutrient: 'Protein', amount: '27', unit: 'g', basis: 'per_100g' },
        ],
        portions: [{ label: '1 cup', gramWeight: '125' }],
        ...over,
    };
}

/** The DAO double: one batched read that answers with the seeded records for the requested ids. */
function buildDao(records: readonly NutritionRecord[]) {
    return {
        readNutritionBatch: vi.fn(async (ids: readonly string[]) =>
            records.filter((record) => ids.includes(record.id)),
        ),
    };
}

/** Build a service over the given stored records, plus the DAO double so a test can inspect the call. */
function buildService(records: readonly NutritionRecord[]): {
    service: FoodsService;
    dao: ReturnType<typeof buildDao>;
    enqueue: { emit: ReturnType<typeof vi.fn> };
} {
    const dao = buildDao(records);
    const enqueue = { emit: vi.fn() };
    const service = new FoodsService(
        dao as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        enqueue as never,
        {} as never,
        {} as never,
        {} as never,
        { recordLocalStoreServe: vi.fn() } as never,
    );

    return { service, dao, enqueue };
}

describe('getNutritionBatch', () => {
    it('returns many ids in ONE response, in the order given', async () => {
        const { service } = buildService([nutritionRecord('a'), nutritionRecord('b')]);

        const result = await service.getNutritionBatch(['a', 'b']);

        expect(result.foods.map((f) => f.id)).toEqual(['a', 'b']);
    });

    it('⛔ issues ONE batched read for the whole id list — never one per id', async () => {
        // This is the defect the batched DAO exists to remove: `ids.map(readGoldenRecord)` cost 1+4
        // statements PER ID, so a 100-id request — one per recipe-list render — was ~500 round trips.
        const ids = Array.from({ length: 25 }, (_, index) => `id-${index}`);
        const { service, dao } = buildService(ids.map((id) => nutritionRecord(id)));

        await service.getNutritionBatch(ids);

        expect(dao.readNutritionBatch).toHaveBeenCalledTimes(1);
        expect(dao.readNutritionBatch).toHaveBeenCalledWith(ids);
    });

    it('orders the response by the REQUESTED ids, not by whatever order the read returned rows in', async () => {
        // A batched `WHERE food_id = ANY(...)` promises no row order at all, so the wire order — which the
        // edge caches under the canonical URL — has to be imposed here.
        const { service } = buildService([nutritionRecord('c'), nutritionRecord('a'), nutritionRecord('b')]);

        const result = await service.getNutritionBatch(['a', 'b', 'c']);

        expect(result.foods.map((f) => f.id)).toEqual(['a', 'b', 'c']);
    });

    it('⛔ selects kcal, not the kJ row that shares its name — no 4.184× error', async () => {
        const { service } = buildService([nutritionRecord('a')]);

        const result = await service.getNutritionBatch(['a']);

        expect(result.foods[0]?.caloriesPer100g).toBe(239);
    });

    it('⛔ reports energy ABSENT when the food stores ONLY a kJ row — never the 4.184× figure', async () => {
        const { service } = buildService([
            nutritionRecord('a', {
                nutrients: [{ nutrient: 'Energy', amount: '1000', unit: 'kJ', basis: 'per_100g' }],
            }),
        ]);

        const result = await service.getNutritionBatch(['a']);

        expect(result.foods[0]?.caloriesPer100g).toBeUndefined();
    });

    it('⛔ reports a branded per_serving energy as ABSENT, never coerced to per-100g', async () => {
        const { service } = buildService([
            nutritionRecord('a', {
                nutrients: [{ nutrient: 'Energy', amount: '150', unit: 'kcal', basis: 'per_serving' }],
            }),
        ]);

        const result = await service.getNutritionBatch(['a']);

        expect(result.foods[0]?.caloriesPer100g).toBeUndefined();
    });

    it('⛔ does not read "Fatty acids, total trans" as total fat — the substring trap', async () => {
        const { service } = buildService([
            nutritionRecord('a', {
                nutrients: [{ nutrient: 'Fatty acids, total trans', amount: '0.5', unit: 'g', basis: 'per_100g' }],
            }),
        ]);

        const result = await service.getNutritionBatch(['a']);

        expect(result.foods[0]?.fatGPer100g).toBeUndefined();
    });

    it('reports absent — not zero — for a food with no energy row', async () => {
        const { service } = buildService([nutritionRecord('a', { nutrients: [] })]);

        const result = await service.getNutritionBatch(['a']);

        expect(result.foods[0]?.caloriesPer100g).toBeUndefined();
    });

    it('converts the STORED string amount to the wire number — the seam that keeps calories off NaN', async () => {
        const { service } = buildService([
            nutritionRecord('a', {
                nutrients: [{ nutrient: 'Protein', amount: '2.8', unit: 'g', basis: 'per_100g' }],
            }),
        ]);

        const result = await service.getNutritionBatch(['a']);

        expect(result.foods[0]?.proteinGPer100g).toBe(2.8);
    });

    it('returns normalized portions with grams PER UNIT', async () => {
        const { service } = buildService([nutritionRecord('a')]);

        const result = await service.getNutritionBatch(['a']);

        expect(result.foods[0]?.portions).toEqual([{ unit: 'cup', gramsPerUnit: 125 }]);
    });

    it('reports an uninterpretable portion absent rather than at a wrong weight', async () => {
        const { service } = buildService([
            nutritionRecord('a', { portions: [{ label: 'a handful', gramWeight: '30' }] }),
        ]);

        const result = await service.getNutritionBatch(['a']);

        expect(result.foods[0]?.portions).toEqual([]);
    });

    it('REPORTS an unresolved id rather than omitting it', async () => {
        // A silently shorter array is indistinguishable from a food that has no nutrition, so the caller
        // cannot tell whether to render "unknown" or "none".
        const { service } = buildService([nutritionRecord('a')]);

        const result = await service.getNutritionBatch(['a', 'missing']);

        expect(result.foods.map((f) => f.id)).toEqual(['a']);
        expect(result.unknownIds).toEqual(['missing']);
    });

    it('reports unknown ids in the REQUESTED order', async () => {
        const { service } = buildService([nutritionRecord('b')]);

        const result = await service.getNutritionBatch(['a', 'b', 'c']);

        expect(result.unknownIds).toEqual(['a', 'c']);
    });

    it('carries a non-RESOLVED food`s status through instead of hiding the row', async () => {
        const { service } = buildService([nutritionRecord('a', { status: 'PENDING', nutrients: [], portions: [] })]);

        const result = await service.getNutritionBatch(['a']);

        expect(result.foods[0]).toMatchObject({ id: 'a', status: 'PENDING' });
    });

    it('⛔ is BYTE-IDENTICAL for two different callers — the edge cache-key invariant', async () => {
        // ADR-0020 keys this response on the URL alone. Nothing caller-derived may enter it; if anything
        // ever does, CloudFront serves one user's body to another and the distribution looks correct.
        const { service } = buildService([nutritionRecord('a'), nutritionRecord('b')]);

        const first = await service.getNutritionBatch(['a', 'b']);
        const second = await service.getNutritionBatch(['a', 'b']);

        expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    });

    it('never enqueues or fetches — a read path must not trigger source resolution', async () => {
        // This is hit once per recipe-list render. If it could enqueue, one page view would fan out into
        // unbounded source calls.
        const { service, enqueue } = buildService([nutritionRecord('a')]);

        await service.getNutritionBatch(['a']);

        expect(enqueue.emit).not.toHaveBeenCalled();
    });
});
