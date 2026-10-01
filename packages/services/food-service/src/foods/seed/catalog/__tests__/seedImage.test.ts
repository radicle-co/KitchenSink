/**
 * The seed image: the curated seed composed over the USDA baseline (plan U1, R4, R9, R45, R48, R50, R51).
 *
 * The universe below is a miniature of the real one, using the real ids the plan names: chicken variant
 * `fdc:331960` shares its description with SR `fdc:171140` (a derived alias), and "all-purpose flour"
 * `fdc:789890` declares SR `fdc:168894` as its alias (naming rule 28a).
 */
import { describe, expect, it } from 'vitest';

import type { FdcKey } from '../../catalogKey.js';
import {
    makeBrandedProduct,
    makeCatalogChanges,
    makeExtractLine,
    makeItemRoot,
    makeLabel,
    makePart,
    makeSourceItemCitation,
    makeSourcelessRoot,
    makeUsdaItemFacts,
    makeVariant,
} from '../__fixtures__/curatedSeed.fixtures.js';
import type { UsdaItemFacts } from '../baselineSeed.js';
import { isSeedRefusedError, type SeedIssue, type SeedRule } from '../curatedSeedFormat.errors.js';
import type { CatalogChanges, CuratedRoot } from '../curatedSeedFormat.js';
import { composeSeedImage, type SeedInputs } from '../seedImage.js';

const BRISKET = makeUsdaItemFacts({ key: 'fdc:100', description: 'Beef, brisket, whole' });
const FLAT = makeUsdaItemFacts({ key: 'fdc:101', description: 'Beef, brisket, flat half' });
const POINT = makeUsdaItemFacts({ key: 'fdc:102', description: 'Beef, brisket, point half' });
const CHICKEN_RAW = makeUsdaItemFacts({
    key: 'fdc:2646170',
    description: 'Chicken, breast, boneless, skinless, raw',
    isFoundation: true,
    publicationDate: '2024-04-18',
});
const CHICKEN_BRAISED = 'Chicken, broiler or fryers, breast, skinless, boneless, meat only, cooked, braised';
const BRAISED_FOUNDATION = makeUsdaItemFacts({ key: 'fdc:331960', description: CHICKEN_BRAISED, isFoundation: true });
const BRAISED_SR = makeUsdaItemFacts({
    key: 'fdc:171140',
    description: CHICKEN_BRAISED,
    portions: [{ label: 'breast', gramWeight: '172' }],
});
const FLOUR = makeUsdaItemFacts({
    key: 'fdc:789890',
    description: 'Flour, wheat, all-purpose, enriched, bleached',
    isFoundation: true,
    publicationDate: '2020-04-01',
    nutrients: [{ code: null, name: 'Protein', unit: 'g', amount: '10.9', basis: 'per_100g' }],
    portions: [
        { label: 'cup', gramWeight: '125' },
        { label: '1 cup, sifted', gramWeight: '116' },
        { label: '1 cup, sifted', gramWeight: '118' },
    ],
});
const FLOUR_SR = makeUsdaItemFacts({
    key: 'fdc:168894',
    description: 'Wheat flour, white, all-purpose, enriched, bleached',
    nutrients: [{ code: null, name: 'Protein', unit: 'g', amount: '10.33', basis: 'per_100g' }],
    portions: [
        { label: 'cup', gramWeight: '120' },
        { label: 'tbsp', gramWeight: '7.8' },
    ],
});
const FLOUR_SR_TWIN = makeUsdaItemFacts({
    key: 'fdc:168895',
    description: 'Wheat flour, white, all-purpose, enriched, bleached',
    hasEnergy: false,
    portions: [
        { label: 'tbsp', gramWeight: '8.1' },
        { label: 'oz', gramWeight: '28.35' },
    ],
});
const BROCCOLI = makeUsdaItemFacts({ key: 'fdc:170379', description: 'Broccoli, raw' });
const RESTAURANT = makeUsdaItemFacts({ key: 'fdc:167657', description: 'Restaurant, Chinese, fried rice' });

const UNIVERSE: readonly UsdaItemFacts[] = [
    BRISKET,
    FLAT,
    POINT,
    CHICKEN_RAW,
    BRAISED_FOUNDATION,
    BRAISED_SR,
    FLOUR,
    FLOUR_SR,
    FLOUR_SR_TWIN,
    BROCCOLI,
    RESTAURANT,
];

const BRISKET_ROOT = makeItemRoot();
const CHICKEN_ROOT = makeItemRoot({
    seedKey: 'fdc:2646170',
    name: 'boneless skinless chicken breasts',
    synonyms: ['boneless chicken breasts'],
    item: 'fdc:2646170',
    variants: [makeVariant({ item: 'fdc:331960', parts: [makePart({ attribute: 'cookingMethod', text: 'braised' })] })],
});
const FLOUR_ROOT = makeItemRoot({
    seedKey: 'fdc:789890',
    name: 'all-purpose flour',
    synonyms: ['white flour'],
    item: 'fdc:789890',
    variants: [],
});
const ADOBO = makeSourcelessRoot({
    seedKey: 'curated:adobo-seasoning',
    name: 'adobo seasoning',
    nutrition: makeSourceItemCitation(),
});

/** ADOBO's one candidate: the Branded product it cites. */
const ADOBO_CANDIDATE = {
    seedKey: 'curated:adobo-seasoning',
    dataset: 'usdaBranded',
    key: 'fdc:2096555',
    match: 'exact',
} as const;

const CHANGES = makeCatalogChanges({
    merges: [
        { from: 'fdc:101', into: 'fdc:100' },
        { from: 'fdc:102', into: 'fdc:100' },
        { from: 'fdc:331960', into: 'fdc:2646170' },
    ],
    aliases: [{ from: 'fdc:168894', of: 'fdc:789890' }],
    exclusions: ['fdc:167657'],
});

/**
 * The inputs for the miniature universe, with overrides.
 *
 * @param overrides - Replacements for the roots, changes, extract or popularity.
 * @returns The seed inputs.
 */
function inputs(
    overrides: {
        roots?: readonly CuratedRoot[];
        changes?: Partial<CatalogChanges>;
        branded?: SeedInputs['branded'];
        extracts?: SeedInputs['extracts'];
        candidates?: SeedInputs['candidates'];
        popularity?: SeedInputs['popularity'];
        usdaItems?: readonly UsdaItemFacts[];
    } = {},
): SeedInputs {
    const roots = overrides.roots ?? [BRISKET_ROOT, CHICKEN_ROOT, FLOUR_ROOT, ADOBO];

    return {
        usdaItems: overrides.usdaItems ?? UNIVERSE,
        curated: {
            roots,
            changes: { ...CHANGES, ...overrides.changes },
        },
        branded: overrides.branded ?? new Map([['fdc:2096555', makeBrandedProduct()]]),
        extracts: overrides.extracts ?? new Map(),
        candidates: overrides.candidates ?? (roots.includes(ADOBO) ? [ADOBO_CANDIDATE] : []),
        popularity:
            overrides.popularity ??
            new Map<FdcKey, number>([
                ['fdc:168894', 1_000_000],
                ['fdc:168895', 2_500],
                ['fdc:100', 40_000],
            ]),
        popularitySource: 'fndds-fixture-cycle',
    };
}

/**
 * Compose inputs that must be refused, and return the (rule, where) of every issue.
 *
 * @param seedInputs - The inputs.
 * @returns The causes.
 */
function causesOf(seedInputs: SeedInputs): { rule: SeedRule; where: string }[] {
    let issues: readonly SeedIssue[] = [];

    try {
        composeSeedImage(seedInputs);
    } catch (error) {
        if (!isSeedRefusedError(error)) {
            throw error;
        }

        issues = error.issues;
    }

    if (issues.length === 0) {
        throw new Error('Expected the image to be refused.');
    }

    return issues.map(({ rule, where }) => ({ rule, where }));
}

describe('composeSeedImage — roots', () => {
    const image = composeSeedImage(inputs());

    it('keeps each curated root under its seed key, and every untouched baseline root under its description', () => {
        expect(image.roots.get('fdc:100')).toMatchObject({ name: 'beef brisket', origin: 'curated', item: 'fdc:100' });
        expect(image.roots.get('fdc:170379')).toMatchObject({
            name: 'Broccoli, raw',
            origin: 'baseline',
            item: 'fdc:170379',
            synonyms: [],
            variants: [],
            numbers: { from: 'item' },
        });
    });

    it('a merged variant item, an alias source and an excluded item are not roots', () => {
        for (const key of [
            'fdc:101',
            'fdc:102',
            'fdc:331960',
            'fdc:171140',
            'fdc:168894',
            'fdc:168895',
            'fdc:167657',
        ]) {
            expect(image.roots.has(key as FdcKey)).toBe(false);
        }
    });

    it('holds exactly the curated roots plus the untouched baseline groups', () => {
        expect([...image.roots.keys()]).toEqual([
            'fdc:100',
            'fdc:2646170',
            'fdc:789890',
            'curated:adobo-seasoning',
            'fdc:170379',
        ]);
    });

    it('resolves each root’s numbers: its item, or the cited Branded product', () => {
        expect(image.roots.get('fdc:100')?.numbers).toEqual({ from: 'item' });
        expect(image.roots.get('curated:adobo-seasoning')?.numbers).toEqual({
            from: 'usdaBranded',
            product: makeBrandedProduct(),
            match: 'exact',
            per100g: [{ name: 'Sodium, na', unit: 'mg', amount: '23750' }],
        });
    });

    it('resolves a label root and a root with no numbers', () => {
        const label = makeSourcelessRoot({ seedKey: 'curated:goya-sazon', name: 'sazon', nutrition: makeLabel() });
        const composed = composeSeedImage(
            inputs({
                roots: [BRISKET_ROOT, CHICKEN_ROOT, FLOUR_ROOT, label, makeSourcelessRoot()],
                candidates: [
                    {
                        seedKey: 'curated:goya-sazon',
                        dataset: 'label',
                        key: makeLabel().url,
                        match: 'exact',
                    },
                ],
            }),
        );

        expect(composed.roots.get('curated:goya-sazon')?.numbers).toEqual({
            from: 'manufacturerLabel',
            label: makeLabel(),
            per100g: [
                { name: 'Sodium, na', unit: 'mg', amount: '23750' },
                { name: 'Energy', unit: 'kcal', amount: '625' },
            ],
        });
        expect(composed.roots.get('curated:absinthe')?.numbers).toEqual({ from: 'none' });
    });
});

describe('composeSeedImage — items and their sources (R9, R45, R48)', () => {
    const image = composeSeedImage(inputs());

    it('fdc:171140 becomes an alias source of variant item fdc:331960, and a root of nothing', () => {
        expect(image.items.get('fdc:331960')?.sources).toEqual([
            { item: 'fdc:331960', role: 'supplier' },
            { item: 'fdc:171140', role: 'derivedAlias' },
        ]);
        expect(image.items.has('fdc:171140')).toBe(false);
    });

    it('a declared alias attaches to its of, with its own group’s members behind it', () => {
        expect(image.items.get('fdc:789890')?.sources).toEqual([
            { item: 'fdc:789890', role: 'supplier' },
            { item: 'fdc:168894', role: 'declaredAlias' },
            { item: 'fdc:168895', role: 'derivedAlias' },
        ]);
    });

    it('portions are the union of the sources; on a label clash the supplier wins, then the election order', () => {
        expect(image.items.get('fdc:789890')?.portions).toEqual([
            { label: 'cup', gramWeight: '125', source: 'fdc:789890' },
            { label: '1 cup, sifted', gramWeight: '116', source: 'fdc:789890' },
            { label: '1 cup, sifted', gramWeight: '118', source: 'fdc:789890' },
            { label: 'tbsp', gramWeight: '7.8', source: 'fdc:168894' },
            { label: 'oz', gramWeight: '28.35', source: 'fdc:168895' },
        ]);
    });

    /**
     * Rewritten for curated plan U5 slice 0: the weight is the exact `decimal.js` sum of the committed text and the
     * fraction is rounded to nine places, both as decimal strings, so the verifier's SQL `numeric` reproduces them.
     */
    it('"all-purpose flour" weighs the exact sum of its alias sources’ weights, with its fraction to nine places', () => {
        const flour = image.items.get('fdc:789890');

        expect(flour?.weight).toBe('1002500');
        expect(flour?.priorFraction).toBe('0.689861537');
    });

    it('sums weights exactly, beyond the 20 significant digits a float or a default Decimal keeps', () => {
        const composed = composeSeedImage(
            inputs({
                popularity: new Map<FdcKey, number>([
                    ['fdc:168894', 463000000.1234568],
                    ['fdc:168895', 1.23e-12],
                ]),
            }),
        );

        expect(composed.items.get('fdc:789890')?.weight).toBe('463000000.12345680000123');
    });

    it('an item with no weighted source weighs zero', () => {
        expect(image.items.get('fdc:2646170')).toMatchObject({ weight: '0', priorFraction: '0' });
    });

    it('an item carries its supplier’s nutrients, never an alias source’s', () => {
        expect(image.items.get('fdc:789890')?.nutrients).toEqual([
            { code: null, name: 'Protein', unit: 'g', amount: '10.9', basis: 'per_100g' },
        ]);
    });

    it('a sourceless root owns an item keyed by its seed key, with no source row', () => {
        expect(image.items.get('curated:adobo-seasoning')).toEqual({
            sources: [],
            portions: [],
            nutrients: [],
            weight: '0',
            priorFraction: '0',
        });
    });

    it('places every non-excluded universe item as a source of exactly one image item', () => {
        const sources = [...image.items.values()].flatMap((item) => item.sources.map((source) => source.item));

        expect([...sources].sort()).toEqual(
            UNIVERSE.filter((item) => item.key !== 'fdc:167657')
                .map((item) => item.key)
                .sort(),
        );
    });

    it('carries the popularity weights’ survey cycle, which every popularity row stores as its source', () => {
        expect(composeSeedImage(inputs()).popularitySource).toBe('fndds-fixture-cycle');
    });

    it('ignores the weight of an excluded item', () => {
        const composed = composeSeedImage(inputs({ popularity: new Map([['fdc:167657', 9]]) }));

        expect([...composed.items.values()].every((item) => item.weight === '0')).toBe(true);
    });
});

describe('composeSeedImage — refusals that need the baseline', () => {
    it.each<[string, Parameters<typeof inputs>[0], SeedRule, string]>([
        [
            'a curated root’s item that is not its group’s supplier',
            {
                roots: [
                    makeItemRoot({ seedKey: 'fdc:171140', item: 'fdc:171140', name: 'braised chicken', variants: [] }),
                ],
                changes: { merges: [], aliases: [] },
            },
            'itemNotSupplier',
            'fdc:171140',
        ],
        [
            'a variant’s item that is not its group’s supplier',
            {
                roots: [
                    makeItemRoot({
                        seedKey: 'fdc:2646170',
                        item: 'fdc:2646170',
                        name: 'chicken',
                        variants: [makeVariant({ item: 'fdc:171140' })],
                    }),
                ],
                changes: { merges: [{ from: 'fdc:171140', into: 'fdc:2646170' }], aliases: [] },
            },
            'itemNotSupplier',
            'fdc:2646170',
        ],
        [
            'a declared alias whose from is a group member, not its supplier',
            { changes: { aliases: [{ from: 'fdc:168895', of: 'fdc:789890' }] } },
            'aliasNotSupplier',
            'fdc:168895',
        ],
        [
            'a variant whose item is outside the universe',
            {
                roots: [makeItemRoot({ variants: [makeVariant({ item: 'fdc:999999' })] })],
                changes: { merges: [{ from: 'fdc:999999', into: 'fdc:100' }], aliases: [] },
            },
            'itemOutsideUniverse',
            'fdc:100',
        ],
        [
            'an alias whose from is outside the universe',
            { changes: { aliases: [{ from: 'fdc:999999', of: 'fdc:789890' }] } },
            'itemOutsideUniverse',
            'fdc:999999',
        ],
        [
            'an exclusion outside the universe (R51)',
            { changes: { exclusions: ['fdc:334462'] } },
            'exclusionOutsideUniverse',
            'fdc:334462',
        ],
        [
            'a Branded candidate missing from the extract',
            { branded: new Map() },
            'candidateNotInExtract',
            'curated:adobo-seasoning',
        ],
        [
            'a Branded citation whose serving is in millilitres',
            { branded: new Map([['fdc:2096555', makeBrandedProduct({ serving_size_unit: 'MLT' })]]) },
            'brandedServingNotGrams',
            'curated:adobo-seasoning',
        ],
        [
            'a popularity weight for an item outside the universe',
            { popularity: new Map([['fdc:999999', 5]]) },
            'popularityItemUnknown',
            'fdc:999999',
        ],
        [
            'a curated name that collides with an untouched baseline name',
            {
                roots: [BRISKET_ROOT, makeSourcelessRoot({ seedKey: 'curated:broccoli', name: 'broccoli, RAW' })],
                changes: { merges: CHANGES.merges.slice(0, 2), aliases: [] },
            },
            'duplicateName',
            'curated:broccoli',
        ],
        [
            'a curated seed key that is an untouched baseline root’s key',
            {
                roots: [
                    BRISKET_ROOT,
                    makeItemRoot({ seedKey: 'fdc:170379', item: 'fdc:2646170', name: 'chicken', variants: [] }),
                ],
                changes: { merges: CHANGES.merges.slice(0, 2), aliases: [] },
            },
            'duplicateSeedKey',
            'fdc:170379',
        ],
    ])('refuses %s', (_label, overrides, rule, where) => {
        expect(causesOf(inputs(overrides))).toContainEqual({ rule, where });
    });

    it('accepts every Branded gram unit the committed extract uses: g, GRM and GM', () => {
        for (const unit of ['g', 'GRM', 'GM']) {
            const branded = new Map([['fdc:2096555' as FdcKey, makeBrandedProduct({ serving_size_unit: unit })]]);

            expect(() => composeSeedImage(inputs({ branded }))).not.toThrow();
        }
    });

    it('reports a baseline refusal through the same error', () => {
        const usDate = makeUsdaItemFacts({ key: 'fdc:5', description: 'Salt, table', publicationDate: '4/1/2019' });

        expect(causesOf(inputs({ usdaItems: [...UNIVERSE, usDate] }))).toContainEqual({
            rule: 'publicationDateNotIso',
            where: 'fdc:5',
        });
    });
});

describe('composeSeedImage — citations and their policy (R50, KTD-22)', () => {
    const NECTAR = makeSourcelessRoot({
        seedKey: 'curated:apple-nectar',
        name: 'apple nectar',
        nutrition: makeSourceItemCitation({ source: 'ciqual', key: '2076' }),
    });
    const CIQUAL = new Map([['ciqual', new Map([['2076', makeExtractLine()]])]] as const);
    const NECTAR_CANDIDATE = {
        seedKey: 'curated:apple-nectar',
        dataset: 'ciqual',
        key: '2076',
        match: 'exact',
    } as const;

    /** The default roots plus one more, with its candidates beside ADOBO's. */
    function withRoot(
        root: CuratedRoot,
        candidates: SeedInputs['candidates'],
        extracts: SeedInputs['extracts'] = CIQUAL,
    ): SeedInputs {
        return inputs({
            roots: [BRISKET_ROOT, CHICKEN_ROOT, FLOUR_ROOT, ADOBO, root],
            candidates: [ADOBO_CANDIDATE, ...candidates],
            extracts,
        });
    }

    it('resolves a table citation to its extract line', () => {
        const image = composeSeedImage(withRoot(NECTAR, [NECTAR_CANDIDATE]));

        expect(image.roots.get('curated:apple-nectar')?.numbers).toEqual({
            from: 'extract',
            dataset: 'ciqual',
            line: makeExtractLine(),
            match: 'exact',
            per100g: { values: makeExtractLine().values, conversions: [] },
        });
    });

    it('resolves a per-100 mL line of a source that publishes drinks per 100 mL', () => {
        const port = makeSourcelessRoot({
            seedKey: 'curated:port',
            name: 'port',
            nutrition: makeSourceItemCitation({ source: 'cofid', key: '17-234' }),
        });
        const line = makeExtractLine({ key: '17-234', name: 'Port', basis: 'per100mL', densityGramsPerMl: '1.03' });
        const image = composeSeedImage(
            withRoot(
                port,
                [{ seedKey: 'curated:port', dataset: 'cofid', key: '17-234', match: 'exact' }],
                new Map([['cofid', new Map([['17-234', line]])]]),
            ),
        );

        // The image carries the converted values, so no later step can store the per-100 mL ones (KTD-24, R54).
        expect(image.roots.get('curated:port')?.numbers).toEqual({
            from: 'extract',
            dataset: 'cofid',
            line,
            match: 'exact',
            per100g: {
                values: { ENERC_KCAL: '50.485', CHOAVL: '12.039' },
                conversions: [{ kind: 'volumeToMass', densityGramsPerMl: '1.03' }],
            },
        });
    });

    it('resolves an FNDDS candidate against the FNDDS extract', () => {
        const tequila = makeSourcelessRoot({
            seedKey: 'curated:tequila',
            name: 'tequila',
            nutrition: makeSourceItemCitation({ key: 'fdc:2710705' }),
        });
        const line = makeExtractLine({ key: 'fdc:2710705', name: 'Tequila' });
        const image = composeSeedImage(
            withRoot(
                tequila,
                [{ seedKey: 'curated:tequila', dataset: 'usdaFndds', key: 'fdc:2710705', match: 'exact' }],
                new Map([['usdaFndds', new Map([['fdc:2710705', line]])]]),
            ),
        );

        expect(image.roots.get('curated:tequila')?.numbers).toEqual({
            from: 'extract',
            dataset: 'usdaFndds',
            line,
            match: 'exact',
            per100g: { values: line.values, conversions: [] },
        });
    });

    it('resolves a same-substance stand-in to the SR Legacy or Foundation item it cites', () => {
        const standIn = makeSourcelessRoot({
            seedKey: 'curated:whole-broccoli',
            name: 'whole broccoli heads',
            nutrition: makeSourceItemCitation({ key: 'fdc:170379', match: 'sameSubstance' }),
        });
        const image = composeSeedImage(
            withRoot(standIn, [
                {
                    seedKey: 'curated:whole-broccoli',
                    dataset: 'usdaSrFoundation',
                    key: 'fdc:170379',
                    match: 'sameSubstance',
                },
            ]),
        );

        // U5 slice 0: the stand-in arm carries its item's rows, since a declared alias stand-in is no image item.
        expect(image.roots.get('curated:whole-broccoli')?.numbers).toEqual({
            from: 'usdaStandIn',
            item: 'fdc:170379',
            match: 'sameSubstance',
            nutrients: [],
        });
    });

    it('accepts the policy’s choice among several candidates: an exact table entry over the Branded product', () => {
        const adobo = makeSourcelessRoot({
            seedKey: 'curated:adobo-seasoning',
            name: 'adobo seasoning',
            nutrition: makeSourceItemCitation({ source: 'ciqual', key: '2076' }),
        });
        const image = composeSeedImage(
            inputs({
                roots: [BRISKET_ROOT, CHICKEN_ROOT, FLOUR_ROOT, adobo],
                candidates: [ADOBO_CANDIDATE, { ...NECTAR_CANDIDATE, seedKey: 'curated:adobo-seasoning' }],
                extracts: CIQUAL,
            }),
        );

        expect(image.roots.get('curated:adobo-seasoning')?.numbers).toMatchObject({
            from: 'extract',
            dataset: 'ciqual',
        });
    });

    it.each<[string, SeedInputs, SeedRule, string]>([
        [
            'a table citation no extract holds',
            withRoot(NECTAR, [NECTAR_CANDIDATE], new Map()),
            'candidateNotInExtract',
            'curated:apple-nectar',
        ],
        [
            'an FDC id listed as a Branded candidate that names an SR Legacy item instead',
            withRoot(
                makeSourcelessRoot({
                    seedKey: 'curated:broccoli-typo',
                    name: 'broccoli typo',
                    nutrition: makeSourceItemCitation({ key: 'fdc:170379' }),
                }),
                [{ seedKey: 'curated:broccoli-typo', dataset: 'usdaBranded', key: 'fdc:170379', match: 'exact' }],
            ),
            'candidateNotInExtract',
            'curated:broccoli-typo',
        ],
        [
            'two candidates that rank equally, which only file order could separate',
            withRoot(
                NECTAR,
                [NECTAR_CANDIDATE, { ...NECTAR_CANDIDATE, key: '2077' }],
                new Map([
                    [
                        'ciqual',
                        new Map([
                            ['2076', makeExtractLine()],
                            ['2077', makeExtractLine({ key: '2077' })],
                        ]),
                    ],
                ]),
            ),
            'candidateTie',
            'curated:apple-nectar',
        ],
        [
            'a per-100 mL line from a source that publishes everything per 100 g',
            withRoot(
                NECTAR,
                [NECTAR_CANDIDATE],
                new Map([
                    ['ciqual', new Map([['2076', makeExtractLine({ basis: 'per100mL', densityGramsPerMl: '1.05' })]])],
                ]),
            ),
            'extractBasisUndeclared',
            'curated:apple-nectar',
        ],
        [
            'a stand-in that is not its group’s supplier',
            withRoot(
                makeSourcelessRoot({
                    seedKey: 'curated:flour-twin',
                    name: 'twin flour',
                    nutrition: makeSourceItemCitation({ key: 'fdc:168895', match: 'sameSubstance' }),
                }),
                [
                    {
                        seedKey: 'curated:flour-twin',
                        dataset: 'usdaSrFoundation',
                        key: 'fdc:168895',
                        match: 'sameSubstance',
                    },
                ],
            ),
            'itemNotSupplier',
            'curated:flour-twin',
        ],
        [
            'a Branded citation where an exact table entry exists',
            inputs({
                candidates: [ADOBO_CANDIDATE, { ...NECTAR_CANDIDATE, seedKey: 'curated:adobo-seasoning' }],
                extracts: CIQUAL,
            }),
            'citationNotPolicyChoice',
            'curated:adobo-seasoning',
        ],
        [
            'no numbers where a candidate exists',
            withRoot(makeSourcelessRoot(), [{ ...NECTAR_CANDIDATE, seedKey: 'curated:absinthe' }]),
            'citationNotPolicyChoice',
            'curated:absinthe',
        ],
        ['a citation with no candidate row', withRoot(NECTAR, []), 'citationNotPolicyChoice', 'curated:apple-nectar'],
        [
            'a candidate for a root the seed does not hold',
            withRoot(NECTAR, [NECTAR_CANDIDATE, { ...NECTAR_CANDIDATE, seedKey: 'curated:nowhere' }]),
            'candidateForUnknownRoot',
            'curated:nowhere',
        ],
        [
            'a candidate no extract holds',
            withRoot(NECTAR, [NECTAR_CANDIDATE, { ...NECTAR_CANDIDATE, key: '9999' }]),
            'candidateNotInExtract',
            'curated:apple-nectar',
        ],
        [
            'a label candidate that is not the root’s label',
            withRoot(makeSourcelessRoot({ seedKey: 'curated:goya-sazon', name: 'sazon', nutrition: makeLabel() }), [
                {
                    seedKey: 'curated:goya-sazon',
                    dataset: 'label',
                    key: 'https://example.com/other',
                    match: 'exact',
                },
            ]),
            'candidateNotInExtract',
            'curated:goya-sazon',
        ],
    ])('refuses %s', (_label, seedInputs, rule, where) => {
        expect(causesOf(seedInputs)).toContainEqual({ rule, where });
    });
});
