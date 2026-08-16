/**
 * `GET /api/v1/foods/nutrition` — the service-level behaviour (plan U8).
 *
 * ⛔ The load-bearing invariant here is **caller independence**. ADR-0020 keys food's CloudFront
 * distribution on the URL ALONE, which is sound only while this response depends on nothing about the
 * requester. If that ever stops being true, the edge serves one user's response to another — and nothing in
 * the distribution's configuration would look wrong. It is asserted here as a standing property, not a
 * one-time check.
 */
import { describe, it, expect, vi } from 'vitest';

import { FoodsService } from '../foods.service.js';

/** A golden record in the DAO's stored shape (string amounts — SC-008 arbitrary precision). */
function goldenRecord(id: string, over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
    return {
        id,
        name: `food ${id}`,
        status: 'RESOLVED',
        nutrients: [
            { name: 'Energy', amount: '239', unit: 'kcal', basis: 'per_100g', sourceId: 's1' },
            { name: 'Energy', amount: '1000', unit: 'kJ', basis: 'per_100g', sourceId: 's1' },
            { name: 'Protein', amount: '27', unit: 'g', basis: 'per_100g', sourceId: 's1' },
        ],
        portions: [{ id: 'p1', label: '1 cup', gramWeight: '125', sourceId: 's1' }],
        sources: [{ id: 's1', source: 'usda' }],
        fieldProvenance: [],
        ...over,
    };
}

/** Build a service whose DAO answers from the given records, keyed by id. */
function buildService(records: Array<Record<string, unknown>>): FoodsService {
    const byId = new Map(records.map((r) => [r['id'] as string, r]));
    const foodDao = { readGoldenRecord: vi.fn(async (id: string) => byId.get(id) ?? null) };

    return new FoodsService(
        foodDao as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        { recordLocalStoreServe: vi.fn() } as never,
    );
}

describe('getNutritionBatch', () => {
    it('returns many ids in ONE response, in the order given', async () => {
        const service = buildService([goldenRecord('a'), goldenRecord('b')]);

        const result = await service.getNutritionBatch(['a', 'b']);

        expect(result.foods.map((f) => f.id)).toEqual(['a', 'b']);
    });

    it('⛔ selects kcal, not the kJ row that shares its name — no 4.184× error', async () => {
        const service = buildService([goldenRecord('a')]);

        const result = await service.getNutritionBatch(['a']);

        expect(result.foods[0]?.caloriesPer100g).toBe(239);
    });

    it('⛔ reports a branded per_serving energy as ABSENT, never coerced to per-100g', async () => {
        const service = buildService([
            goldenRecord('a', {
                nutrients: [{ name: 'Energy', amount: '150', unit: 'kcal', basis: 'per_serving', sourceId: 's1' }],
            }),
        ]);

        const result = await service.getNutritionBatch(['a']);

        expect(result.foods[0]?.caloriesPer100g).toBeUndefined();
    });

    it('reports absent — not zero — for a food with no energy row', async () => {
        const service = buildService([goldenRecord('a', { nutrients: [] })]);

        const result = await service.getNutritionBatch(['a']);

        expect(result.foods[0]?.caloriesPer100g).toBeUndefined();
    });

    it('returns normalized portions with grams PER UNIT', async () => {
        const service = buildService([goldenRecord('a')]);

        const result = await service.getNutritionBatch(['a']);

        expect(result.foods[0]?.portions).toEqual([{ unit: 'cup', gramsPerUnit: 125 }]);
    });

    it('reports an uninterpretable portion absent rather than at a wrong weight', async () => {
        const service = buildService([
            goldenRecord('a', { portions: [{ id: 'p', label: 'a handful', gramWeight: '30', sourceId: 's1' }] }),
        ]);

        const result = await service.getNutritionBatch(['a']);

        expect(result.foods[0]?.portions).toEqual([]);
    });

    it('REPORTS an unresolved id rather than omitting it', async () => {
        // A silently shorter array is indistinguishable from a food that has no nutrition, so the caller
        // cannot tell whether to render "unknown" or "none".
        const service = buildService([goldenRecord('a')]);

        const result = await service.getNutritionBatch(['a', 'missing']);

        expect(result.foods.map((f) => f.id)).toEqual(['a']);
        expect(result.unknownIds).toEqual(['missing']);
    });

    it('carries a non-RESOLVED food`s status through instead of hiding the row', async () => {
        const service = buildService([goldenRecord('a', { status: 'PENDING', nutrients: [], portions: [] })]);

        const result = await service.getNutritionBatch(['a']);

        expect(result.foods[0]).toMatchObject({ id: 'a', status: 'PENDING' });
    });

    it('⛔ is BYTE-IDENTICAL for two different callers — the edge cache-key invariant', async () => {
        // ADR-0020 keys this response on the URL alone. Nothing caller-derived may enter it; if anything
        // ever does, CloudFront serves one user's body to another and the distribution looks correct.
        const service = buildService([goldenRecord('a'), goldenRecord('b')]);

        const first = await service.getNutritionBatch(['a', 'b']);
        const second = await service.getNutritionBatch(['a', 'b']);

        expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    });

    it('never enqueues or fetches — a read path must not trigger source resolution', async () => {
        // This is hit once per recipe-list render. If it could enqueue, one page view would fan out into
        // unbounded source calls.
        const enqueue = { emit: vi.fn() };
        const byId = new Map([['a', goldenRecord('a')]]);
        const service = new FoodsService(
            { readGoldenRecord: vi.fn(async (id: string) => byId.get(id) ?? null) } as never,
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

        await service.getNutritionBatch(['a']);

        expect(enqueue.emit).not.toHaveBeenCalled();
    });
});
