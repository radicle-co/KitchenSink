/**
 * The USDA baseline (plan U1, R48, R51): one root per normalized description, supplied by the elected item.
 *
 * The descriptions and ids below are the real SR Legacy and Foundation rows the plan names, so the cases pin
 * the owner's rulings on the data they were made about.
 */
import { describe, expect, it } from 'vitest';

import {
    makeBulkFoodBundle,
    makeBulkLookups,
    makeBulkNutrientRow,
    makeBulkPortionRow,
} from '../../../../sources/usda/bulk/__fixtures__/usdaBulk.fixtures.js';
import { makeUsdaItemFacts } from '../__fixtures__/curatedSeed.fixtures.js';
import { buildBaselineSeed, electSupplier, normalizeUsdaDescription, usdaItemFactsOf } from '../baselineSeed.js';
import { isSeedRefusedError, type SeedIssue } from '../curatedSeedFormat.errors.js';

/**
 * Run a build that must be refused, and return its issues.
 *
 * @param build - The build.
 * @returns Every issue it reported.
 */
function issuesOf(build: () => unknown): readonly SeedIssue[] {
    try {
        build();
    } catch (error) {
        if (isSeedRefusedError(error)) {
            return error.issues;
        }

        throw error;
    }

    throw new Error('Expected a refusal.');
}

describe('normalizeUsdaDescription (R48)', () => {
    it('lowercases, drops punctuation and spaces inside each segment, and sorts the segments', () => {
        expect(normalizeUsdaDescription('Oil, canola')).toBe('canola,oil');
        expect(normalizeUsdaDescription('Peanut butter, Creamy')).toBe(
            normalizeUsdaDescription('Peanut butter, creamy'),
        );
        expect(normalizeUsdaDescription('Flour, wheat, all-purpose')).toBe('allpurpose,flour,wheat');
    });

    it('never sorts the words inside a segment, so 169423 and 170587 stay two roots', () => {
        const withoutPeanuts = normalizeUsdaDescription(
            'Nuts, mixed nuts, oil roasted, without peanuts, with salt added',
        );
        const withPeanuts = normalizeUsdaDescription('Nuts, mixed nuts, oil roasted, with peanuts, without salt added');

        expect(withoutPeanuts).not.toBe(withPeanuts);
    });

    it('drops an empty segment, so a doubled comma does not make a second name', () => {
        expect(normalizeUsdaDescription('Oil,, canola')).toBe(normalizeUsdaDescription('Oil, canola'));
        expect(normalizeUsdaDescription(' , ')).toBe('');
    });

    it('drops a non-ASCII character rather than transliterating it', () => {
        expect(normalizeUsdaDescription('Jalapeño')).toBe('jalapeo');
    });
});

describe('electSupplier (R48)', () => {
    it('an item with energy beats a Foundation item without it: "Oil, canola" keys fdc:172336', () => {
        const sr = makeUsdaItemFacts({ key: 'fdc:172336', description: 'Oil, canola', hasEnergy: true });
        const foundation = makeUsdaItemFacts({
            key: 'fdc:748278',
            description: 'Oil, canola',
            isFoundation: true,
            hasEnergy: false,
            publicationDate: '2019-12-16',
        });

        expect(electSupplier([foundation, sr]).key).toBe('fdc:172336');
    });

    it('when both carry energy, the Foundation item supplies the numbers', () => {
        const sr = makeUsdaItemFacts({ key: 'fdc:171140', publicationDate: '2019-04-01' });
        const foundation = makeUsdaItemFacts({ key: 'fdc:331960', isFoundation: true, publicationDate: '2019-04-01' });

        expect(electSupplier([sr, foundation]).key).toBe('fdc:331960');
    });

    it('two Foundation items resolve by the latest publication date (peanut butter)', () => {
        const older = makeUsdaItemFacts({ key: 'fdc:2262072', isFoundation: true, publicationDate: '2022-04-28' });
        const newer = makeUsdaItemFacts({ key: 'fdc:2758989', isFoundation: true, publicationDate: '2026-04-30' });

        expect(electSupplier([newer, older]).key).toBe('fdc:2758989');
        expect(electSupplier([older, newer]).key).toBe('fdc:2758989');
    });

    it('two SR items with one date resolve by the highest FDC id, compared as numbers', () => {
        const nine = makeUsdaItemFacts({ key: 'fdc:900' });
        const ten = makeUsdaItemFacts({ key: 'fdc:1000' });

        expect(electSupplier([ten, nine]).key).toBe('fdc:1000');
        expect(electSupplier([nine, ten]).key).toBe('fdc:1000');
    });

    it('two SR items resolve by date before id', () => {
        const newerLowId = makeUsdaItemFacts({ key: 'fdc:5', publicationDate: '2020-01-01' });
        const olderHighId = makeUsdaItemFacts({ key: 'fdc:9', publicationDate: '2019-04-01' });

        expect(electSupplier([olderHighId, newerLowId]).key).toBe('fdc:5');
    });

    it('refuses to elect from an empty group', () => {
        expect(() => electSupplier([])).toThrow(RangeError);
    });
});

describe('buildBaselineSeed', () => {
    const canolaSr = makeUsdaItemFacts({ key: 'fdc:172336', description: 'Oil, canola' });
    const canolaFoundation = makeUsdaItemFacts({
        key: 'fdc:748278',
        description: 'Oil, canola',
        isFoundation: true,
        hasEnergy: false,
    });
    const broccoli = makeUsdaItemFacts({ key: 'fdc:170379', description: 'Broccoli, raw' });

    it('makes one root per distinct description, named by the supplier’s description, with no variants', () => {
        const baseline = buildBaselineSeed([canolaSr, canolaFoundation, broccoli], new Set());

        expect([...baseline.groups.keys()].sort()).toEqual(['fdc:170379', 'fdc:172336']);
        expect(baseline.groups.get('fdc:172336')?.name).toBe('Oil, canola');
        expect(baseline.groups.get('fdc:172336')?.members.map((member) => member.key)).toEqual([
            'fdc:172336',
            'fdc:748278',
        ]);
        expect(baseline.supplierOf.get('fdc:748278')).toBe('fdc:172336');
        expect(baseline.supplierOf.get('fdc:170379')).toBe('fdc:170379');
    });

    it('keeps a baseline name’s straight double quote, which only curated names may not carry', () => {
        const pipe = makeUsdaItemFacts({ key: 'fdc:5', description: 'Pasta, 2" tubes' });

        expect(buildBaselineSeed([pipe], new Set()).groups.get('fdc:5')?.name).toBe('Pasta, 2" tubes');
    });

    it('drops exclusions BEFORE grouping, so an excluded item never supplies a group (R51)', () => {
        const baseline = buildBaselineSeed([canolaSr, canolaFoundation, broccoli], new Set(['fdc:172336'] as const));

        expect(baseline.supplierOf.has('fdc:172336')).toBe(false);
        expect(baseline.supplierOf.get('fdc:748278')).toBe('fdc:748278');
        expect([...baseline.groups.keys()].sort()).toEqual(['fdc:170379', 'fdc:748278']);
    });

    it('holds every item of the universe, excluded ones included, so the image can tell them apart', () => {
        const baseline = buildBaselineSeed([canolaSr, broccoli], new Set(['fdc:170379'] as const));

        expect([...baseline.universe.keys()].sort()).toEqual(['fdc:170379', 'fdc:172336']);
    });

    it('refuses a publication date that is not an ISO calendar date, naming the item', () => {
        const usDate = makeUsdaItemFacts({ key: 'fdc:7', publicationDate: '4/1/2019' });

        expect(issuesOf(() => buildBaselineSeed([usDate, broccoli], new Set()))).toEqual([
            expect.objectContaining({ rule: 'publicationDateNotIso', where: 'fdc:7' }),
        ]);
    });

    it('refuses a blank description, and an item listed twice', () => {
        const blank = makeUsdaItemFacts({ key: 'fdc:8', description: '  ' });

        expect(issuesOf(() => buildBaselineSeed([blank, broccoli, broccoli], new Set()))).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ rule: 'descriptionBlank', where: 'fdc:8' }),
                expect.objectContaining({ rule: 'usdaItemRepeated', where: 'fdc:170379' }),
            ]),
        );
    });
});

describe('usdaItemFactsOf', () => {
    it('reads energy from nutrient 1008, 2048 or 2047, and nothing else', () => {
        const lookups = makeBulkLookups();
        const facts = (nutrientId: string, amount = '100'): boolean =>
            usdaItemFactsOf(
                makeBulkFoodBundle({ nutrients: [makeBulkNutrientRow({ nutrientId, amount })] }),
                lookups,
                null,
            ).hasEnergy;

        expect(facts('1008')).toBe(true);
        expect(facts('2048')).toBe(true);
        expect(facts('2047')).toBe(true);
        expect(facts('1062')).toBe(false);
        expect(facts('1003')).toBe(false);
    });

    it('a blank Foundation energy amount is no energy value, as the live parser drops it', () => {
        const bundle = makeBulkFoodBundle({ nutrients: [makeBulkNutrientRow({ nutrientId: '1008', amount: '' })] });

        expect(usdaItemFactsOf(bundle, makeBulkLookups(), { ndbNumber: null }).hasEnergy).toBe(false);
    });

    it('takes portions from the live parser, which drops an orphan and a blank-weight row', () => {
        const bundle = makeBulkFoodBundle({
            portions: [
                makeBulkPortionRow(),
                makeBulkPortionRow({ modifier: '', portionDescription: '', measureUnitId: '9999' }),
                makeBulkPortionRow({ modifier: 'tbsp', gramWeight: '' }),
            ],
        });

        expect(usdaItemFactsOf(bundle, makeBulkLookups(), null).portions).toEqual([
            { label: '1 cup, chopped', gramWeight: '91' },
        ]);
    });

    it('takes nutrients from the live parser, which owns the drop rules: a blank amount and an unknown id are dropped', () => {
        const bundle = makeBulkFoodBundle({
            nutrients: [
                makeBulkNutrientRow({ nutrientId: '1003', amount: '21.5' }),
                makeBulkNutrientRow({ nutrientId: '1008', amount: '' }),
                makeBulkNutrientRow({ nutrientId: '2066', amount: '4' }),
                makeBulkNutrientRow({ nutrientId: '1004', amount: '0' }),
            ],
        });

        expect(usdaItemFactsOf(bundle, makeBulkLookups(), null).nutrients).toEqual([
            { code: null, name: 'Protein', unit: 'g', amount: '21.5', basis: 'per_100g' },
            { code: null, name: 'Total lipid (fat)', unit: 'g', amount: '0', basis: 'per_100g' },
        ]);
    });

    // The owner ruled on 2026-10-01 that the seed assigns USDA's own food groups.
    it.each<[string, string, string | null]>([
        ['its food group, by the id food.csv gives it', '11', 'Vegetables and Vegetable Products'],
        ['no group for a blank id', '', null],
        ['no group for an id food_category.csv does not hold', '99', null],
    ])('reads %s', (_label, foodCategoryId, foodGroup) => {
        const facts = usdaItemFactsOf(makeBulkFoodBundle({ foodCategoryId }), makeBulkLookups(), null);

        expect(facts.foodGroup).toBe(foodGroup);
    });

    // Rewritten for curated plan R19: a current Foundation item also carries its NDB number, as its lineage key.
    it.each<[string, { readonly ndbNumber: string | null } | null, boolean, string | null]>([
        ['a current Foundation item with an NDB number', { ndbNumber: '11090' }, true, 'foundation:11090'],
        ['a current Foundation item with none', { ndbNumber: null }, true, null],
        ['an item that is not a current Foundation item', null, false, null],
    ])(
        'keys %s fdc:<id>, with its Foundation membership and lineage key',
        (_label, foundation, isFoundation, lineageKey) => {
            const facts = usdaItemFactsOf(makeBulkFoodBundle({ fdcId: '747447' }), makeBulkLookups(), foundation);

            expect(facts).toMatchObject({ key: 'fdc:747447', isFoundation, lineageKey, description: 'Broccoli, raw' });
        },
    );
});
