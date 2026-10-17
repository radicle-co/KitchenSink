/**
 * Unit suite for the USDA **bulk-download** → `CanonicalCandidate` mapping (plan §2 Stage 1 / F-W2), which
 * the curated seed's baseline reads the pinned archives through. The bulk CSV schema is NOT the API's
 * `UsdaFoodDetail`, so this mapping is a separate boundary from `UsdaSourceAdapter.mapToCanonical` — these tests
 * pin its contract:
 *
 *   - the canonical shape (name/description/kind/brand nulls, `externalKey` from `fdc_id`);
 *   - unit canonicalization ALIGNED WITH THE LIVE API dictionary (`UG` → `µg`, not `ug`) so a bulk value
 *     and a live value for the same nutrient resolve to ONE `nutrient (name, unit)` dictionary row (DB-5);
 *   - reject-not-store at the VALUE grain for every malformed shape the real files actually contain
 *     (blank `amount`, a `nutrient_id` missing from `nutrient.csv`, negative/non-finite/over-range
 *     amounts, orphan portions, `undetermined` measure units);
 *   - a deterministic, order-independent, `bulk:`-prefixed `itemVersion` that can NEVER be mistaken for an
 *     API `publicationDate`.
 */
import { describe, expect, it } from 'vitest';

import type { CanonicalPortion } from '../../../foodSourceAdapter.js';
import { BULK_ITEM_VERSION_PREFIX, bulkItemVersion, mapBulkFoodToCanonical } from '../usdaBulk.parser.js';
import {
    makeBulkFoodBundle,
    makeBulkLookups,
    makeBulkNutrientRow,
    makeBulkPortionRow,
} from '../__fixtures__/usdaBulk.fixtures.js';
import type { BulkPortionRow } from '../usdaBulk.types.js';

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

describe('mapBulkFoodToCanonical — the dataset a candidate cites (curated catalog plan U4, KTD-22)', () => {
    it.each([
        ['foundation_food', 'usdaSrFoundation'],
        ['sr_legacy_food', 'usdaSrFoundation'],
        ['survey_fndds_food', 'usdaFndds'],
    ] as const)('maps a %s row to the %s dataset', (dataType, dataset) => {
        expect(mapBulkFoodToCanonical(makeBulkFoodBundle({ dataType }), lookups)?.dataset).toBe(dataset);
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
    /**
     * The labels a bundle's portions map to.
     *
     * @param portions - The bundle's portion rows.
     * @returns Each kept portion.
     */
    function portionsOf(portions: readonly BulkPortionRow[]): readonly CanonicalPortion[] | undefined {
        return mapBulkFoodToCanonical(makeBulkFoodBundle({ portions }), lookups)?.portions;
    }

    it('labels an SR row with its amount, then its modifier, so the stored weight is true of the label', () => {
        expect(portionsOf([makeBulkPortionRow({ amount: '4', modifier: 'oz', gramWeight: '113' })])).toEqual([
            { label: '4 oz', gramWeight: '113' },
        ]);
    });

    it('labels a Foundation row with its amount, its measure unit, then its modifier', () => {
        expect(
            portionsOf([
                makeBulkPortionRow({ amount: '1.0', measureUnitId: '1000', modifier: 'chopped', gramWeight: '91' }),
                makeBulkPortionRow({ amount: '2.0', measureUnitId: '1002', modifier: '', gramWeight: '30' }),
            ]),
        ).toEqual([
            { label: '1 cup chopped', gramWeight: '91' },
            { label: '2 tbsp', gramWeight: '30' },
        ]);
    });

    it('labels an FNDDS row by its description, which states the amount, and never by its portion code', () => {
        expect(
            portionsOf([makeBulkPortionRow({ amount: '', portionDescription: '1 cup, chopped', modifier: '10205' })]),
        ).toEqual([{ label: '1 cup, chopped', gramWeight: '91' }]);
    });

    it.each([
        ['an `undetermined` unit and no modifier', { modifier: '', measureUnitId: '9999' }],
        ['an orphan measure_unit_id and no modifier', { modifier: '', measureUnitId: '' }],
        ['a zero amount (FDC ships 18 in SR)', { amount: '0' }],
        ['a blank amount and no description', { amount: '' }],
        ['a non-numeric amount', { amount: 'n/a' }],
    ])('skips a row with %s', (_case, overrides) => {
        expect(portionsOf([makeBulkPortionRow(overrides)])).toEqual([]);
    });

    it.each([
        ['blank', ''],
        ['zero', '0'],
        ['negative', '-1'],
        ['non-numeric', 'n/a'],
        ['over the sanity bound', '10000001'],
    ])('skips a portion with a %s gram_weight (mirrors CHECK gram_weight > 0)', (_label, gramWeight) => {
        expect(
            portionsOf([
                makeBulkPortionRow({ gramWeight }),
                makeBulkPortionRow({ modifier: 'tbsp', gramWeight: '15' }),
            ]),
        ).toEqual([{ label: '1 tbsp', gramWeight: '15' }]);
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
