/**
 * Unit suite for the USDA bulk-download CSV reader (Stage 1 seed importer). Exercises the reader against
 * REAL on-disk CSV files written to a temp directory — the quirks pinned here were all measured from the
 * published FDC zips, and every one of them silently corrupts a naive line-splitting/positional loader:
 *
 *   - every field is double-quoted, including integers and empty strings, and a quoted field can contain
 *     an embedded NEWLINE (Foundation `food.csv` has one) — so a real RFC4180 parser is mandatory;
 *   - `food_nutrient.csv` has 11 columns in the per-dataset zips and 13 in the full download, so columns
 *     MUST be resolved by header NAME, never by position;
 *   - the Foundation zip's `food.csv` is 87,990 rows of which only 469 are `foundation_food` (the rest are
 *     the `sub_sample_food` / `market_acquisition` / `sample_food` provenance chain) — the `data_type`
 *     filter is what keeps the importer from seeding 187× the intended rows, and Branded is NEVER seeded;
 *   - `food_portion.csv` / `measure_unit.csv` are OPTIONAL (a dataset without them still seeds).
 *
 * No network: the seeder never calls the live USDA API, so neither do its tests.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CanonicalCandidate } from '../../../food-source-adapter.js';
import { isUsdaBulkFormatError } from '../usda-bulk.errors.js';
import { loadBulkLookups, streamBulkCandidates, streamBulkFoodBundles } from '../usda-bulk.reader.js';
import type { BulkFoodBundle } from '../usda-bulk.types.js';

/** Quote every field the way FDC does, and join with LF (FDC files are LF-only). */
function csv(rows: readonly (readonly string[])[]): string {
    return `${rows.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\n')}\n`;
}

const FOOD_HEADER = ['fdc_id', 'data_type', 'description', 'food_category_id', 'publication_date'] as const;
/** The 11-column per-dataset-zip shape. */
const FOOD_NUTRIENT_HEADER = [
    'id',
    'fdc_id',
    'nutrient_id',
    'amount',
    'data_points',
    'derivation_id',
    'min',
    'max',
    'median',
    'footnote',
    'min_year_acquired',
] as const;
const NUTRIENT_HEADER = ['id', 'name', 'unit_name', 'nutrient_nbr', 'rank'] as const;
const PORTION_HEADER = [
    'id',
    'fdc_id',
    'seq_num',
    'amount',
    'measure_unit_id',
    'portion_description',
    'modifier',
    'gram_weight',
    'data_points',
    'footnote',
    'min_year_acquired',
] as const;
const MEASURE_UNIT_HEADER = ['id', 'name'] as const;

describe('USDA bulk CSV reader', () => {
    let dir: string;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'fdc-bulk-'));
    });

    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    /** Write a CSV file into the temp bulk directory. */
    function write(file: string, rows: readonly (readonly string[])[]): void {
        writeFileSync(join(dir, file), csv(rows));
    }

    /** Write a minimal-but-complete bulk dataset (2 seedable foods + 1 excluded Branded row). */
    function writeCompleteDataset(): void {
        write('food.csv', [
            [...FOOD_HEADER],
            ['170379', 'sr_legacy_food', 'Broccoli, raw', '11', '2019-04-01'],
            ['747447', 'foundation_food', 'Cheese, cheddar', '1', '2019-12-16'],
            ['2057648', 'branded_food', 'GREEK YOGURT', 'Yogurt', '2021-07-29'],
            ['321829', 'sub_sample_food', 'Broccoli, steamed, sub sample', '11', '6/2/2023'],
        ]);
        write('food_nutrient.csv', [
            [...FOOD_NUTRIENT_HEADER],
            ['1', '170379', '1003', '2.82', '', '71', '', '', '', '', ''],
            ['2', '170379', '1008', '34', '', '71', '', '', '', '', ''],
            ['3', '747447', '1003', '22.87', '', '71', '', '', '', '', ''],
            // A nutrient row for a food we do NOT seed — must be ignored, not attached to anything.
            ['4', '2057648', '1003', '9.5', '', '71', '', '', '', '', ''],
        ]);
        write('nutrient.csv', [
            [...NUTRIENT_HEADER],
            ['1003', 'Protein', 'G', '203', '600'],
            ['1008', 'Energy', 'KCAL', '208', '300'],
            ['1114', 'Vitamin D (D2 + D3)', 'UG', '328', '8700'],
        ]);
        write('food_portion.csv', [
            [...PORTION_HEADER],
            ['10', '170379', '1', '1', '1000', '', 'cup, chopped', '91', '', '', ''],
            ['11', '747447', '1', '1', '9999', '1 cup, diced', '', '132', '', '', ''],
        ]);
        write('measure_unit.csv', [[...MEASURE_UNIT_HEADER], ['1000', 'cup'], ['9999', 'undetermined']]);
    }

    /** Drain an async generator into an array. */
    async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
        const out: T[] = [];

        for await (const item of source) {
            out.push(item);
        }

        return out;
    }

    describe('loadBulkLookups', () => {
        it('loads the nutrient + measure-unit reference tables by header name', async () => {
            writeCompleteDataset();

            const lookups = await loadBulkLookups(dir);

            expect(lookups.nutrientsById.get('1003')).toEqual({ name: 'Protein', unitName: 'G' });
            expect(lookups.nutrientsById.get('1114')).toEqual({
                name: 'Vitamin D (D2 + D3)',
                unitName: 'UG',
            });
            expect(lookups.measureUnitsById.get('1000')).toBe('cup');
            expect(lookups.measureUnitsById.size).toBe(2);
        });

        it('treats measure_unit.csv as OPTIONAL (a dataset without portions still loads)', async () => {
            writeCompleteDataset();
            rmSync(join(dir, 'measure_unit.csv'));

            const lookups = await loadBulkLookups(dir);

            expect(lookups.measureUnitsById.size).toBe(0);
            expect(lookups.nutrientsById.size).toBe(3);
        });

        it('rejects a missing REQUIRED nutrient.csv with a typed format error', async () => {
            writeCompleteDataset();
            rmSync(join(dir, 'nutrient.csv'));

            await expect(loadBulkLookups(dir)).rejects.toSatisfy(isUsdaBulkFormatError);
        });

        it('rejects nutrient.csv missing the unit_name column (schema drift, not a silent null unit)', async () => {
            writeCompleteDataset();
            write('nutrient.csv', [
                ['id', 'name', 'nutrient_nbr', 'rank'],
                ['1003', 'Protein', '203', '600'],
            ]);

            await expect(loadBulkLookups(dir)).rejects.toSatisfy(isUsdaBulkFormatError);
        });
    });

    describe('streamBulkFoodBundles', () => {
        it('yields ONLY foundation_food + sr_legacy_food rows (Branded and the sample chain excluded)', async () => {
            writeCompleteDataset();

            const bundles = await collect(streamBulkFoodBundles({ dir }));

            expect(bundles.map((bundle) => bundle.fdcId).sort()).toEqual(['170379', '747447']);
            expect(bundles.map((bundle) => bundle.dataType).sort()).toEqual(['foundation_food', 'sr_legacy_food']);
        });

        it('attaches each food ONLY its own nutrient + portion rows', async () => {
            writeCompleteDataset();

            const bundles = await collect(streamBulkFoodBundles({ dir }));
            const byId = new Map(bundles.map((bundle) => [bundle.fdcId, bundle] as const));

            expect(byId.get('170379')?.nutrients).toEqual([
                { nutrientId: '1003', amount: '2.82' },
                { nutrientId: '1008', amount: '34' },
            ]);
            expect(byId.get('170379')?.portions).toEqual([
                { measureUnitId: '1000', portionDescription: '', modifier: 'cup, chopped', gramWeight: '91' },
            ]);
            expect(byId.get('747447')?.nutrients).toHaveLength(1);
            expect(byId.get('747447')?.portions).toHaveLength(1);
        });

        it('parses the 13-column full-download food_nutrient.csv by header NAME, not position', async () => {
            writeCompleteDataset();
            write('food_nutrient.csv', [
                [
                    'id',
                    'fdc_id',
                    'nutrient_id',
                    'amount',
                    'data_points',
                    'derivation_id',
                    'min',
                    'max',
                    'median',
                    'loq',
                    'footnote',
                    'min_year_acquired',
                    'percent_daily_value',
                ],
                ['1', '170379', '1003', '2.82', '', '71', '', '', '', '', '', '', ''],
            ]);

            const bundles = await collect(streamBulkFoodBundles({ dir }));
            const broccoli = bundles.find((bundle) => bundle.fdcId === '170379');

            expect(broccoli?.nutrients).toEqual([{ nutrientId: '1003', amount: '2.82' }]);
        });

        it('parses a quoted field containing an embedded newline, comma, and escaped quote', async () => {
            writeCompleteDataset();
            write('food.csv', [
                [...FOOD_HEADER],
                ['170379', 'sr_legacy_food', 'Broccoli,\nraw, 2" florets', '11', '2019-04-01'],
            ]);

            const bundles = await collect(streamBulkFoodBundles({ dir }));

            expect(bundles).toHaveLength(1);
            expect(bundles[0]?.description).toBe('Broccoli,\nraw, 2" florets');
        });

        it('yields a bundle with empty nutrient/portion arrays when the optional files are absent', async () => {
            writeCompleteDataset();
            rmSync(join(dir, 'food_portion.csv'));
            rmSync(join(dir, 'measure_unit.csv'));

            const bundles = await collect(streamBulkFoodBundles({ dir }));

            expect(bundles.every((bundle: BulkFoodBundle) => bundle.portions.length === 0)).toBe(true);
            expect(bundles.some((bundle) => bundle.nutrients.length > 0)).toBe(true);
        });

        it('rejects a food.csv missing the data_type column (would otherwise seed Branded silently)', async () => {
            writeCompleteDataset();
            write('food.csv', [
                ['fdc_id', 'description', 'food_category_id', 'publication_date'],
                ['170379', 'Broccoli, raw', '11', '2019-04-01'],
            ]);

            await expect(collect(streamBulkFoodBundles({ dir }))).rejects.toSatisfy(isUsdaBulkFormatError);
        });

        it('rejects a missing REQUIRED food.csv with a typed format error naming the file', async () => {
            writeCompleteDataset();
            rmSync(join(dir, 'food.csv'));

            await expect(collect(streamBulkFoodBundles({ dir }))).rejects.toThrow(/food\.csv/);
        });

        it('skips orphan portion rows with a blank fdc_id (273 such rows exist in the full download)', async () => {
            writeCompleteDataset();
            write('food_portion.csv', [
                [...PORTION_HEADER],
                ['10', '', '1', '1', '', '', '', '10', '', '', ''],
                ['11', '170379', '1', '1', '1000', '', 'cup, chopped', '91', '', '', ''],
            ]);

            const bundles = await collect(streamBulkFoodBundles({ dir }));

            expect(bundles.find((bundle) => bundle.fdcId === '170379')?.portions).toHaveLength(1);
        });
    });

    describe('streamBulkCandidates', () => {
        it('composes reader + parser into canonical candidates ready for the merge/persist seam', async () => {
            writeCompleteDataset();

            const candidates = await collect(streamBulkCandidates({ dir }));
            const byKey = new Map(
                candidates.map((candidate: CanonicalCandidate) => [candidate.externalKey, candidate]),
            );

            expect([...byKey.keys()].sort()).toEqual(['170379', '747447']);
            expect(byKey.get('170379')?.name).toBe('Broccoli, raw');
            expect(byKey.get('170379')?.kind).toBe('generic');
            expect(byKey.get('170379')?.nutrients).toEqual([
                { code: null, name: 'Protein', unit: 'g', amount: '2.82', basis: 'per_100g' },
                { code: null, name: 'Energy', unit: 'kcal', amount: '34', basis: 'per_100g' },
            ]);
            expect(byKey.get('170379')?.portions).toEqual([{ label: 'cup, chopped', gramWeight: '91' }]);
            // 747447's only portion is labelled from `portion_description` (its measure unit is `undetermined`).
            expect(byKey.get('747447')?.portions).toEqual([{ label: '1 cup, diced', gramWeight: '132' }]);
            expect(byKey.get('747447')?.itemVersion?.startsWith('bulk:')).toBe(true);
        });

        it('drops a food whose description is blank rather than emitting a nameless candidate', async () => {
            writeCompleteDataset();
            write('food.csv', [
                [...FOOD_HEADER],
                ['170379', 'sr_legacy_food', '', '11', '2019-04-01'],
                ['747447', 'foundation_food', 'Cheese, cheddar', '1', '2019-12-16'],
            ]);

            const candidates = await collect(streamBulkCandidates({ dir }));

            expect(candidates.map((candidate) => candidate.externalKey)).toEqual(['747447']);
        });
    });
});
