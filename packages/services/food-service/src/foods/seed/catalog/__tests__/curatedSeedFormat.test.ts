/**
 * The curated seed's format (plan U1, R3–R7, R48, R50, R51, KTD-7, KTD-16, KTD-20).
 *
 * Every refusal is asserted by its NAMED rule and the key it names, never by message text: one fixture row
 * per refusal the plan lists, each a shape the committed seed has never held. The accepted rows are the
 * positive controls, so a parser that refused everything would fail here too.
 */
import { describe, expect, it } from 'vitest';

import {
    EACH_NUTRITION_SHAPE,
    catalogText,
    changesText,
    makeCatalogChanges,
    makeItemRoot,
    makeLabel,
    makePart,
    makeSourceItemCitation,
    makeSourcelessRoot,
    makeVariant,
} from '../__fixtures__/curatedSeed.fixtures.js';
import { isSeedRefusedError, type SeedIssue, type SeedRule } from '../curatedSeedFormat.errors.js';
import { parseCatalogChanges, parseCuratedCatalog, parseCuratedSeed } from '../curatedSeedFormat.js';

/**
 * Run a parse that must be refused, and return its issues.
 *
 * @param parse - The parse.
 * @returns Every issue it reported.
 */
function issuesOf(parse: () => unknown): readonly SeedIssue[] {
    try {
        parse();
    } catch (error) {
        if (isSeedRefusedError(error)) {
            return error.issues;
        }

        throw error;
    }

    throw new Error('Expected the seed to be refused, but it parsed.');
}

/** The (rule, where) pairs of a refusal, which is what each case asserts. */
const causes = (issues: readonly SeedIssue[]): { rule: SeedRule; where: string }[] =>
    issues.map(({ rule, where }) => ({ rule, where }));

const ROOT = makeItemRoot();
const [FLAT, POINT] = ROOT.variants;

describe('parseCuratedCatalog — refusals within one line', () => {
    it.each<[string, unknown, SeedRule, string]>([
        [
            'a part with no attribute',
            { ...ROOT, variants: [{ item: 'fdc:101', parts: [{ text: 'flat' }] }] },
            'partWithoutAttribute',
            'fdc:100',
        ],
        [
            'a part whose attribute is outside the closed set',
            { ...ROOT, variants: [makeVariant({ parts: [{ attribute: 'state' as 'cut', text: 'raw' }] })] },
            'partWithoutAttribute',
            'fdc:100',
        ],
        [
            'parts out of attribute order (trim before cut)',
            {
                ...ROOT,
                variants: [makeVariant({ parts: [makePart({ attribute: 'trim', text: '0-inch' }), makePart()] })],
            },
            'partsOutOfOrder',
            'fdc:100',
        ],
        [
            'origin before brand',
            {
                ...ROOT,
                variants: [
                    makeVariant({
                        parts: [
                            makePart({ attribute: 'origin', text: 'Alaska' }),
                            makePart({ attribute: 'brand', text: 'X' }),
                        ],
                    }),
                ],
            },
            'partsOutOfOrder',
            'fdc:100',
        ],
        [
            'a variant with no parts',
            { ...ROOT, variants: [makeVariant({ parts: [] })] },
            'variantWithoutParts',
            'fdc:100',
        ],
        [
            'a straight double quote in a variant part',
            { ...ROOT, variants: [makeVariant({ parts: [makePart({ attribute: 'trim', text: '1/8" trim' })] })] },
            'inchMark',
            'fdc:100',
        ],
        ['a double prime in a curated root name', { ...ROOT, name: 'pipe 2″' }, 'inchMark', 'fdc:100'],
        ['nutrition beside a non-null item', { ...ROOT, nutrition: null }, 'nutritionBesideItem', 'fdc:100'],
        [
            'nutrition missing on a root whose item is null',
            { seedKey: 'curated:absinthe', name: 'absinthe', synonyms: [], item: null, variants: [] },
            'nutritionMissing',
            'curated:absinthe',
        ],
        [
            'nutrition on a variant',
            { ...ROOT, variants: [{ ...makeVariant(), nutrition: makeSourceItemCitation() }] },
            'nutritionOnVariant',
            'fdc:100',
        ],
        [
            'a root whose item is null that has variants',
            { ...makeSourcelessRoot(), variants: [makeVariant()] },
            'sourcelessRootWithVariants',
            'curated:absinthe',
        ],
        [
            'a root whose item is null keyed like a USDA item',
            makeSourcelessRoot({ seedKey: 'fdc:999' as 'curated:x' }),
            'sourcelessRootKeyNotCurated',
            'fdc:999',
        ],
        [
            'a label missing its URL',
            makeSourcelessRoot({ nutrition: { ...makeLabel(), url: undefined as unknown as string } }),
            'labelCitationIncomplete',
            'curated:absinthe',
        ],
        [
            'a label whose URL is not https',
            makeSourcelessRoot({ nutrition: makeLabel({ url: 'http://example.com/x' }) }),
            'labelCitationIncomplete',
            'curated:absinthe',
        ],
        [
            'a label missing its retrieval date',
            makeSourcelessRoot({ nutrition: { ...makeLabel(), retrievedOn: undefined as unknown as string } }),
            'labelCitationIncomplete',
            'curated:absinthe',
        ],
        [
            'a label whose date is not a calendar date',
            makeSourcelessRoot({ nutrition: makeLabel({ retrievedOn: '2026-02-30' }) }),
            'labelCitationIncomplete',
            'curated:absinthe',
        ],
        [
            'a label missing its manufacturer',
            makeSourcelessRoot({ nutrition: makeLabel({ manufacturer: '' }) }),
            'labelCitationIncomplete',
            'curated:absinthe',
        ],
        [
            'a label missing its serving grams',
            makeSourcelessRoot({
                nutrition: makeLabel({ serving: { label: '1 tbsp' } as { label: string; grams: string } }),
            }),
            'labelCitationIncomplete',
            'curated:absinthe',
        ],
        [
            'a label whose serving is zero grams',
            makeSourcelessRoot({ nutrition: makeLabel({ serving: { label: '1 tbsp', grams: '0' } }) }),
            'labelCitationIncomplete',
            'curated:absinthe',
        ],
        [
            'a label serving stated only in volume',
            makeSourcelessRoot({
                nutrition: makeLabel({
                    serving: { label: '1 tbsp', milliliters: '15' } as unknown as { label: string; grams: string },
                }),
            }),
            'labelServingInVolume',
            'curated:absinthe',
        ],
        [
            'a citation of a source the register does not admit',
            { ...makeSourcelessRoot(), nutrition: { source: 'openfoodfacts', key: '3017620422003', match: 'exact' } },
            'citationSourceUnknown',
            'curated:absinthe',
        ],
        [
            'the retired Branded citation shape',
            { ...makeSourcelessRoot(), nutrition: { source: 'usdaBranded', item: 'fdc:2096555' } },
            'citationSourceUnknown',
            'curated:absinthe',
        ],
        [
            'a USDA citation whose key is not an fdc key',
            makeSourcelessRoot({ nutrition: makeSourceItemCitation({ key: '2096555' }) }),
            'citationKeyMalformed',
            'curated:absinthe',
        ],
        [
            'a citation with an empty key',
            makeSourcelessRoot({ nutrition: makeSourceItemCitation({ source: 'ciqual', key: '' }) }),
            'malformedRecord',
            'curated:absinthe',
        ],
        [
            'a citation with a match outside the tiers',
            { ...makeSourcelessRoot(), nutrition: { source: 'ciqual', key: '2076', match: 'probable' } },
            'malformedRecord',
            'curated:absinthe',
        ],
        [
            'a (name, unit) pair outside LABEL_NUTRIENT_MAP — energy in kJ',
            makeSourcelessRoot({
                nutrition: makeLabel({ perServing: [{ name: 'Energy', unit: 'kJ', amount: '20' }] }),
            }),
            'labelNutrientUnknown',
            'curated:absinthe',
        ],
        [
            'one nutrient printed twice',
            makeSourcelessRoot({
                nutrition: makeLabel({
                    perServing: [
                        { name: 'Protein', unit: 'g', amount: '1' },
                        { name: 'Protein', unit: 'g', amount: '2' },
                    ],
                }),
            }),
            'labelNutrientRepeated',
            'curated:absinthe',
        ],
        [
            'a label amount that is not a decimal',
            makeSourcelessRoot({
                nutrition: makeLabel({ perServing: [{ name: 'Protein', unit: 'g', amount: '<1' }] }),
            }),
            'labelCitationIncomplete',
            'curated:absinthe',
        ],
        [
            'a variant carrying the retired state field',
            { ...ROOT, variants: [{ ...makeVariant(), state: 'purchasable' }] },
            'malformedRecord',
            'fdc:100',
        ],
        ['a malformed item key', { ...ROOT, item: 'fdc:0100' }, 'malformedRecord', 'fdc:100'],
    ])('refuses %s', (_label, root, rule, where) => {
        expect(causes(issuesOf(() => parseCuratedCatalog(catalogText([root]))))).toContainEqual({ rule, where });
    });

    it('refuses a line that is not JSON, naming its line number', () => {
        const text = `${catalogText([ROOT])}{"seedKey":\n`;

        expect(causes(issuesOf(() => parseCuratedCatalog(text)))).toEqual([
            { rule: 'malformedRecord', where: 'curatedCatalog.jsonl:2' },
        ]);
    });

    it('refuses a blank line inside the file', () => {
        const text = `${catalogText([ROOT])}\n${catalogText([makeSourcelessRoot()])}`;

        expect(causes(issuesOf(() => parseCuratedCatalog(text)))).toEqual([
            { rule: 'malformedRecord', where: 'curatedCatalog.jsonl:2' },
        ]);
    });
});

describe('parseCuratedCatalog — refusals across lines', () => {
    it.each<[string, unknown[], SeedRule, string]>([
        ['a duplicate root key (R3)', [ROOT, { ...ROOT, name: 'other', variants: [] }], 'duplicateSeedKey', 'fdc:100'],
        [
            'a duplicate root name under the database key (case and spacing)',
            [ROOT, makeItemRoot({ seedKey: 'fdc:200', item: 'fdc:200', name: 'Beef  Brisket', variants: [] })],
            'duplicateName',
            'fdc:200',
        ],
        [
            'one item used by a root and one of its variants (R4)',
            [makeItemRoot({ variants: [makeVariant({ item: 'fdc:100' })] })],
            'itemOwnedTwice',
            'fdc:100',
        ],
        [
            'one item used by a root and another root’s variant (R4)',
            [ROOT, makeItemRoot({ seedKey: 'fdc:200', item: 'fdc:101', name: 'other', variants: [] })],
            'itemOwnedTwice',
            'fdc:200',
        ],
        [
            'one item used by variants of two roots',
            [
                ROOT,
                makeItemRoot({
                    seedKey: 'fdc:200',
                    item: 'fdc:200',
                    name: 'other',
                    variants: [makeVariant({ item: 'fdc:102' })],
                }),
            ],
            'itemOwnedTwice',
            'fdc:200',
        ],
        [
            'two variants of one root with identical parts',
            [makeItemRoot({ variants: [makeVariant({ item: 'fdc:101' }), makeVariant({ item: 'fdc:102' })] })],
            'identicalVariantParts',
            'fdc:100',
        ],
    ])('refuses %s', (_label, roots, rule, where) => {
        expect(causes(issuesOf(() => parseCuratedCatalog(catalogText(roots))))).toContainEqual({ rule, where });
    });

    it('reports every issue in the file, not only the first', () => {
        const text = catalogText([
            { ...ROOT, nutrition: null },
            makeSourcelessRoot({ name: 'pipe 2″' }),
            {
                ...ROOT,
                seedKey: 'fdc:300',
                item: 'fdc:300',
                name: 'third',
                variants: [makeVariant({ item: 'fdc:301', parts: [] })],
            },
        ]);

        expect(causes(issuesOf(() => parseCuratedCatalog(text)))).toEqual(
            expect.arrayContaining([
                { rule: 'nutritionBesideItem', where: 'fdc:100' },
                { rule: 'inchMark', where: 'curated:absinthe' },
                { rule: 'variantWithoutParts', where: 'fdc:300' },
            ]),
        );
    });
});

describe('parseCuratedCatalog — accepted shapes', () => {
    it('accepts each of the nutrition shapes (KTD-16)', () => {
        const roots = parseCuratedCatalog(catalogText(EACH_NUTRITION_SHAPE));

        expect(roots.map((root) => (root.item === null ? (root.nutrition?.source ?? 'none') : 'item'))).toEqual([
            'item',
            'usda',
            'ciqual',
            'manufacturerLabel',
            'none',
        ]);
    });

    it('accepts a printed zero, which the apply stores as absent (OQ-2)', () => {
        const zero = makeSourcelessRoot({
            nutrition: makeLabel({ perServing: [{ name: 'Energy', unit: 'kcal', amount: '0.0' }] }),
        });

        expect(parseCuratedCatalog(catalogText([zero]))).toHaveLength(1);
    });

    it('accepts two parts of one attribute, kept in their written order', () => {
        const root = makeItemRoot({
            variants: [
                makeVariant({
                    parts: [
                        makePart({ attribute: 'addedNutrients', text: 'protein-fortified' }),
                        makePart({ attribute: 'addedNutrients', text: 'added vitamins A and D' }),
                    ],
                }),
            ],
        });

        const [parsed] = parseCuratedCatalog(catalogText([root]));

        expect(parsed?.variants[0]?.parts.map((part) => part.text)).toEqual([
            'protein-fortified',
            'added vitamins A and D',
        ]);
    });

    it('accepts a label with a non-zero value at every map entry it names', () => {
        expect(() => parseCuratedCatalog(catalogText([makeSourcelessRoot({ nutrition: makeLabel() })]))).not.toThrow();
    });

    it('accepts an empty catalog', () => {
        expect(parseCuratedCatalog('')).toEqual([]);
    });
});

describe('parseCatalogChanges', () => {
    it('parses the cumulative change file', () => {
        expect(parseCatalogChanges(changesText(makeCatalogChanges()))).toEqual(makeCatalogChanges());
    });

    it.each<[string, string, SeedRule, string]>([
        ['text that is not JSON', '{', 'malformedRecord', 'catalogChanges.json'],
        [
            'an unknown section',
            changesText({ ...makeCatalogChanges(), renames: [] }),
            'malformedRecord',
            'catalogChanges.json',
        ],
        [
            'a missing section',
            changesText({ merges: [], aliases: [], exclusions: [] }),
            'malformedRecord',
            'catalogChanges.json',
        ],
        [
            'an alias to a curated key',
            changesText(makeCatalogChanges({ aliases: [{ from: 'fdc:5', of: 'curated:x' as 'fdc:1' }] })),
            'malformedRecord',
            'catalogChanges.json',
        ],
        [
            'a merge source listed twice',
            changesText(
                makeCatalogChanges({ merges: [...makeCatalogChanges().merges, { from: 'fdc:101', into: 'fdc:100' }] }),
            ),
            'changeListedTwice',
            'fdc:101',
        ],
        [
            'an item that is both a merge source and an alias source',
            changesText(makeCatalogChanges({ aliases: [{ from: 'fdc:101', of: 'fdc:100' }] })),
            'changeListedTwice',
            'fdc:101',
        ],
        [
            'an exclusion listed twice',
            changesText(makeCatalogChanges({ exclusions: ['fdc:7', 'fdc:7'] })),
            'changeListedTwice',
            'fdc:7',
        ],
    ])('refuses %s', (_label, text, rule, where) => {
        expect(causes(issuesOf(() => parseCatalogChanges(text)))).toContainEqual({ rule, where });
    });
});

describe('parseCuratedSeed — the catalog against its changes', () => {
    const seed = (roots: readonly unknown[], changes: unknown): (() => unknown) => {
        return () => parseCuratedSeed({ catalogText: catalogText(roots), changesText: changesText(changes) });
    };

    it.each<[string, readonly unknown[], unknown, SeedRule, string]>([
        [
            'an undeclared merge: a variant with no merge row (R7)',
            [ROOT],
            makeCatalogChanges({ merges: [{ from: 'fdc:101', into: 'fdc:100' }] }),
            'mergeUndeclared',
            'fdc:100',
        ],
        [
            'a merge that names no variant of its root (R7)',
            [ROOT],
            makeCatalogChanges({ merges: [...makeCatalogChanges().merges, { from: 'fdc:103', into: 'fdc:100' }] }),
            'mergeWithoutVariant',
            'fdc:103',
        ],
        [
            'a merge into a root the seed does not hold',
            [ROOT],
            makeCatalogChanges({
                merges: [
                    { from: 'fdc:101', into: 'fdc:100' },
                    { from: 'fdc:102', into: 'fdc:999' },
                ],
            }),
            'mergeWithoutVariant',
            'fdc:102',
        ],
        [
            'a merge that absorbs a root whose item is null (R4)',
            [ROOT, makeSourcelessRoot()],
            makeCatalogChanges({
                merges: [...makeCatalogChanges().merges, { from: 'curated:absinthe', into: 'fdc:100' }],
            }),
            'mergeAbsorbsSourcelessRoot',
            'curated:absinthe',
        ],
        [
            'an alias whose of is neither a root’s item nor a variant’s item (R48)',
            [ROOT],
            makeCatalogChanges({ aliases: [{ from: 'fdc:500', of: 'fdc:501' }] }),
            'aliasTargetUnknown',
            'fdc:500',
        ],
        [
            'an alias whose of is a root with no USDA item',
            [ROOT, makeSourcelessRoot()],
            makeCatalogChanges({ aliases: [{ from: 'fdc:500', of: 'curated:absinthe' as 'fdc:1' }] }),
            'malformedRecord',
            'catalogChanges.json',
        ],
        [
            'a declared alias that is also a root’s item',
            [ROOT, makeItemRoot({ seedKey: 'fdc:200', item: 'fdc:200', name: 'other', variants: [] })],
            makeCatalogChanges({ aliases: [{ from: 'fdc:200', of: 'fdc:100' }] }),
            'itemOwnedTwice',
            'fdc:200',
        ],
        [
            'an excluded item that is also a root (R51)',
            [ROOT],
            makeCatalogChanges({ exclusions: ['fdc:100'] }),
            'excludedItemPlaced',
            'fdc:100',
        ],
        [
            'an excluded item that is also a variant (R51)',
            [ROOT],
            makeCatalogChanges({ exclusions: ['fdc:102'] }),
            'excludedItemPlaced',
            'fdc:102',
        ],
        [
            'an excluded item that is also a declared alias (R51)',
            [ROOT],
            makeCatalogChanges({ aliases: [{ from: 'fdc:500', of: 'fdc:100' }], exclusions: ['fdc:500'] }),
            'excludedItemPlaced',
            'fdc:500',
        ],
        [
            'a split into a root the seed does not hold',
            [ROOT],
            makeCatalogChanges({ splits: [{ from: 'fdc:90', newKey: 'fdc:999', items: ['fdc:101'] }] }),
            'splitTargetUnknown',
            'fdc:999',
        ],
        [
            'a split that lists an item its new root does not own',
            [ROOT],
            makeCatalogChanges({ splits: [{ from: 'fdc:90', newKey: 'fdc:100', items: ['fdc:777'] }] }),
            'splitItemNotOwned',
            'fdc:777',
        ],
    ])('refuses %s', (_label, roots, changes, rule, where) => {
        expect(causes(issuesOf(seed(roots, changes)))).toContainEqual({ rule, where });
    });

    it('accepts a declared alias of a root’s item and of a variant’s item, and a split its root owns', () => {
        const parsed = parseCuratedSeed({
            catalogText: catalogText(EACH_NUTRITION_SHAPE),
            changesText: changesText(
                makeCatalogChanges({
                    aliases: [
                        { from: 'fdc:500', of: 'fdc:100' },
                        { from: 'fdc:501', of: 'fdc:102' },
                    ],
                    exclusions: ['fdc:600'],
                    splits: [{ from: 'fdc:90', newKey: 'fdc:100', items: ['fdc:101'] }],
                }),
            ),
        });

        expect(parsed.roots).toHaveLength(EACH_NUTRITION_SHAPE.length);
        expect(parsed.changes.aliases).toHaveLength(2);
    });

    it('does not cross-check the two files when either is already refused, so one fault is not reported twice', () => {
        const issues = issuesOf(seed([{ ...ROOT, variants: [FLAT, { ...POINT, parts: [] }] }], makeCatalogChanges()));

        expect(causes(issues)).toEqual([{ rule: 'variantWithoutParts', where: 'fdc:100' }]);
    });
});
