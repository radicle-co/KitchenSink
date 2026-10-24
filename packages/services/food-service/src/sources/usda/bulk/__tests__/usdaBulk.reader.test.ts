/**
 * Unit suite for the USDA bulk-download CSV reader. The reader reads through a PORT (`CsvEntrySource`), so the
 * suite drives it with an in-memory adapter holding real FDC-shaped CSV text. The quirks pinned here were all
 * measured from the published FDC zips, and every one of them silently corrupts a naive line-splitting or
 * positional loader:
 *
 *   - every field is double-quoted, including integers and empty strings, and a quoted field can contain
 *     an embedded NEWLINE (Foundation `food.csv` has one) — so a real RFC4180 parser is mandatory;
 *   - `food_nutrient.csv` has 11 columns in the per-dataset zips and 13 in the full download, so columns
 *     MUST be resolved by header NAME, never by position;
 *   - the Foundation zip's `food.csv` is 87,990 rows of which only 469 are `foundation_food` (the rest are
 *     the `sub_sample_food` / `market_acquisition` / `sample_food` provenance chain) — the `data_type`
 *     filter is what keeps a reader from yielding 187× the intended rows, and Branded is NEVER yielded;
 *   - `food_portion.csv` / `measure_unit.csv` are OPTIONAL (a dataset without them still reads).
 *
 * No network: the seeder never calls the live USDA API, so neither do its tests.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { makeMemoryCsvSource } from '../__fixtures__/usdaBulk.fixtures.js';

import { isUsdaBulkFormatError } from '../usdaBulk.errors.js';
import { mapBulkFoodToCanonical } from '../usdaBulk.parser.js';
import { loadBulkLookups, readFdcCsv, readFoundationMembers, streamBulkFoodBundles } from '../usdaBulk.reader.js';
import type { BulkFoodBundle } from '../usdaBulk.types.js';

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
    let files: Record<string, string>;

    beforeEach(() => {
        files = {};
    });

    /** Put a CSV file into the in-memory bulk source. */
    function write(file: string, rows: readonly (readonly string[])[]): void {
        files[file] = csv(rows);
    }

    /** Remove a file from the in-memory bulk source. */
    function remove(file: string): void {
        delete files[file];
    }

    /** The in-memory port adapter over the files written so far. */
    const source = (): ReturnType<typeof makeMemoryCsvSource> => makeMemoryCsvSource(files);

    /** Write a minimal-but-complete bulk dataset (2 seedable foods + 1 excluded Branded row). */
    function writeCompleteDataset(): void {
        write('food.csv', [
            [...FOOD_HEADER],
            ['170379', 'sr_legacy_food', 'Broccoli, raw', '11', '2019-04-01'],
            ['747447', 'foundation_food', 'Cheese, cheddar', '1', '2019-12-16'],
            ['2057648', 'branded_food', 'GREEK YOGURT', 'Yogurt', '2021-07-29'],
            ['321829', 'sub_sample_food', 'Broccoli, steamed, sub sample', '11', '6/2/2023'],
            // Survey (FNDDS) — the ONLY USDA data type carrying curated "additional descriptions" (U2),
            // and deliberately NOT in the default selection. Present here so both halves are proved: it
            // is excluded by default, and it is reachable by CONFIGURATION rather than by a code change.
            ['2705709', 'survey_fndds_food', 'Cheese, cheddar', '1', '2024-10-31'],
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
            ['10', '170379', '1', '2', '1000', '', 'chopped', '182', '', '', ''],
            ['11', '747447', '1', '1', '9999', '1 cup, diced', '', '132', '', '', ''],
        ]);
        write('measure_unit.csv', [[...MEASURE_UNIT_HEADER], ['1000', 'cup'], ['9999', 'undetermined']]);
        write('food_category.csv', [
            ['id', 'code', 'description'],
            ['1', '0100', 'Dairy and Egg Products'],
            ['11', '1100', 'Vegetables and Vegetable Products'],
        ]);
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

            const lookups = await loadBulkLookups(source());

            expect(lookups.nutrientsById.get('1003')).toEqual({ name: 'Protein', unitName: 'G' });
            expect(lookups.nutrientsById.get('1114')).toEqual({
                name: 'Vitamin D (D2 + D3)',
                unitName: 'UG',
            });
            expect(lookups.measureUnitsById.get('1000')).toBe('cup');
            expect(lookups.measureUnitsById.size).toBe(2);
        });

        // The owner ruled on 2026-10-01 that the seed assigns USDA's own food groups (curated plan).
        it('loads the food groups from food_category.csv by id', async () => {
            writeCompleteDataset();

            const lookups = await loadBulkLookups(source());

            expect(lookups.foodCategoriesById).toEqual(
                new Map([
                    ['1', 'Dairy and Egg Products'],
                    ['11', 'Vegetables and Vegetable Products'],
                ]),
            );
        });

        it('treats food_category.csv as OPTIONAL, as a dataset with no groups still loads', async () => {
            writeCompleteDataset();
            remove('food_category.csv');

            expect((await loadBulkLookups(source())).foodCategoriesById.size).toBe(0);
        });

        it('treats measure_unit.csv as OPTIONAL (a dataset without portions still loads)', async () => {
            writeCompleteDataset();
            remove('measure_unit.csv');

            const lookups = await loadBulkLookups(source());

            expect(lookups.measureUnitsById.size).toBe(0);
            expect(lookups.nutrientsById.size).toBe(3);
        });

        it('rejects a missing REQUIRED nutrient.csv with a typed format error', async () => {
            writeCompleteDataset();
            remove('nutrient.csv');

            await expect(loadBulkLookups(source())).rejects.toSatisfy(isUsdaBulkFormatError);
        });

        it('rejects nutrient.csv missing the unit_name column (schema drift, not a silent null unit)', async () => {
            writeCompleteDataset();
            write('nutrient.csv', [
                ['id', 'name', 'nutrient_nbr', 'rank'],
                ['1003', 'Protein', '203', '600'],
            ]);

            await expect(loadBulkLookups(source())).rejects.toSatisfy(isUsdaBulkFormatError);
        });
    });

    describe('streamBulkFoodBundles', () => {
        it('yields ONLY foundation_food + sr_legacy_food rows (Branded, the sample chain and FNDDS excluded)', async () => {
            writeCompleteDataset();

            const bundles = await collect(streamBulkFoodBundles({ source: source() }));

            expect(bundles.map((bundle) => bundle.fdcId).sort()).toEqual(['170379', '747447']);
            expect(bundles.map((bundle) => bundle.dataType).sort()).toEqual(['foundation_food', 'sr_legacy_food']);
        });

        it('carries each food’s food group id from food.csv', async () => {
            writeCompleteDataset();

            const bundles = await collect(streamBulkFoodBundles({ source: source() }));

            expect(bundles.map((bundle) => [bundle.fdcId, bundle.foodCategoryId]).sort()).toEqual([
                ['170379', '11'],
                ['747447', '1'],
            ]);
        });

        it('selects the data types the CALLER asks for, so the roster is configuration and not a rewrite', async () => {
            writeCompleteDataset();

            const bundles = await collect(
                streamBulkFoodBundles({ source: source(), dataTypes: ['survey_fndds_food'] }),
            );

            expect(bundles.map((bundle) => bundle.fdcId)).toEqual(['2705709']);
            expect(bundles.map((bundle) => bundle.dataType)).toEqual(['survey_fndds_food']);
        });

        it('never widens past the requested set — an explicit selection excludes the defaults too', async () => {
            writeCompleteDataset();

            const bundles = await collect(streamBulkFoodBundles({ source: source(), dataTypes: ['foundation_food'] }));

            expect(bundles.map((bundle) => bundle.fdcId)).toEqual(['747447']);
        });

        it('⚠️ a Survey row read this way still lands with NO aliases — the bulk reader does not read food_attribute.csv', async () => {
            writeCompleteDataset();

            const lookups = await loadBulkLookups(source());
            const bundles = await collect(
                streamBulkFoodBundles({ source: source(), dataTypes: ['survey_fndds_food'] }),
            );

            expect(bundles.map((bundle) => mapBulkFoodToCanonical(bundle, lookups)?.aliases)).toEqual([[]]);
        });

        it('attaches each food ONLY its own nutrient + portion rows', async () => {
            writeCompleteDataset();

            const bundles = await collect(streamBulkFoodBundles({ source: source() }));
            const byId = new Map(bundles.map((bundle) => [bundle.fdcId, bundle] as const));

            expect(byId.get('170379')?.nutrients).toEqual([
                { nutrientId: '1003', amount: '2.82' },
                { nutrientId: '1008', amount: '34' },
            ]);
            expect(byId.get('170379')?.portions).toEqual([
                { amount: '2', measureUnitId: '1000', portionDescription: '', modifier: 'chopped', gramWeight: '182' },
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

            const bundles = await collect(streamBulkFoodBundles({ source: source() }));
            const broccoli = bundles.find((bundle) => bundle.fdcId === '170379');

            expect(broccoli?.nutrients).toEqual([{ nutrientId: '1003', amount: '2.82' }]);
        });

        it('parses a quoted field containing an embedded newline, comma, and escaped quote', async () => {
            writeCompleteDataset();
            write('food.csv', [
                [...FOOD_HEADER],
                ['170379', 'sr_legacy_food', 'Broccoli,\nraw, 2" florets', '11', '2019-04-01'],
            ]);

            const bundles = await collect(streamBulkFoodBundles({ source: source() }));

            expect(bundles).toHaveLength(1);
            expect(bundles[0]?.description).toBe('Broccoli,\nraw, 2" florets');
        });

        it('yields a bundle with empty nutrient/portion arrays when the optional files are absent', async () => {
            writeCompleteDataset();
            remove('food_portion.csv');
            remove('measure_unit.csv');

            const bundles = await collect(streamBulkFoodBundles({ source: source() }));

            expect(bundles.every((bundle: BulkFoodBundle) => bundle.portions.length === 0)).toBe(true);
            expect(bundles.some((bundle) => bundle.nutrients.length > 0)).toBe(true);
        });

        it('rejects a food.csv missing the data_type column (would otherwise seed Branded silently)', async () => {
            writeCompleteDataset();
            write('food.csv', [
                ['fdc_id', 'description', 'food_category_id', 'publication_date'],
                ['170379', 'Broccoli, raw', '11', '2019-04-01'],
            ]);

            await expect(collect(streamBulkFoodBundles({ source: source() }))).rejects.toSatisfy(isUsdaBulkFormatError);
        });

        it('rejects a missing REQUIRED food.csv with a typed format error naming the file', async () => {
            writeCompleteDataset();
            remove('food.csv');

            await expect(collect(streamBulkFoodBundles({ source: source() }))).rejects.toThrow(/food\.csv/);
        });

        it('skips orphan portion rows with a blank fdc_id (273 such rows exist in the full download)', async () => {
            writeCompleteDataset();
            write('food_portion.csv', [
                [...PORTION_HEADER],
                ['10', '', '1', '1', '', '', '', '10', '', '', ''],
                ['11', '170379', '1', '1', '1000', '', 'cup, chopped', '91', '', '', ''],
            ]);

            const bundles = await collect(streamBulkFoodBundles({ source: source() }));

            expect(bundles.find((bundle) => bundle.fdcId === '170379')?.portions).toHaveLength(1);
        });
    });

    describe('readFoundationMembers', () => {
        // Rewritten for curated plan R19: the members now carry their NDB numbers, which link a food across releases.
        it('reads the current Foundation items, each with its NDB number, from foundation_food.csv', async () => {
            write('foundation_food.csv', [
                ['fdc_id', 'NDB_number', 'footnote'],
                ['747447', '11090', ''],
                ['2646170', '', ''],
            ]);

            await expect(readFoundationMembers(source())).resolves.toEqual(
                new Map([
                    ['747447', '11090'],
                    ['2646170', null],
                ]),
            );
        });

        it('refuses a foundation_food.csv with no NDB_number column', async () => {
            write('foundation_food.csv', [
                ['fdc_id', 'footnote'],
                ['747447', ''],
            ]);

            await expect(readFoundationMembers(source())).rejects.toSatisfy(isUsdaBulkFormatError);
        });

        it.each(['011090', '11090a', '0'])('refuses the NDB number %j', async (ndbNumber) => {
            write('foundation_food.csv', [
                ['fdc_id', 'NDB_number', 'footnote'],
                ['747447', ndbNumber, ''],
            ]);

            await expect(readFoundationMembers(source())).rejects.toSatisfy(isUsdaBulkFormatError);
        });

        it('refuses an archive with no foundation_food.csv, rather than treating every row as current', async () => {
            await expect(readFoundationMembers(source())).rejects.toSatisfy(isUsdaBulkFormatError);
        });

        it('refuses a foundation_food.csv with no fdc_id column', async () => {
            write('foundation_food.csv', [['NDB_number'], ['1009']]);

            await expect(readFoundationMembers(source())).rejects.toSatisfy(isUsdaBulkFormatError);
        });
    });

    describe('readFdcCsv', () => {
        it('yields every field exactly as written, untrimmed, keyed by header name', async () => {
            write('branded_food.csv', [
                ['fdc_id', 'brand_owner'],
                ['1', '  Padded Owner '],
            ]);

            const records: Record<string, string>[] = [];

            for await (const record of readFdcCsv(source(), { name: 'branded_food.csv', columns: ['fdc_id'] }, true)) {
                records.push(record);
            }

            expect(records).toEqual([{ fdc_id: '1', brand_owner: '  Padded Owner ' }]);
        });

        it('yields nothing for an absent OPTIONAL file, and refuses an absent REQUIRED one', async () => {
            const optional: Record<string, string>[] = [];

            for await (const record of readFdcCsv(source(), { name: 'x.csv', columns: [] }, false)) {
                optional.push(record);
            }

            expect(optional).toEqual([]);
            await expect(
                (async (): Promise<void> => {
                    for await (const _record of readFdcCsv(source(), { name: 'x.csv', columns: [] }, true)) {
                        // drain
                    }
                })(),
            ).rejects.toThrow(/x\.csv/);
        });
    });
});
