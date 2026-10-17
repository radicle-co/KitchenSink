/**
 * The Branded extract's parser and canonical serializer (plan U1, KTD-20).
 *
 * The committed extract was written by CPython's `json.dumps(product, ensure_ascii=False, sort_keys=True)`,
 * one product per line, and `sourcePins.json` pins its SHA-256. So the serializer here must reproduce that
 * rendering byte for byte, or the hand-run rebuild could never prove the extract. The expected lines below
 * are written out by hand in CPython's form (checked against `python3 -c 'import json; …'` once), rather
 * than derived from the renderer under test.
 */
import { Buffer } from 'node:buffer';

import { describe, expect, it } from 'vitest';

import { fdcCsv, makeZip } from '../__fixtures__/zipFixture.js';
import { isBrandedExtractFormatError } from '../brandedExtract.errors.js';
import {
    type BrandedProduct,
    extractBrandedProducts,
    parseBrandedExtract,
    renderBrandedExtract,
} from '../brandedExtract.js';
import { zipEntrySource } from '../usdaSourceArchive.js';

const ROOT = 'FoodData_Central_branded_food_csv_2026-04-30/';

const BRANDED_FOOD_HEADER = [
    'fdc_id',
    'brand_owner',
    'brand_name',
    'subbrand_name',
    'gtin_upc',
    'ingredients',
    'not_a_significant_source_of',
    'serving_size',
    'serving_size_unit',
    'household_serving_fulltext',
    'branded_food_category',
    'data_source',
    'package_weight',
    'modified_date',
    'available_date',
    'market_country',
    'discontinued_date',
    'preparation_state_code',
    'trade_channel',
    'short_description',
    'material_code',
];

/** One `branded_food.csv` row in the upstream column order. */
function brandedFoodRow(fdcId: string, owner: string, unit: string): string[] {
    return [
        fdcId,
        owner,
        '',
        '',
        '0001',
        'SALT.',
        '',
        '28',
        unit,
        '1 ONZ',
        'Cheese',
        'LI',
        '',
        '2017-08-31',
        '2019-04-01',
        'United States',
        '',
        '',
        '',
        '',
        '',
    ];
}

/** A miniature Branded download: two cited products, one uncited, nutrients out of id order. */
async function brandedZip(): Promise<Buffer> {
    return makeZip({
        [ROOT]: '',
        [`${ROOT}nutrient.csv`]: fdcCsv([
            ['id', 'name', 'unit_name', 'nutrient_nbr', 'rank'],
            ['1003', 'Protein', 'G', '203', '600'],
            ['1008', 'Energy', 'KCAL', '208', '300'],
        ]),
        [`${ROOT}food.csv`]: fdcCsv([
            ['fdc_id', 'data_type', 'description', 'food_category_id', 'publication_date'],
            ['356753', 'branded_food', 'RICOTTA "SALATA" \\ CHEESE', '', '2019-04-01'],
            ['356754', 'branded_food', 'NOT CITED', '', '2019-04-01'],
            ['2003586', 'branded_food', 'TIPO 00 FLOUR, é', '', '2021-10-28'],
        ]),
        [`${ROOT}branded_food.csv`]: fdcCsv([
            BRANDED_FOOD_HEADER,
            brandedFoodRow('356753', "MARIANO'S", 'g'),
            brandedFoodRow('356754', 'X', 'g'),
            brandedFoodRow('2003586', 'CAPUTO', 'GRM'),
        ]),
        [`${ROOT}food_nutrient.csv`]: fdcCsv([
            ['id', 'fdc_id', 'nutrient_id', 'amount', 'data_points', 'derivation_id', 'min', 'max', 'median'],
            ['1', '2003586', '1008', '357.0', '', '', '', '', ''],
            ['2', '356753', '1008', '286.0', '', '', '', '', ''],
            ['3', '356753', '1003', '14.29', '', '', '', '', ''],
            ['4', '356754', '1003', '1.0', '', '', '', '', ''],
            // A nutrient id absent from nutrient.csv keeps its row, with an empty name and unit.
            ['5', '2003586', '9999', '0.5', '', '', '', '', ''],
            ['6', '2003586', '1003', '12.0', '', '', '', '', ''],
        ]),
    });
}

/** The extract CPython writes for the fixture above, byte for byte. */
const EXPECTED_EXTRACT =
    '{"available_date": "2019-04-01", "brand_name": "", "brand_owner": "MARIANO\'S", "branded_food_category": "Cheese", ' +
    '"description": "RICOTTA \\"SALATA\\" \\\\ CHEESE", "fdcId": 356753, "gtin_upc": "0001", ' +
    '"household_serving_fulltext": "1 ONZ", "market_country": "United States", "modified_date": "2017-08-31", ' +
    '"nutrients": [{"amount": "14.29", "name": "Protein", "nutrientId": 1003, "unitName": "G"}, ' +
    '{"amount": "286.0", "name": "Energy", "nutrientId": 1008, "unitName": "KCAL"}], ' +
    '"publicationDate": "2019-04-01", "serving_size": "28", "serving_size_unit": "g"}\n' +
    '{"available_date": "2019-04-01", "brand_name": "", "brand_owner": "CAPUTO", "branded_food_category": "Cheese", ' +
    '"description": "TIPO 00 FLOUR, é", "fdcId": 2003586, "gtin_upc": "0001", ' +
    '"household_serving_fulltext": "1 ONZ", "market_country": "United States", "modified_date": "2017-08-31", ' +
    '"nutrients": [{"amount": "12.0", "name": "Protein", "nutrientId": 1003, "unitName": "G"}, ' +
    '{"amount": "357.0", "name": "Energy", "nutrientId": 1008, "unitName": "KCAL"}, ' +
    '{"amount": "0.5", "name": "", "nutrientId": 9999, "unitName": ""}], ' +
    '"publicationDate": "2021-10-28", "serving_size": "28", "serving_size_unit": "GRM"}\n';

/** A valid product, for render/parse cases that need no archive. */
function makeBrandedProduct(overrides: Partial<BrandedProduct> = {}): BrandedProduct {
    return {
        available_date: '2019-04-01',
        brand_name: '',
        brand_owner: 'OWNER',
        branded_food_category: 'Cheese',
        description: 'A PRODUCT',
        fdcId: 1,
        gtin_upc: '0001',
        household_serving_fulltext: '1 ONZ',
        market_country: 'United States',
        modified_date: '2017-08-31',
        nutrients: [{ amount: '1.0', name: 'Protein', nutrientId: 1003, unitName: 'G' }],
        publicationDate: '2019-04-01',
        serving_size: '28',
        serving_size_unit: 'g',
        ...overrides,
    };
}

describe('extractBrandedProducts + renderBrandedExtract', () => {
    it('rebuilds a fixture download into the extract CPython wrote, byte for byte', async () => {
        const source = await zipEntrySource(await brandedZip());

        try {
            const products = await extractBrandedProducts(source, new Set([2003586, 356753]));

            expect(renderBrandedExtract(products)).toBe(EXPECTED_EXTRACT);
        } finally {
            source.close();
        }
    });

    it('extracts only the cited products, and omits a cited id the download does not hold', async () => {
        const source = await zipEntrySource(await brandedZip());

        try {
            const products = await extractBrandedProducts(source, new Set([356753, 4242]));

            expect(products.map((product) => product.fdcId)).toEqual([356753]);
        } finally {
            source.close();
        }
    });

    it('refuses a cited product that has no branded_food.csv row, since its fields would be absent', async () => {
        const source = await zipEntrySource(
            await makeZip({
                [`${ROOT}nutrient.csv`]: fdcCsv([['id', 'name', 'unit_name']]),
                [`${ROOT}food.csv`]: fdcCsv([
                    ['fdc_id', 'data_type', 'description', 'publication_date'],
                    ['1', 'branded_food', 'X', '2019-04-01'],
                ]),
                [`${ROOT}branded_food.csv`]: fdcCsv([BRANDED_FOOD_HEADER]),
                [`${ROOT}food_nutrient.csv`]: fdcCsv([['fdc_id', 'nutrient_id', 'amount']]),
            }),
        );

        try {
            await expect(extractBrandedProducts(source, new Set([1]))).rejects.toSatisfy(isBrandedExtractFormatError);
        } finally {
            source.close();
        }
    });
});

describe('renderBrandedExtract', () => {
    it("escapes exactly as CPython's json.dumps(ensure_ascii=False) does", () => {
        const text = renderBrandedExtract([makeBrandedProduct({ description: 'a "q" \\ \t \u0001 é \u2028 end' })]);

        expect(text).toContain('"description": "a \\"q\\" \\\\ \\t \\u0001 é \u2028 end"');
    });

    it('sorts products by fdcId numerically, so fdc 9 precedes fdc 10', () => {
        const text = renderBrandedExtract([makeBrandedProduct({ fdcId: 10 }), makeBrandedProduct({ fdcId: 9 })]);

        expect(text.split('\n').map((line) => /"fdcId": (\d+)/.exec(line)?.[1])).toEqual(['9', '10', undefined]);
    });

    it('sorts nutrients by nutrientId, keeping file order among equal ids', () => {
        const text = renderBrandedExtract([
            makeBrandedProduct({
                nutrients: [
                    { amount: '2', name: 'B', nutrientId: 1008, unitName: 'KCAL' },
                    { amount: '1', name: 'A', nutrientId: 1003, unitName: 'G' },
                    { amount: '3', name: 'C', nutrientId: 1008, unitName: 'KJ' },
                ],
            }),
        ]);

        expect([...text.matchAll(/"name": "(\w)"/g)].map((match) => match[1])).toEqual(['A', 'B', 'C']);
    });

    it('renders an empty extract as an empty file', () => {
        expect(renderBrandedExtract([])).toBe('');
    });
});

describe('parseBrandedExtract', () => {
    it('round-trips: parse(render(x)) keys every product by its item key', () => {
        const products = [makeBrandedProduct({ fdcId: 7 }), makeBrandedProduct({ fdcId: 12 })];
        const parsed = parseBrandedExtract(Buffer.from(renderBrandedExtract(products), 'utf8'));

        expect([...parsed.keys()]).toEqual(['fdc:7', 'fdc:12']);
        expect(parsed.get('fdc:12')).toEqual(products[1]);
    });

    it('parses the fixture extract and renders it back unchanged', () => {
        const parsed = parseBrandedExtract(Buffer.from(EXPECTED_EXTRACT, 'utf8'));

        expect(renderBrandedExtract(parsed.values())).toBe(EXPECTED_EXTRACT);
    });

    const line = renderBrandedExtract([makeBrandedProduct()]);

    it.each([
        ['compact separators (not the canonical rendering)', line.replace(/": /g, '":')],
        [
            'keys out of order',
            line
                .replace('{"available_date": "2019-04-01", ', '{')
                .replace('}\n', ', "available_date": "2019-04-01"}\n'),
        ],
        ['a missing trailing newline', line.slice(0, -1)],
        ['a blank line', `${line}\n`],
        ['an unknown key', line.replace('{"available_date"', '{"extra": "x", "available_date"')],
        ['a missing field', line.replace('"brand_name": "", ', '')],
        ['a float fdcId', line.replace('"fdcId": 1,', '"fdcId": 1.0,')],
        ['a byte-order mark', `\uFEFF${line}`],
        ['a line that is not JSON', '{\n'],
    ])('refuses %s', (_label, text) => {
        expect(() => parseBrandedExtract(Buffer.from(text, 'utf8'))).toThrow(
            expect.objectContaining({ name: 'BrandedExtractFormatError' }),
        );
    });

    it('refuses two products out of fdcId order, and a repeated fdcId', () => {
        const nine = renderBrandedExtract([makeBrandedProduct({ fdcId: 9 })]);
        const ten = renderBrandedExtract([makeBrandedProduct({ fdcId: 10 })]);

        expect(() => parseBrandedExtract(Buffer.from(ten + nine, 'utf8'))).toThrow(/line 2/);
        expect(() => parseBrandedExtract(Buffer.from(nine + nine, 'utf8'))).toThrow(/line 2/);
    });

    it('refuses bytes that are not UTF-8', () => {
        expect(() => parseBrandedExtract(Buffer.from([0xff, 0x0a]))).toThrow(
            expect.objectContaining({ name: 'BrandedExtractFormatError' }),
        );
    });
});
