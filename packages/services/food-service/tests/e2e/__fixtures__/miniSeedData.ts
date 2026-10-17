/**
 * A miniature committed seed: a complete data directory with every file the seed and the verifier read, pinned as the
 * real one is (curated catalog plan U6). Small enough that a test can write its whole catalog, and shaped so each rule
 * the verifier restates has a row that exercises it:
 *
 * - R48: SR items 100 and 105 share a description, and 100 supplies (105 states no energy); SR 107 and Foundation
 *   748278 share "Oil, canola", and the Foundation item supplies; 104 is an untouched baseline root.
 * - R51: 103 is excluded.
 * - Rule 28a: 106 is a declared alias of the variant item 102, and brings a second food group with it.
 * - KTD-27: Foundation 2646170 carries NDB 5062; 748278 states no NDB.
 * - KTD-28 and R9: portions in the three USDA shapes, a label clash the supplier wins, a label only an alias states, a
 *   zero amount and a zero weight that are dropped, and an `undetermined` unit.
 * - Every nutrition shape (R50, KTD-20, KTD-24, R54, OQ-2): a root's own item, a same-substance SR stand-in, a gram-served
 *   Branded product with a zero and a repeated nutrient, FNDDS, CIQUAL, a per-100 mL CoFID line with a density and a
 *   trace, a kJ-only line, a label with a printed zero, and a root with no numbers.
 *
 * @pattern Object Mother — one named, fully pinned seed directory
 */
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { renderBrandedExtract } from '../../../src/foods/seed/archive/brandedExtract.js';
import { fdcCsv, makeZip } from '../../../src/foods/seed/archive/__fixtures__/zipFixture.js';
import { renderSourceExtract } from '../../../src/foods/seed/archive/sourceExtract.js';
import {
    catalogText,
    changesText,
    makeBrandedProduct,
    makeExtractLine,
    makeItemRoot,
    makeLabel,
    makePart,
    makeSourceItemCitation,
    makeSourcelessRoot,
    makeVariant,
} from '../../../src/foods/seed/catalog/__fixtures__/curatedSeed.fixtures.js';
import type { CatalogChanges, CuratedRoot } from '../../../src/foods/seed/catalog/curatedSeedFormat.js';

/** The headers FDC publishes, which the verifier holds each file to. */
const FOOD = ['fdc_id', 'data_type', 'description', 'food_category_id', 'publication_date'];
const FOOD_NUTRIENT = [
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
];
const NUTRIENT = ['id', 'name', 'unit_name', 'nutrient_nbr', 'rank'];
const FOOD_PORTION = [
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
];

/** The nutrient dictionary both archives carry: 2066 is referenced and never defined, as FDC ships it. */
const NUTRIENTS = [
    NUTRIENT,
    ['1008', 'Energy', 'KCAL', '208', '300'],
    ['1062', 'Energy', 'kJ', '268', '400'],
    ['1003', 'Protein', 'G', '203', '600'],
    ['1004', 'Total lipid (fat)', 'G', '204', '800'],
    ['1093', 'Sodium, Na', 'MG', '307', '5800'],
    ['1114', 'Vitamin D  (D2 + D3)', 'UG', '328', '8700'],
];

const MEASURE_UNITS = [
    ['id', 'name'],
    ['1000', 'cup'],
    ['1001', 'tbsp'],
    ['9999', 'undetermined'],
];

const FOOD_CATEGORIES = [
    ['id', 'code', 'description'],
    ['2', '0200', 'Spices and Herbs'],
    ['4', '0400', 'Fats and Oils'],
    ['5', '0500', 'Poultry Products'],
    ['10', '1000', 'Pork Products'],
    ['13', '1300', 'Beef Products'],
    ['36', '3600', 'Restaurant Foods'],
];

/**
 * A `food_nutrient.csv` row.
 *
 * @param id - The row id.
 * @param fdcId - The food.
 * @param nutrientId - The nutrient.
 * @param amount - The amount, as written.
 * @returns The row, its unused fields blank.
 */
const nutrientRow = (id: number, fdcId: string, nutrientId: string, amount: string): string[] => [
    String(id),
    fdcId,
    nutrientId,
    amount,
    '',
    '',
    '',
    '',
    '',
    '',
    '',
];

/**
 * A `food_portion.csv` row.
 *
 * @param id - The row id.
 * @param fdcId - The food.
 * @param fields - Its amount, measure unit id, portion description, modifier and gram weight.
 * @returns The row, its unused fields blank.
 */
const portionRow = (id: number, fdcId: string, fields: readonly [string, string, string, string, string]): string[] => [
    String(id),
    fdcId,
    String(id),
    fields[0],
    fields[1],
    fields[2],
    fields[3],
    fields[4],
    '',
    '',
    '',
];

/** The SR Legacy archive. */
async function srZip(): Promise<Buffer> {
    const root = 'FoodData_Central_sr_legacy_food_csv_2018-04/';

    return makeZip({
        [root]: '',
        [`${root}food.csv`]: fdcCsv([
            FOOD,
            ['100', 'sr_legacy_food', 'Beef, brisket, whole, raw', '13', '2019-04-01'],
            ['105', 'sr_legacy_food', 'Beef, Brisket, WHOLE, raw', '13', '2019-04-01'],
            ['101', 'sr_legacy_food', 'Beef, brisket, flat half, raw', '13', '2019-04-01'],
            ['102', 'sr_legacy_food', 'Beef, brisket, point half, raw', '13', '2019-04-01'],
            ['106', 'sr_legacy_food', 'Pork, brisket-style point, raw', '10', '2019-04-01'],
            ['103', 'sr_legacy_food', 'Restaurant, family style, brisket', '36', '2019-04-01'],
            ['104', 'sr_legacy_food', 'Salt, table', '2', '2019-04-01'],
            ['107', 'sr_legacy_food', 'Oil, canola', '4', '2019-04-01'],
        ]),
        [`${root}nutrient.csv`]: fdcCsv(NUTRIENTS),
        [`${root}food_nutrient.csv`]: fdcCsv([
            FOOD_NUTRIENT,
            nutrientRow(1, '100', '1008', '155'),
            nutrientRow(2, '100', '1003', '20.5'),
            nutrientRow(3, '100', '1004', '7.0'),
            nutrientRow(4, '100', '2066', '1.5'),
            nutrientRow(5, '100', '1114', '0.1'),
            nutrientRow(6, '105', '1003', '19.1'),
            nutrientRow(7, '101', '1008', '140'),
            nutrientRow(8, '101', '1003', ''),
            nutrientRow(9, '102', '1008', '170'),
            nutrientRow(10, '102', '1004', '12'),
            nutrientRow(11, '106', '1008', '160'),
            nutrientRow(12, '103', '1008', '300'),
            nutrientRow(13, '104', '1008', '0'),
            nutrientRow(14, '104', '1093', '38758'),
            nutrientRow(15, '107', '1008', '884'),
        ]),
        [`${root}food_portion.csv`]: fdcCsv([
            FOOD_PORTION,
            portionRow(1, '100', ['3', '', '', 'oz', '85']),
            portionRow(2, '100', ['1', '', '', 'cup, diced', '140']),
            portionRow(3, '105', ['1', '', '', 'cup, diced', '150']),
            portionRow(4, '105', ['2', '', '', 'slice', '40']),
            portionRow(5, '101', ['0', '', '', 'oz', '28']),
            portionRow(6, '101', ['4', '', '', 'oz', '0']),
            portionRow(7, '102', ['1', '9999', '', 'piece', '200']),
            portionRow(8, '106', ['1', '', '', 'piece', '210']),
            portionRow(9, '104', ['1', '', '', 'tbsp', '18']),
        ]),
        [`${root}measure_unit.csv`]: fdcCsv(MEASURE_UNITS),
        [`${root}food_category.csv`]: fdcCsv(FOOD_CATEGORIES),
    });
}

/** The Foundation archive: two current items, a superseded row of the same type, and a sample row. */
async function foundationZip(): Promise<Buffer> {
    const root = 'FoodData_Central_foundation_food_csv_2026-04-30/';

    return makeZip({
        [`${root}food.csv`]: fdcCsv([
            FOOD,
            ['2646170', 'foundation_food', 'Chicken, breast, boneless, skinless, raw', '5', '2024-04-18'],
            ['748278', 'foundation_food', 'Oil, canola', '4', '2019-12-16'],
            ['334462', 'foundation_food', 'Chicken, breast, superseded', '5', '2019-04-01'],
            ['321829', 'sub_sample_food', 'Chicken, breast, sub sample\nsecond line', '5', '2019-04-01'],
        ]),
        [`${root}foundation_food.csv`]: fdcCsv([
            ['fdc_id', 'NDB_number', 'footnote'],
            ['2646170', '5062', ''],
            ['748278', '', ''],
        ]),
        [`${root}nutrient.csv`]: fdcCsv(NUTRIENTS),
        [`${root}food_nutrient.csv`]: fdcCsv([
            FOOD_NUTRIENT,
            nutrientRow(1, '2646170', '1008', '120'),
            nutrientRow(2, '2646170', '1003', '22.5'),
            nutrientRow(3, '748278', '1008', '900'),
            nutrientRow(4, '334462', '1008', '110'),
        ]),
        [`${root}food_portion.csv`]: fdcCsv([
            FOOD_PORTION,
            portionRow(1, '2646170', ['1.0', '1000', '', 'chopped', '140']),
            portionRow(2, '2646170', ['', '', '1 cup, shredded', '10205', '135']),
        ]),
        [`${root}measure_unit.csv`]: fdcCsv(MEASURE_UNITS),
        [`${root}food_category.csv`]: fdcCsv(FOOD_CATEGORIES),
    });
}

/** The curated roots: one per nutrition shape, plus a root with variants and a Foundation root. */
export const MINI_ROOTS: readonly CuratedRoot[] = [
    makeItemRoot({
        synonyms: ['brisket', 'whole brisket'],
        variants: [
            makeVariant({ item: 'fdc:101', parts: [makePart({ text: 'flat' }), makePart({ text: 'first cut' })] }),
            makeVariant({
                item: 'fdc:102',
                parts: [makePart({ text: 'point' }), makePart({ attribute: 'trim', text: '1/4-inch trim' })],
            }),
        ],
    }),
    makeItemRoot({
        seedKey: 'fdc:2646170',
        name: 'boneless skinless chicken breasts',
        synonyms: [],
        item: 'fdc:2646170',
        variants: [],
    }),
    makeSourcelessRoot(),
    makeSourcelessRoot({
        seedKey: 'curated:adobo-seasoning',
        name: 'adobo seasoning',
        nutrition: makeSourceItemCitation(),
    }),
    makeSourcelessRoot({
        seedKey: 'curated:sea-salt',
        name: 'sea salt',
        nutrition: makeSourceItemCitation({ key: 'fdc:104', match: 'sameSubstance' }),
    }),
    makeSourcelessRoot({
        seedKey: 'curated:sorbet',
        name: 'sorbet',
        nutrition: makeSourceItemCitation({ key: 'fdc:2709314', match: 'exact' }),
    }),
    makeSourcelessRoot({
        seedKey: 'curated:apple-nectar',
        name: 'apple nectar',
        nutrition: makeSourceItemCitation({ source: 'ciqual', key: '2076', match: 'close' }),
    }),
    makeSourcelessRoot({
        seedKey: 'curated:port-wine',
        name: 'port wine',
        nutrition: makeSourceItemCitation({ source: 'cofid', key: '17-234', match: 'sameSubstance' }),
    }),
    makeSourcelessRoot({
        seedKey: 'curated:miso',
        name: 'miso',
        nutrition: makeSourceItemCitation({ source: 'stfcj', key: '17044', match: 'close' }),
    }),
    makeSourcelessRoot({
        seedKey: 'curated:goya-sazon',
        name: 'sazon seasoning',
        nutrition: makeLabel({
            perServing: [
                { name: 'Sodium, na', unit: 'mg', amount: '190' },
                { name: 'Energy', unit: 'kcal', amount: '5' },
                { name: 'Protein', unit: 'g', amount: '0' },
            ],
        }),
    }),
];

/** The cumulative changes: both variants declared as merges, one alias, one exclusion. */
export const MINI_CHANGES: CatalogChanges = {
    merges: [
        { from: 'fdc:101', into: 'fdc:100' },
        { from: 'fdc:102', into: 'fdc:100' },
    ],
    aliases: [{ from: 'fdc:106', of: 'fdc:102' }],
    exclusions: ['fdc:103'],
    splits: [],
};

/** Every candidate of every sourceless root; each committed citation is the policy's choice (KTD-22). */
const CANDIDATES = [
    ['curated:adobo-seasoning', 'usdaBranded', 'fdc:2096555', 'exact'],
    ['curated:sea-salt', 'usdaSrFoundation', 'fdc:104', 'sameSubstance'],
    ['curated:sorbet', 'usdaFndds', 'fdc:2709314', 'exact'],
    ['curated:apple-nectar', 'ciqual', '2076', 'close'],
    ['curated:apple-nectar', 'cofid', '17-999', 'generic'],
    ['curated:port-wine', 'cofid', '17-234', 'sameSubstance'],
    ['curated:miso', 'stfcj', '17044', 'close'],
    ['curated:goya-sazon', 'label', 'https://example.com/products/adobo', 'exact'],
];

/**
 * A pinned extract's pins file.
 *
 * @param extract - The extract's file name.
 * @param bytes - Its bytes.
 * @returns The pins text.
 */
function tablePins(extract: string, bytes: Buffer): string {
    return JSON.stringify({
        upstreams: { table: { upstream: 'table.xlsx', upstreamSha256: 'd'.repeat(64) } },
        extract,
        extractSha256: createHash('sha256').update(bytes).digest('hex'),
    });
}

/** The SHA-256 of some bytes, hex. */
const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

/**
 * Write the miniature data directory.
 *
 * @param dir - An empty directory.
 * @param overrides - A replacement catalog or change file, for a case about the seed rather than the catalog.
 * @sideEffect Writes the files.
 */
export async function writeMiniSeedData(
    dir: string,
    overrides: { readonly roots?: readonly CuratedRoot[]; readonly changes?: CatalogChanges } = {},
): Promise<void> {
    const sr = await srZip();
    const foundation = await foundationZip();
    const branded = Buffer.from(
        renderBrandedExtract([
            makeBrandedProduct({
                nutrients: [
                    { amount: '23750', name: 'Sodium, Na', nutrientId: 1093, unitName: 'MG' },
                    { amount: '0.0', name: 'Protein', nutrientId: 1003, unitName: 'G' },
                    { amount: '125', name: 'Energy', nutrientId: 1008, unitName: 'KCAL' },
                    { amount: '99', name: 'Energy', nutrientId: 2047, unitName: 'KCAL' },
                    { amount: '5', name: '', nutrientId: 9999, unitName: '' },
                ],
            }),
        ]),
        'utf8',
    );
    const fndds = Buffer.from(
        renderSourceExtract([
            makeExtractLine({ key: 'fdc:2709314', name: 'Sorbet', values: { ENERC_KCAL: '135', CHOCDF: '34.5' } }),
        ]),
        'utf8',
    );
    const ciqual = Buffer.from(
        renderSourceExtract([makeExtractLine({ values: { ENERC_KCAL: '52', CHOAVL: '12.4' }, traces: ['FIBTG'] })]),
        'utf8',
    );
    const cofid = Buffer.from(
        renderSourceExtract([
            makeExtractLine({
                key: '17-234',
                name: 'Port',
                basis: 'per100mL',
                values: { ENERC_KCAL: '157', ENERC_KJ: '657', CHOAVLM: '12' },
                traces: ['FIBTG', 'PROCNT'],
                densityGramsPerMl: '1.03',
            }),
            makeExtractLine({ key: '17-999', name: 'Fruit juice', values: { ENERC_KCAL: '40' } }),
        ]),
        'utf8',
    );
    const stfcj = Buffer.from(
        renderSourceExtract([
            makeExtractLine({ key: '17044', name: 'Miso, rice', values: { ENERC_KJ: '761', PROCNT: '12.5' } }),
        ]),
        'utf8',
    );

    mkdirSync(join(dir, 'usda'), { recursive: true });
    writeFileSync(join(dir, 'usda', 'srLegacy.zip'), sr);
    writeFileSync(join(dir, 'usda', 'foundation.zip'), foundation);
    writeFileSync(join(dir, 'usda', 'brandedExtract.jsonl'), branded);
    writeFileSync(join(dir, 'usda', 'fnddsExtract.jsonl'), fndds);
    writeFileSync(
        join(dir, 'usda', 'sourcePins.json'),
        JSON.stringify(
            {
                srLegacy: { upstream: 'sr.zip', upstreamSha256: sha256(sr), file: 'srLegacy.zip' },
                foundation: { upstream: 'foundation.zip', upstreamSha256: sha256(foundation), file: 'foundation.zip' },
                brandedFoods: {
                    upstream: 'branded.zip',
                    upstreamSha256: 'a'.repeat(64),
                    extract: 'brandedExtract.jsonl',
                    extractSha256: sha256(branded),
                },
                fndds: {
                    upstreams: { survey: { upstream: 'survey.zip', upstreamSha256: 'b'.repeat(64) } },
                    extract: 'fnddsExtract.jsonl',
                    extractSha256: sha256(fndds),
                },
            },
            null,
            4,
        ),
    );

    for (const [source, extract, bytes] of [
        ['ciqual', 'ciqualExtract.jsonl', ciqual],
        ['cofid', 'cofidExtract.jsonl', cofid],
        ['stfcj', 'stfcjExtract.jsonl', stfcj],
    ] as const) {
        mkdirSync(join(dir, source));
        writeFileSync(join(dir, source, extract), bytes);
        writeFileSync(join(dir, source, 'sourcePins.json'), tablePins(extract, bytes));
    }

    writeFileSync(join(dir, 'curatedCatalog.jsonl'), catalogText(overrides.roots ?? MINI_ROOTS));
    writeFileSync(join(dir, 'catalogChanges.json'), changesText(overrides.changes ?? MINI_CHANGES));
    writeFileSync(
        join(dir, 'sourceCandidates.tsv'),
        `seedKey\tdataset\tkey\tmatch\n${CANDIDATES.map((row) => `${row.join('\t')}\n`).join('')}`,
    );
}
