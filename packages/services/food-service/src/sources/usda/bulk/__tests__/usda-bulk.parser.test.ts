/**
 * Unit suite for the USDA **bulk-download** → `CanonicalCandidate` mapping (Stage 1 seed importer,
 * plan §2 Stage 1 / F-W2). The bulk CSV schema is NOT the API's `UsdaFoodDetail`, so this mapping is a
 * separate boundary from `UsdaSourceAdapter.mapToCanonical` — these tests pin its contract:
 *
 *   - the canonical shape (name/description/kind/brand nulls, `externalKey` from `fdc_id`);
 *   - unit canonicalization ALIGNED WITH THE LIVE API dictionary (`UG` → `µg`, not `ug`) so a bulk value
 *     and a live value for the same nutrient resolve to ONE `nutrient (name, unit)` dictionary row (DB-5);
 *   - reject-not-store at the VALUE grain for every malformed shape the real files actually contain
 *     (blank `amount`, a `nutrient_id` missing from `nutrient.csv`, negative/non-finite/over-range
 *     amounts, orphan portions, `undetermined` measure units);
 *   - a deterministic, order-independent, `bulk:`-prefixed `itemVersion` (the importer's
 *     skip-unchanged key) that can NEVER be mistaken for an API `publicationDate`.
 */
import { describe, expect, it } from 'vitest';

import { BULK_ITEM_VERSION_PREFIX, bulkItemVersion, mapBulkFoodToCanonical } from '../usda-bulk.parser.js';
import {
    makeBulkFoodBundle,
    makeBulkLookups,
    makeBulkNutrientRow,
    makeBulkPortionRow,
} from '../__fixtures__/usda-bulk.fixtures.js';

const lookups = makeBulkLookups();

describe('mapBulkFoodToCanonical — canonical shape', () => {
    it('maps an SR-Legacy bundle to a generic, unbranded canonical candidate keyed by fdc_id', () => {
        const candidate = mapBulkFoodToCanonical(makeBulkFoodBundle(), lookups);

        expect(candidate).not.toBeNull();
        expect(candidate?.source).toBe('usda');
        expect(candidate?.externalKey).toBe('170379');
        expect(candidate?.name).toBe('Broccoli, raw');
        expect(candidate?.description).toBe('Broccoli, raw');
        // Foundation + SR Legacy are lab-analyzed whole foods — never Branded (FR-IDN-3).
        expect(candidate?.kind).toBe('generic');
        expect(candidate?.brandOwner).toBeNull();
        expect(candidate?.brandName).toBeNull();
        expect(candidate?.barcode).toBeNull();
    });

    it('trims surrounding whitespace from the description before using it as the golden name', () => {
        const candidate = mapBulkFoodToCanonical(makeBulkFoodBundle({ description: '  Broccoli, raw  ' }), lookups);

        expect(candidate?.name).toBe('Broccoli, raw');
        expect(candidate?.description).toBe('Broccoli, raw');
    });

    it('drops a food whose description is blank (no usable name — reject-not-store, whole candidate)', () => {
        expect(mapBulkFoodToCanonical(makeBulkFoodBundle({ description: '' }), lookups)).toBeNull();
        expect(mapBulkFoodToCanonical(makeBulkFoodBundle({ description: '   ' }), lookups)).toBeNull();
    });
});

describe('mapBulkFoodToCanonical — nutrients', () => {
    it('resolves nutrient_id against nutrient.csv and canonicalizes the (name, unit) dictionary key', () => {
        const candidate = mapBulkFoodToCanonical(
            makeBulkFoodBundle({
                nutrients: [
                    makeBulkNutrientRow({ nutrientId: '1003', amount: '2.82' }),
                    makeBulkNutrientRow({ nutrientId: '1008', amount: '34' }),
                    makeBulkNutrientRow({ nutrientId: '1087', amount: '47' }),
                ],
            }),
            lookups,
        );

        expect(candidate?.nutrients).toEqual([
            { code: null, name: 'Protein', unit: 'g', amount: '2.82', basis: 'per_100g' },
            { code: null, name: 'Energy', unit: 'kcal', amount: '34', basis: 'per_100g' },
            { code: null, name: 'Calcium, ca', unit: 'mg', amount: '47', basis: 'per_100g' },
        ]);
    });

    it('maps the bulk `UG` unit to the live API `µg` so bulk + live share ONE dictionary row (DB-5)', () => {
        const candidate = mapBulkFoodToCanonical(
            makeBulkFoodBundle({ nutrients: [makeBulkNutrientRow({ nutrientId: '1114', amount: '0.1' })] }),
            lookups,
        );

        // The live adapter sees the API's `"unitName": "µg"` and lowercases it to `µg`. If bulk emitted
        // `ug`, the same nutrient would split into TWO `nutrient` rows and defeat the golden-value invariant.
        expect(candidate?.nutrients[0]?.unit).toBe('µg');
    });

    it('lowercases the rare bulk units it has no API-aligned mapping for (IU, kJ)', () => {
        const candidate = mapBulkFoodToCanonical(
            makeBulkFoodBundle({
                nutrients: [
                    makeBulkNutrientRow({ nutrientId: '1110', amount: '3' }),
                    makeBulkNutrientRow({ nutrientId: '1062', amount: '141' }),
                ],
            }),
            lookups,
        );

        expect(candidate?.nutrients.map((entry) => entry.unit)).toEqual(['iu', 'kj']);
    });

    it('emits `code: null` so a bulk value and a live value never split the dictionary by external_code', () => {
        const candidate = mapBulkFoodToCanonical(makeBulkFoodBundle(), lookups);

        // `UsdaSourceAdapter.mapToCanonical` also emits `code: null`; a bulk-only `nutrient_nbr` would
        // create a code-keyed row the live path could never match (NutrientDao resolves by code first).
        expect(candidate?.nutrients.every((entry) => entry.code === null)).toBe(true);
    });

    it('always emits per_100g basis (bulk Foundation/SR Legacy amounts are per-100g)', () => {
        const candidate = mapBulkFoodToCanonical(makeBulkFoodBundle(), lookups);

        expect(candidate?.nutrients.every((entry) => entry.basis === 'per_100g')).toBe(true);
    });

    it('dedups repeated (name, unit) keys, first-wins', () => {
        const candidate = mapBulkFoodToCanonical(
            makeBulkFoodBundle({
                nutrients: [
                    makeBulkNutrientRow({ nutrientId: '1003', amount: '2.82' }),
                    makeBulkNutrientRow({ nutrientId: '1003', amount: '9.99' }),
                ],
            }),
            lookups,
        );

        expect(candidate?.nutrients).toHaveLength(1);
        expect(candidate?.nutrients[0]?.amount).toBe('2.82');
    });

    // ── Malformed rows the REAL files contain (measured from the published zips) ──────────────────────
    it('skips a blank amount but keeps the rest of the food (33 such rows exist in Foundation)', () => {
        const candidate = mapBulkFoodToCanonical(
            makeBulkFoodBundle({
                nutrients: [
                    makeBulkNutrientRow({ nutrientId: '1003', amount: '' }),
                    makeBulkNutrientRow({ nutrientId: '1008', amount: '34' }),
                ],
            }),
            lookups,
        );

        expect(candidate).not.toBeNull();
        expect(candidate?.nutrients).toHaveLength(1);
        expect(candidate?.nutrients[0]?.name).toBe('Energy');
    });

    it('skips a nutrient_id absent from nutrient.csv (FDC ships rows referencing a non-existent 2066)', () => {
        const candidate = mapBulkFoodToCanonical(
            makeBulkFoodBundle({
                nutrients: [
                    makeBulkNutrientRow({ nutrientId: '2066', amount: '1.5' }),
                    makeBulkNutrientRow({ nutrientId: '1003', amount: '2.82' }),
                ],
            }),
            lookups,
        );

        expect(candidate?.nutrients).toHaveLength(1);
        expect(candidate?.nutrients[0]?.name).toBe('Protein');
    });

    it.each([
        ['negative', '-7'],
        ['non-numeric', 'abc'],
        ['scientific notation', '1e5'],
        ['whitespace only', '   '],
        ['over the sanity bound', '10000001'],
    ])('skips a %s amount (reject-not-store at the value grain)', (_label, amount) => {
        const candidate = mapBulkFoodToCanonical(
            makeBulkFoodBundle({
                nutrients: [
                    makeBulkNutrientRow({ nutrientId: '1003', amount }),
                    makeBulkNutrientRow({ nutrientId: '1008', amount: '34' }),
                ],
            }),
            lookups,
        );

        expect(candidate?.nutrients.map((entry) => entry.name)).toEqual(['Energy']);
    });

    it('accepts a legitimate zero amount (0 g of fat is data, not absence)', () => {
        const candidate = mapBulkFoodToCanonical(
            makeBulkFoodBundle({ nutrients: [makeBulkNutrientRow({ nutrientId: '1004', amount: '0' })] }),
            lookups,
        );

        expect(candidate?.nutrients).toHaveLength(1);
        expect(candidate?.nutrients[0]?.amount).toBe('0');
    });

    it('keeps a food with NO usable nutrients at all (the golden record is still worth seeding)', () => {
        const candidate = mapBulkFoodToCanonical(
            makeBulkFoodBundle({ nutrients: [makeBulkNutrientRow({ amount: '' })] }),
            lookups,
        );

        expect(candidate).not.toBeNull();
        expect(candidate?.nutrients).toEqual([]);
    });
});

describe('mapBulkFoodToCanonical — portions', () => {
    it('prefers `modifier` for the portion label', () => {
        const candidate = mapBulkFoodToCanonical(
            makeBulkFoodBundle({
                portions: [makeBulkPortionRow({ modifier: 'cup, chopped', portionDescription: '1 cup' })],
            }),
            lookups,
        );

        expect(candidate?.portions).toEqual([{ label: 'cup, chopped', gramWeight: '91' }]);
    });

    it('falls back to `portion_description`, then to the measure_unit name', () => {
        const byDescription = mapBulkFoodToCanonical(
            makeBulkFoodBundle({
                portions: [makeBulkPortionRow({ modifier: '', portionDescription: '1 cup, chopped' })],
            }),
            lookups,
        );
        expect(byDescription?.portions[0]?.label).toBe('1 cup, chopped');

        const byMeasureUnit = mapBulkFoodToCanonical(
            makeBulkFoodBundle({
                portions: [makeBulkPortionRow({ modifier: '', portionDescription: '', measureUnitId: '1002' })],
            }),
            lookups,
        );
        expect(byMeasureUnit?.portions[0]?.label).toBe('tbsp');
    });

    it('skips the `undetermined` measure unit rather than labelling a portion with it', () => {
        const candidate = mapBulkFoodToCanonical(
            makeBulkFoodBundle({
                portions: [makeBulkPortionRow({ modifier: '', portionDescription: '', measureUnitId: '9999' })],
            }),
            lookups,
        );

        expect(candidate?.portions).toEqual([]);
    });

    it('skips a portion whose measure_unit_id is absent from measure_unit.csv (orphan rows exist)', () => {
        const candidate = mapBulkFoodToCanonical(
            makeBulkFoodBundle({
                portions: [makeBulkPortionRow({ modifier: '', portionDescription: '', measureUnitId: '' })],
            }),
            lookups,
        );

        expect(candidate?.portions).toEqual([]);
    });

    it.each([
        ['blank', ''],
        ['zero', '0'],
        ['negative', '-1'],
        ['non-numeric', 'n/a'],
        ['over the sanity bound', '10000001'],
    ])('skips a portion with a %s gram_weight (mirrors CHECK gram_weight > 0)', (_label, gramWeight) => {
        const candidate = mapBulkFoodToCanonical(
            makeBulkFoodBundle({
                portions: [
                    makeBulkPortionRow({ gramWeight }),
                    makeBulkPortionRow({ modifier: 'tbsp', gramWeight: '15' }),
                ],
            }),
            lookups,
        );

        expect(candidate?.portions).toEqual([{ label: 'tbsp', gramWeight: '15' }]);
    });
});

describe('bulkItemVersion — the skip-unchanged key', () => {
    const base = {
        name: 'Broccoli, raw',
        description: 'Broccoli, raw',
        nutrients: [{ code: null, name: 'Protein', unit: 'g', amount: '2.82', basis: 'per_100g' as const }],
        portions: [{ label: 'cup, chopped', gramWeight: '91' }],
    };

    it('is prefixed so it can never collide with an API publicationDate itemVersion', () => {
        expect(bulkItemVersion(base).startsWith(BULK_ITEM_VERSION_PREFIX)).toBe(true);
        expect(BULK_ITEM_VERSION_PREFIX).toBe('bulk:');
    });

    it('is deterministic for identical content', () => {
        expect(bulkItemVersion(base)).toBe(bulkItemVersion({ ...base }));
    });

    it('is order-independent (a reordered CSV must not look like an upstream change)', () => {
        const reordered = {
            ...base,
            nutrients: [
                { code: null, name: 'Energy', unit: 'kcal', amount: '34', basis: 'per_100g' as const },
                ...base.nutrients,
            ],
        };
        const sameSetOtherOrder = { ...reordered, nutrients: [...reordered.nutrients].reverse() };

        expect(bulkItemVersion(reordered)).toBe(bulkItemVersion(sameSetOtherOrder));
    });

    it('changes when a nutrient amount changes (a real upstream revision IS detected)', () => {
        const revised = {
            ...base,
            nutrients: [{ ...base.nutrients[0]!, amount: '3.10' }],
        };

        expect(bulkItemVersion(revised)).not.toBe(bulkItemVersion(base));
    });

    it('changes when a portion changes, and when the name changes', () => {
        expect(bulkItemVersion({ ...base, portions: [{ label: 'cup, chopped', gramWeight: '92' }] })).not.toBe(
            bulkItemVersion(base),
        );
        expect(bulkItemVersion({ ...base, name: 'Broccoli, cooked' })).not.toBe(bulkItemVersion(base));
    });

    it('is what the mapped candidate carries as its itemVersion', () => {
        const candidate = mapBulkFoodToCanonical(makeBulkFoodBundle(), lookups);

        expect(candidate?.itemVersion).toBe(
            bulkItemVersion({
                name: 'Broccoli, raw',
                description: 'Broccoli, raw',
                nutrients: candidate!.nutrients,
                portions: candidate!.portions,
            }),
        );
    });
});
