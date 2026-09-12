/**
 * `projectSeed` (curated catalog plan U5, KTD-11): the seed image as the catalog a seeded database would hold, by
 * natural key, so the planner can diff two seeds without a database.
 */
import { describe, expect, it } from 'vitest';

import {
    makeBrandedProduct,
    makeExtractLine,
    makeLabel,
    makePart,
    makeVariant,
} from '../__fixtures__/curatedSeed.fixtures.js';
import {
    makeCanonicalNutrient,
    makeSeedImage,
    makeSeedImageItem,
    makeSeedImageRoot,
} from '../__fixtures__/seedImage.fixtures.js';
import type { RootNumbers } from '../seedImage.js';
import { OWN_ITEM_MATCH, projectSeed } from '../seedProjection.js';

const PROTEIN = makeCanonicalNutrient({ name: 'Protein', unit: 'g', amount: '21.50' });
const ENERGY = makeCanonicalNutrient({ name: 'Energy', unit: 'kcal', amount: '155' });

describe('projectSeed — roots, variants and items', () => {
    const brisket = makeSeedImageRoot({
        seedKey: 'fdc:100',
        name: 'beef brisket',
        synonyms: ['brisket', 'beef breast'],
        item: 'fdc:100',
        variants: [makeVariant({ item: 'fdc:101', parts: [makePart({ text: 'flat' })] })],
        origin: 'curated',
    });
    const image = makeSeedImage(
        [brisket],
        [
            [
                'fdc:100',
                makeSeedImageItem({
                    sources: [
                        { item: 'fdc:100', role: 'supplier' },
                        { item: 'fdc:17', role: 'derivedAlias' },
                    ],
                    portions: [
                        { label: 'oz', gramWeight: '28.350', source: 'fdc:100' },
                        { label: 'cup', gramWeight: '120', source: 'fdc:17' },
                    ],
                    nutrients: [PROTEIN, ENERGY],
                    weight: '40000.10',
                    priorFraction: '0.528103171',
                }),
            ],
            ['fdc:101', makeSeedImageItem({ sources: [{ item: 'fdc:101', role: 'supplier' }], nutrients: [ENERGY] })],
        ],
    );
    const { content } = projectSeed(image);

    it('names a root by its seed key, with its own item’s numbers cited as that item', () => {
        expect(content.roots.get('fdc:100')).toEqual({
            seedKey: 'fdc:100',
            name: 'beef brisket',
            synonyms: ['brisket', 'beef breast'],
            item: 'fdc:100',
            nutrition: {
                citation: {
                    dataset: 'usdaSrFoundation',
                    externalKey: '100',
                    match: OWN_ITEM_MATCH,
                    densityGPerMl: null,
                    kcalFromKj: false,
                },
                values: [
                    { name: 'Energy', unit: 'kcal', amount: '155' },
                    { name: 'Protein', unit: 'g', amount: '21.5' },
                ],
            },
        });
    });

    it('names a variant by its item, under its root, with its own item’s numbers', () => {
        expect(content.variants.get('fdc:101')).toEqual({
            item: 'fdc:101',
            root: 'fdc:100',
            parts: [{ attribute: 'cut', text: 'flat' }],
            nutrition: {
                citation: {
                    dataset: 'usdaSrFoundation',
                    externalKey: '101',
                    match: OWN_ITEM_MATCH,
                    densityGPerMl: null,
                    kcalFromKj: false,
                },
                values: [{ name: 'Energy', unit: 'kcal', amount: '155' }],
            },
        });
    });

    it('spells source keys bare, sorts sources and portions, and canonicalizes every decimal', () => {
        expect(content.items.get('fdc:100')).toEqual({
            key: 'fdc:100',
            sources: [
                { source: 'usda', externalKey: '100' },
                { source: 'usda', externalKey: '17' },
            ],
            portions: [
                { label: 'oz', gramWeight: '28.35', source: { source: 'usda', externalKey: '100' } },
                { label: 'cup', gramWeight: '120', source: { source: 'usda', externalKey: '17' } },
            ],
            categories: [],
            popularity: { weight: '40000.1', priorFraction: '0.528103171', source: 'fndds-fixture-cycle' },
        });
    });

    it('gives an item with no weight no popularity row', () => {
        expect(content.items.get('fdc:101')?.popularity).toBeNull();
    });

    it('ids every row projected:<key>, and holds no retired row, forward or live row', () => {
        const snapshot = projectSeed(image);

        expect(snapshot.ids.roots.get('fdc:100')).toBe('projected:fdc:100');
        expect(snapshot.ids.variants.get('fdc:101')).toBe('projected:fdc:101');
        expect([...snapshot.ids.items]).toEqual([
            ['fdc:100', 'projected:fdc:100'],
            ['fdc:101', 'projected:fdc:101'],
        ]);
        expect(snapshot.retired.roots.size + snapshot.retired.variants.size + snapshot.retired.items.size).toBe(0);
        expect(snapshot.forwards).toEqual([]);
        expect(snapshot.liveNames.size + snapshot.liveSourceKeys.size).toBe(0);
    });
});

describe('projectSeed — a sourceless root’s numbers (R50, KTD-20, KTD-22)', () => {
    /**
     * Project one sourceless root with the given numbers.
     *
     * @param numbers - The root's numbers.
     * @returns The projected root's nutrition.
     */
    function nutritionOf(numbers: RootNumbers): unknown {
        const root = makeSeedImageRoot({ seedKey: 'curated:thing', item: 'curated:thing', numbers });
        // The stand-in is no image item here: a declared alias source can be cited (fdc:169910 in the committed seed).
        const image = makeSeedImage([root], [['curated:thing', makeSeedImageItem({ sources: [], nutrients: [] })]]);

        return projectSeed(image).content.roots.get('curated:thing')?.nutrition;
    }

    /**
     * Project one sourceless root with the given numbers.
     *
     * @param numbers - The root's numbers.
     * @returns The portions of the root's item.
     */
    function portionsOf(numbers: RootNumbers): unknown {
        const root = makeSeedImageRoot({ seedKey: 'curated:thing', item: 'curated:thing', numbers });
        const image = makeSeedImage([root], [['curated:thing', makeSeedImageItem({ sources: [], nutrients: [] })]]);

        return projectSeed(image).content.items.get('curated:thing')?.portions;
    }

    it('a root with no numbers has no nutrition', () => {
        expect(nutritionOf({ from: 'none' })).toBeNull();
    });

    it('a stand-in cites that USDA item, bare, with the candidate’s match, and takes its numbers', () => {
        expect(
            nutritionOf({ from: 'usdaStandIn', item: 'fdc:170379', match: 'sameSubstance', nutrients: [PROTEIN] }),
        ).toEqual({
            citation: {
                dataset: 'usdaSrFoundation',
                externalKey: '170379',
                match: 'sameSubstance',
                densityGPerMl: null,
                kcalFromKj: false,
            },
            values: [{ name: 'Protein', unit: 'g', amount: '21.5' }],
        });
    });

    it('a Branded product cites its bare FDC id and stores the zero-free per-100 g values', () => {
        expect(
            nutritionOf({
                from: 'usdaBranded',
                product: makeBrandedProduct({ fdcId: 2096555 }),
                match: 'exact',
                per100g: [{ name: 'Sodium, na', unit: 'mg', amount: '23750.0' }],
            }),
        ).toEqual({
            citation: {
                dataset: 'usdaBranded',
                externalKey: '2096555',
                match: 'exact',
                densityGPerMl: null,
                kcalFromKj: false,
            },
            values: [{ name: 'Sodium, na', unit: 'mg', amount: '23750' }],
        });
    });

    it('a Branded serving stated in household terms becomes a portion of the root, verbatim, in grams, citing the product (OQ-1)', () => {
        const numbers: RootNumbers = {
            from: 'usdaBranded',
            product: makeBrandedProduct({ fdcId: 2096555, household_serving_fulltext: '1 ONZ', serving_size: '28.0' }),
            match: 'exact',
            per100g: [],
        };

        expect(portionsOf(numbers)).toEqual([
            {
                label: '1 ONZ',
                gramWeight: '28',
                citation: {
                    dataset: 'usdaBranded',
                    externalKey: '2096555',
                    match: 'exact',
                    densityGPerMl: null,
                    kcalFromKj: false,
                },
            },
        ]);
        expect(nutritionOf(numbers)).not.toHaveProperty('serving');
    });

    it('a Branded product that states no household serving gives no portion: absent, never blank', () => {
        expect(
            portionsOf({
                from: 'usdaBranded',
                product: makeBrandedProduct({ household_serving_fulltext: '  ' }),
                match: 'exact',
                per100g: [],
            }),
        ).toEqual([]);
    });

    it('a label’s serving becomes a portion of the root citing the label (OQ-1); a source item or table line gives none', () => {
        const label = makeLabel();
        const numbers: RootNumbers = { from: 'manufacturerLabel', label, per100g: [] };

        expect(portionsOf(numbers)).toEqual([
            {
                label: label.serving.label,
                gramWeight: '0.8',
                citation: {
                    dataset: 'label',
                    url: label.url,
                    retrievedOn: label.retrievedOn,
                    manufacturer: label.manufacturer,
                    servingLabel: label.serving.label,
                    servingGrams: '0.8',
                },
            },
        ]);
        expect(nutritionOf(numbers)).not.toHaveProperty('serving');
        expect(
            portionsOf({ from: 'usdaStandIn', item: 'fdc:170379', match: 'sameSubstance', nutrients: [PROTEIN] }),
        ).toEqual([]);
    });

    it('a table line stores its converted values under their definitions, records each conversion, and keeps a trace', () => {
        const line = makeExtractLine({ key: '18066', basis: 'per100mL', densityGramsPerMl: '1.03' });

        expect(
            nutritionOf({
                from: 'extract',
                dataset: 'cofid',
                line,
                match: 'close',
                per100g: {
                    values: { ENERC_KJ: '100', ENERC_KCAL: '23.901', CHOAVLM: '11.65' },
                    traces: ['FIBTG'],
                    conversions: [
                        { kind: 'volumeToMass', densityGramsPerMl: '1.03' },
                        { kind: 'kilojoulesToKilocalories' },
                    ],
                },
            }),
        ).toEqual({
            citation: {
                dataset: 'cofid',
                externalKey: '18066',
                match: 'close',
                densityGPerMl: '1.03',
                kcalFromKj: true,
            },
            values: [
                { name: 'Carbohydrate, available (monosaccharide equivalents)', unit: 'g', amount: '11.65' },
                { name: 'Energy', unit: 'kcal', amount: '23.901' },
                { name: 'Energy', unit: 'kj', amount: '100' },
                { name: 'Fiber, total dietary', unit: 'g', amount: null },
            ],
        });
    });

    it('an FNDDS line’s fdc:<id> key is stored bare, as every USDA key is', () => {
        const line = makeExtractLine({ key: 'fdc:2705964' });

        expect(
            nutritionOf({
                from: 'extract',
                dataset: 'usdaFndds',
                line,
                match: 'exact',
                per100g: { values: { PROCNT: '3' }, conversions: [] },
            }),
        ).toMatchObject({ citation: { dataset: 'usdaFndds', externalKey: '2705964' } });
    });

    it('a label stores its citation fields as committed and its per-100 g values', () => {
        const label = makeLabel();

        expect(
            nutritionOf({
                from: 'manufacturerLabel',
                label,
                per100g: [{ name: 'Sodium, na', unit: 'mg', amount: '23750' }],
            }),
        ).toEqual({
            citation: {
                dataset: 'label',
                url: label.url,
                retrievedOn: label.retrievedOn,
                manufacturer: label.manufacturer,
                servingLabel: label.serving.label,
                servingGrams: '0.8',
            },
            values: [{ name: 'Sodium, na', unit: 'mg', amount: '23750' }],
        });
    });
});
