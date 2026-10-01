/**
 * The edge-cached nutrition batch over roots, variants and forwards (curated plan U8 S6, R18; ADR-0020).
 *
 * Unit tier over doubled DAOs and reader. The SQL is the LOCAL e2e tier's job (`tests/e2e/foodsNutrition.e2e.test.ts`).
 */
import { describe, expect, it, vi } from 'vitest';

import { makeFoodRefFacts } from '../__fixtures__/foodRefFacts.js';
import type { CatalogOwnerReader } from '../catalogOwnerReader.service.js';
import type { FoodDao, FoodRefFacts, NutritionRecord } from '../dao/food.dao.js';
import type { ForwardOutcome } from '../dao/foodForward.dao.js';
import type { FoodVariantDao, VariantFacts, VariantNutrition } from '../dao/foodVariant.dao.js';
import { FoodsService } from '../foods.service.js';
import { FoodMetrics } from '../../observability/emfMetrics.js';

const kcal = (amount: string): NutritionRecord['nutrients'][number] => ({
    nutrient: 'Energy',
    infoodsTag: 'ENERC_KCAL',
    unit: 'kcal',
    basis: 'per_100g',
    amount,
    trace: false,
});

interface World {
    readonly roots?: readonly FoodRefFacts[];
    readonly variants?: readonly VariantFacts[];
    readonly forwards?: Readonly<Record<string, ForwardOutcome>>;
    readonly records?: readonly NutritionRecord[];
    readonly variantNutrition?: readonly VariantNutrition[];
    readonly rootsWithVariants?: readonly string[];
}

/** The service over a doubled world. */
function makeService(world: World): { service: FoodsService; readNutritionBatch: ReturnType<typeof vi.fn> } {
    const readNutritionBatch = vi.fn(async (ids: readonly string[]) =>
        (world.records ?? []).filter((record) => ids.includes(record.id)),
    );
    const refFacts = vi.fn(async () => ({
        roots: new Map((world.roots ?? []).map((root) => [root.id, root])),
        variants: new Map((world.variants ?? []).map((variant) => [variant.id, variant])),
        forwards: new Map(Object.entries(world.forwards ?? {})),
    }));
    const readNutrition = vi.fn(async (ids: readonly string[]) =>
        (world.variantNutrition ?? []).filter((row) => ids.includes(row.id)),
    );
    const liveVariantRoots = vi.fn(
        async (ids: readonly string[]) => new Set((world.rootsWithVariants ?? []).filter((id) => ids.includes(id))),
    );
    const unused = undefined as never;
    const service = new FoodsService(
        { readNutritionBatch } as unknown as FoodDao,
        unused,
        unused,
        unused,
        unused,
        unused,
        unused,
        new FoodMetrics(() => undefined),
        unused,
        { readNutrition, liveVariantRoots } as unknown as FoodVariantDao,
        { refFacts } as unknown as CatalogOwnerReader,
    );

    return { service, readNutritionBatch };
}

const BRISKET = makeFoodRefFacts({ id: 'R-brisket', name: 'beef brisket' });
const FLAT: VariantFacts = { id: 'V-flat', rootId: 'R-brisket', retired: false, parts: [] };

describe('getNutritionBatch — roots, variants and forwards (curated U8 S6)', () => {
    it('answers a variant id with the VARIANT’s own numbers and portions, its root’s status, under the requested id', async () => {
        const { service } = makeService({
            roots: [BRISKET],
            variants: [FLAT],
            records: [{ id: 'R-brisket', status: 'RESOLVED', nutrients: [kcal('170')], portions: [] }],
            variantNutrition: [
                { id: 'V-flat', nutrients: [kcal('155')], portions: [{ label: '1 cup', gramWeight: '140' }] },
            ],
        });

        expect(await service.getNutritionBatch(['V-flat'])).toStrictEqual({
            foods: [
                {
                    id: 'V-flat',
                    status: 'RESOLVED',
                    caloriesPer100g: 155,
                    proteinGPer100g: undefined,
                    carbsGPer100g: undefined,
                    fatGPer100g: undefined,
                    portions: [{ unit: 'cup', gramsPerUnit: 140 }],
                },
            ],
            unknownIds: [],
        });
    });

    it('answers a forwarded id with its TARGET’s entry, under the REQUESTED id', async () => {
        const { service } = makeService({
            roots: [makeFoodRefFacts({ id: 'R-old', retired: true }), BRISKET],
            forwards: { 'R-old': { resolved: true, id: 'R-brisket', kind: 'root', hops: 1 } },
            records: [{ id: 'R-brisket', status: 'RESOLVED', nutrients: [kcal('170')], portions: [] }],
        });

        const { foods } = await service.getNutritionBatch(['R-old']);

        expect(foods).toHaveLength(1);
        expect(foods[0]).toMatchObject({ id: 'R-old', status: 'RESOLVED', caloriesPer100g: 170 });
    });

    it('sets `hasLiveVariants` on a root entry, true or false, and never on a variant entry', async () => {
        const { service } = makeService({
            roots: [BRISKET, makeFoodRefFacts({ id: 'R-crust', name: 'pizza crust' })],
            variants: [FLAT],
            records: [
                { id: 'R-brisket', status: 'RESOLVED', nutrients: [], portions: [] },
                { id: 'R-crust', status: 'RESOLVED', nutrients: [], portions: [] },
            ],
            variantNutrition: [{ id: 'V-flat', nutrients: [], portions: [] }],
            rootsWithVariants: ['R-brisket'],
        });

        const { foods } = await service.getNutritionBatch(['R-brisket', 'R-crust', 'V-flat']);

        expect(foods.map((entry) => [entry.id, entry.hasLiveVariants])).toStrictEqual([
            ['R-brisket', true],
            ['R-crust', false],
            ['V-flat', undefined],
        ]);
        expect(foods[2]).not.toHaveProperty('hasLiveVariants');
    });

    it('⛔ ADR-0020: an authored root, a variant of one, and a forward to one are all UNKNOWN — no caller enters', async () => {
        const authored = makeFoodRefFacts({ id: 'R-mine', userId: 'U-1', visibility: 'private' });
        const { service } = makeService({
            roots: [authored, makeFoodRefFacts({ id: 'R-old', retired: true })],
            variants: [{ ...FLAT, id: 'V-mine', rootId: 'R-mine' }],
            forwards: { 'R-old': { resolved: true, id: 'R-mine', kind: 'root', hops: 1 } },
            records: [{ id: 'R-mine', status: 'RESOLVED', nutrients: [kcal('1')], portions: [] }],
            variantNutrition: [{ id: 'V-mine', nutrients: [kcal('2')], portions: [] }],
        });

        expect(await service.getNutritionBatch(['R-mine', 'R-old', 'V-mine'])).toStrictEqual({
            foods: [],
            unknownIds: ['R-mine', 'R-old', 'V-mine'],
        });
    });

    it('reports an unresolved forward as unknown, never an error', async () => {
        const { service } = makeService({
            roots: [makeFoodRefFacts({ id: 'R-loop', retired: true })],
            forwards: { 'R-loop': { resolved: false, reason: 'cycle' } },
        });

        expect(await service.getNutritionBatch(['R-loop'])).toStrictEqual({ foods: [], unknownIds: ['R-loop'] });
    });

    it('reads each target root’s record once, in ONE batched read', async () => {
        const { service, readNutritionBatch } = makeService({
            roots: [makeFoodRefFacts({ id: 'R-old', retired: true }), BRISKET],
            forwards: { 'R-old': { resolved: true, id: 'R-brisket', kind: 'root', hops: 1 } },
            records: [{ id: 'R-brisket', status: 'RESOLVED', nutrients: [], portions: [] }],
        });

        await service.getNutritionBatch(['R-brisket', 'R-old']);

        expect(readNutritionBatch).toHaveBeenCalledTimes(1);
        expect(readNutritionBatch).toHaveBeenCalledWith(['R-brisket']);
    });
});
