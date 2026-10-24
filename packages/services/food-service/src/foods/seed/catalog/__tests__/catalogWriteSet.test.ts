/**
 * `resolveCatalogWriteSet` (curated catalog plan U6, KTD-1, KTD-8, KTD-19): the pure half of the apply. It turns a plan
 * and the snapshot's ids into the rows each statement writes, minting an id for every new row and for nothing else.
 *
 * Every snapshot names its rows `id:<key>` and every minted id is `new-<n>`, so a reused id and a minted one read
 * apart by sight. Each case asserts a reference by following it to the row it names, so a row pointing at the wrong
 * parent fails even when every list has the right length.
 */
import { describe, expect, it } from 'vitest';

import {
    makeContent,
    makeContentItem,
    makeContentRoot,
    makeContentVariant,
    makeNutrition,
    makeSnapshot,
} from '../__fixtures__/catalogContent.fixtures.js';
import { makeCatalogChanges } from '../__fixtures__/curatedSeed.fixtures.js';
import { buildCatalogPlan, type CatalogPlan } from '../catalogPlanBuilder.js';
import { isCatalogApplyError } from '../catalogPlanApplier.errors.js';
import { EMPTY_SNAPSHOT, type CatalogContent, type CatalogSnapshot, type LabelCitation } from '../catalogSnapshot.js';
import { resolveCatalogWriteSet, type CatalogWriteSet } from '../catalogWriteSet.js';

const NO_CHANGES = makeCatalogChanges({ merges: [], aliases: [], exclusions: [], splits: [] });

const LABEL: LabelCitation = {
    dataset: 'label',
    url: 'https://example.com/salt-blend',
    retrievedOn: '2026-09-30',
    manufacturer: 'Acme',
    servingLabel: '1/4 tsp',
    servingGrams: '0.8',
};

const BRISKET = makeContentRoot({
    synonyms: ['brisket', 'beef breast'],
    nutrition: {
        ...makeNutrition('fdc:100'),
        values: [
            { name: 'Energy', unit: 'kcal', amount: '250' },
            { name: 'Fiber, total dietary', unit: 'g', amount: null },
            { name: 'Vitamin K (phylloquinone)', unit: 'µg', amount: '1.2' },
        ],
    },
});
const FLAT = makeContentVariant({
    parts: [
        { attribute: 'cut', text: 'flat' },
        { attribute: 'cut', text: 'half' },
        { attribute: 'cookingMethod', text: 'braised' },
    ],
});
const SALT = makeContentRoot({
    seedKey: 'curated:salt-blend',
    name: 'Salt Blend',
    item: 'curated:salt-blend',
    nutrition: { citation: LABEL, values: [{ name: 'Sodium, Na', unit: 'mg', amount: '23750' }] },
});
const CHICKEN = makeContentRoot({
    seedKey: 'fdc:200',
    name: 'chicken breast',
    item: 'fdc:200',
    nutrition: makeNutrition('fdc:200'),
});
const BRISKET_ITEM = makeContentItem('fdc:100', {
    sources: [
        { source: 'usda', externalKey: '100', lineageKey: 'foundation:13023' },
        { source: 'usda', externalKey: '17', lineageKey: null },
    ],
    portions: [
        { label: 'oz', gramWeight: '28.35', source: { source: 'usda', externalKey: '100' } },
        { label: 'cup', gramWeight: '120', source: { source: 'usda', externalKey: '17' } },
    ],
    categories: [
        { name: 'Beef Products', source: { source: 'usda', externalKey: '100' } },
        { name: 'Meats', source: null },
    ],
});
const SALT_ITEM = makeContentItem('curated:salt-blend', {
    portions: [{ label: '1/4 tsp', gramWeight: '0.8', citation: LABEL }],
});
const CATALOG: CatalogContent = makeContent([BRISKET, SALT], [FLAT], [BRISKET_ITEM, SALT_ITEM]);

/**
 * A minter that names each id it mints `new-<n>`, in mint order.
 *
 * @returns The minter.
 */
function counter(): () => string {
    let next = 0;

    return () => {
        next += 1;

        return `new-${String(next)}`;
    };
}

/**
 * Plan a target against a snapshot, then resolve it.
 *
 * @param target - The seed's content.
 * @param snapshot - The catalog.
 * @returns The plan and its write set.
 */
function resolve(target: CatalogContent, snapshot: CatalogSnapshot): { plan: CatalogPlan; set: CatalogWriteSet } {
    const plan = buildCatalogPlan(target, snapshot, NO_CHANGES);

    return { plan, set: resolveCatalogWriteSet(plan, snapshot.ids, counter()) };
}

/**
 * The one row of a list whose field equals a value.
 *
 * @param rows - The rows.
 * @param pick - The row's field.
 * @param value - The value.
 * @returns The row.
 */
function only<Row>(rows: readonly Row[], pick: (row: Row) => unknown, value: unknown): Row {
    const found = rows.filter((row) => pick(row) === value);

    expect(found).toHaveLength(1);

    return found[0] as Row;
}

describe('resolveCatalogWriteSet — an empty catalog', () => {
    const { set } = resolve(CATALOG, EMPTY_SNAPSHOT);
    const rootOf = (seedKey: string) => only(set.rootInserts, (row) => row.seedKey, seedKey);
    const itemOf = (key: string) => only(set.itemInserts, (row) => row.naturalKey, key);

    it('mints an item for every owned key, each with the kind of its owner', () => {
        expect(set.itemInserts.map((row) => [row.naturalKey, row.ownerKind]).sort()).toEqual([
            ['curated:salt-blend', 'root'],
            ['fdc:100', 'root'],
            ['fdc:101', 'variant'],
        ]);
        expect(new Set(set.itemInserts.map((row) => row.id)).size).toBe(3);
        expect(set.itemInserts.every((row) => row.id.startsWith('new-'))).toBe(true);
    });

    it('writes each root on its own item, with its name, normalized name and synonyms', () => {
        expect(rootOf('fdc:100')).toEqual({
            id: rootOf('fdc:100').id,
            seedKey: 'fdc:100',
            itemId: itemOf('fdc:100').id,
            name: 'beef brisket',
            normalizedName: 'beef brisket',
            aliases: 'brisket; beef breast',
        });
        expect(rootOf('curated:salt-blend')).toMatchObject({
            itemId: itemOf('curated:salt-blend').id,
            name: 'Salt Blend',
            normalizedName: 'salt blend',
            aliases: null,
        });
    });

    it('writes each variant under its root’s new id and on its own item', () => {
        expect(set.variantInserts).toEqual([
            { id: set.variantInserts[0]?.id, foodId: rootOf('fdc:100').id, itemId: itemOf('fdc:101').id },
        ]);
    });

    it('gives every owner one header, one citation under it, and values citing that citation', () => {
        const brisketHeader = only(set.children.headers, (row) => row.foodId, rootOf('fdc:100').id);
        const flatHeader = only(set.children.headers, (row) => row.variantId, set.variantInserts[0]?.id);
        const saltHeader = only(set.children.headers, (row) => row.foodId, rootOf('curated:salt-blend').id);

        expect([brisketHeader.variantId, flatHeader.foodId, saltHeader.variantId]).toEqual([null, null, null]);
        expect(set.children.headers).toHaveLength(3);

        for (const header of set.children.headers) {
            const citation = only(set.children.citations, (row) => row.nutritionId, header.id);
            const values = set.children.values.filter((row) => row.nutritionId === header.id);

            expect(values.length).toBeGreaterThan(0);
            expect(values.every((value) => value.citationId === citation.id)).toBe(true);
        }

        expect(set.children.values).toHaveLength(5);
    });

    it('stages a trace as a NULL amount with the trace flag, and an amount without it', () => {
        const brisketHeader = only(set.children.headers, (row) => row.foodId, rootOf('fdc:100').id);
        const values = set.children.values.filter((row) => row.nutritionId === brisketHeader.id);

        expect(values.map(({ name, unit, amount, trace }) => ({ name, unit, amount, trace }))).toEqual([
            { name: 'Energy', unit: 'kcal', amount: '250', trace: false },
            { name: 'Fiber, total dietary', unit: 'g', amount: null, trace: true },
            { name: 'Vitamin K (phylloquinone)', unit: 'µg', amount: '1.2', trace: false },
        ]);
    });

    it('stages a source-item citation and a label citation each in its own shape', () => {
        const brisketHeader = only(set.children.headers, (row) => row.foodId, rootOf('fdc:100').id);
        const saltHeader = only(set.children.headers, (row) => row.foodId, rootOf('curated:salt-blend').id);

        expect(only(set.children.citations, (row) => row.nutritionId, brisketHeader.id)).toMatchObject({
            dataset: 'usdaSrFoundation',
            externalKey: '100',
            match: 'exact',
            densityGPerMl: null,
            kcalFromKj: false,
            url: null,
            retrievedOn: null,
            manufacturer: null,
            servingLabel: null,
            servingGrams: null,
        });
        expect(only(set.children.citations, (row) => row.nutritionId, saltHeader.id)).toMatchObject({
            dataset: 'label',
            externalKey: null,
            match: null,
            densityGPerMl: null,
            kcalFromKj: false,
            url: LABEL.url,
            retrievedOn: '2026-09-30',
            manufacturer: 'Acme',
            servingLabel: '1/4 tsp',
            servingGrams: '0.8',
        });
    });

    it('writes each source row on its item with its lineage key, and points each portion and category at it', () => {
        const brisketItem = itemOf('fdc:100').id;
        const sourceOf = (key: string) =>
            only(set.children.sources, (row) => `${row.itemId}:${row.externalKey}`, `${brisketItem}:${key}`);

        expect(sourceOf('100')).toMatchObject({ source: 'usda', lineageKey: 'foundation:13023' });
        expect(sourceOf('17')).toMatchObject({ source: 'usda', lineageKey: null });
        expect(only(set.children.sourcePortions, (row) => row.label, 'oz')).toMatchObject({
            itemId: brisketItem,
            gramWeight: '28.35',
            sourceId: sourceOf('100').id,
        });
        expect(only(set.children.sourcePortions, (row) => row.label, 'cup').sourceId).toBe(sourceOf('17').id);
        expect(set.children.categories).toEqual([
            { itemId: brisketItem, name: 'Beef Products', sourceId: sourceOf('100').id },
            { itemId: brisketItem, name: 'Meats', sourceId: null },
        ]);
    });

    it('stages a cited portion by the citation it cites, which the apply finds through the item’s owner', () => {
        expect(set.children.citedPortions).toEqual([
            {
                id: set.children.citedPortions[0]?.id,
                itemId: itemOf('curated:salt-blend').id,
                label: '1/4 tsp',
                gramWeight: '0.8',
                dataset: 'label',
                externalKey: null,
                url: LABEL.url,
            },
        ]);
    });

    it('numbers a variant’s parts within each attribute, in the order the label reads', () => {
        expect(set.children.parts.map(({ attribute, ordinal, text }) => [attribute, ordinal, text])).toEqual([
            ['cut', 0, 'flat'],
            ['cut', 1, 'half'],
            ['cookingMethod', 0, 'braised'],
        ]);
        expect(set.children.parts.every((part) => part.variantId === set.variantInserts[0]?.id)).toBe(true);
    });

    it('names every dictionary entry the rows reference once, with the tag its definition carries', () => {
        expect(set.dictionary.nutrients.map(({ name, unit, infoodsTag }) => [name, unit, infoodsTag])).toEqual([
            ['Energy', 'kcal', 'ENERC_KCAL'],
            ['Fiber, total dietary', 'g', 'FIBTG'],
            ['Protein', 'g', 'PROCNT'],
            ['Sodium, Na', 'mg', null],
            ['Vitamin K (phylloquinone)', 'µg', null],
        ]);
        expect(set.dictionary.categories.map((row) => row.name)).toEqual(['Beef Products', 'Meats']);
    });

    it('replaces the children of every new item and the nutrition of every new owner, and deletes nothing', () => {
        expect([...set.children.itemIds].sort()).toEqual(set.itemInserts.map((row) => row.id).sort());
        expect(set.claims).toEqual([]);
        expect(set.releases).toEqual([]);
        expect(set.forwardDeletes).toEqual([]);
        expect(set.variantDeletes).toEqual([]);
        expect(set.rootDeletes).toEqual([]);
        expect(set.itemDeletes).toEqual([]);
        expect(set.forwardInserts).toEqual([]);
    });

    it('mints portion ids in the item’s portion order, so ORDER BY id reads them back in that order', () => {
        const ids = set.children.sourcePortions.map((row) => row.id);

        // The plan orders portions by provenance (source row `100` before `17`), then label.
        expect(set.children.sourcePortions.map((row) => row.label)).toEqual(['oz', 'cup']);
        expect([...ids].sort((left, right) => Number(left.slice(4)) - Number(right.slice(4)))).toEqual(ids);
    });
});

describe('resolveCatalogWriteSet — rows the catalog holds', () => {
    it('keeps every held id, and mints only for the rows the plan names with none', () => {
        const held = makeSnapshot(makeContent([BRISKET], [FLAT], [BRISKET_ITEM]));
        const { set } = resolve(makeContent([{ ...BRISKET, name: 'Beef Brisket, whole' }, CHICKEN], [FLAT]), held);

        expect(set.rootUpdates).toEqual([
            {
                id: 'id:fdc:100',
                seedKey: 'fdc:100',
                itemId: 'id:fdc:100',
                name: 'Beef Brisket, whole',
                normalizedName: 'beef brisket, whole',
                aliases: 'brisket; beef breast',
                restore: false,
            },
        ]);
        expect(set.rootInserts.map((row) => [row.seedKey, row.itemId])).toEqual([['fdc:200', set.itemInserts[0]?.id]]);
        expect(set.itemInserts).toEqual([{ id: 'new-1', naturalKey: 'fdc:200', ownerKind: 'root' }]);
        expect(set.children.itemIds).toEqual(['id:fdc:100', 'new-1']);
    });

    it('a merge deletes the absorbed root, reowns its item, and forwards it to the survivor’s held id', () => {
        const absorbed = makeContentVariant({ item: 'fdc:200', nutrition: makeNutrition('fdc:200') });
        const { set } = resolve(makeContent([BRISKET], [absorbed]), makeSnapshot(makeContent([BRISKET, CHICKEN])));

        expect(set.rootDeletes).toEqual(['id:fdc:200']);
        expect(set.itemReowns).toEqual([{ id: 'id:fdc:200', ownerKind: 'variant' }]);
        expect(set.variantInserts).toEqual([{ id: 'new-1', foodId: 'id:fdc:100', itemId: 'id:fdc:200' }]);
        expect(set.forwardInserts).toEqual([
            {
                sourceId: 'id:fdc:200',
                sourceKind: 'root',
                sourceKey: 'fdc:200',
                targetFoodId: 'id:fdc:100',
                targetVariantId: null,
            },
        ]);
        expect(set.children.nutritionOwners).toEqual({ rootIds: [], variantIds: ['new-1'] });
    });

    it('restores a root under the id its forward kept, and deletes that forward', () => {
        const afterMerge = makeSnapshot(
            makeContent([BRISKET], [makeContentVariant({ item: 'fdc:200', nutrition: makeNutrition('fdc:200') })]),
            {
                forwards: [
                    {
                        sourceId: 'chicken-root',
                        sourceKind: 'root',
                        sourceKey: 'fdc:200',
                        target: { kind: 'root', id: 'id:fdc:100' },
                    },
                ],
            },
        );
        const { set } = resolve(makeContent([BRISKET, CHICKEN]), afterMerge);

        expect(set.forwardDeletes).toEqual(['chicken-root']);
        expect(set.rootInserts.map((row) => [row.id, row.itemId])).toEqual([['chicken-root', 'id:fdc:200']]);
        expect(set.variantDeletes).toEqual(['id:fdc:200']);
        expect(set.forwardInserts).toEqual([
            {
                sourceId: 'id:fdc:200',
                sourceKind: 'variant',
                sourceKey: 'fdc:200',
                targetFoodId: 'chicken-root',
                targetVariantId: null,
            },
        ]);
    });

    it('a moved variant is deleted and inserted under its own id, with its parts and nutrition written again', () => {
        const held = makeSnapshot(makeContent([BRISKET, CHICKEN], [FLAT]));
        const { set } = resolve(makeContent([BRISKET, CHICKEN], [{ ...FLAT, root: 'fdc:200' }]), held);

        expect(set.variantDeletes).toEqual(['id:fdc:101']);
        expect(set.variantInserts).toEqual([{ id: 'id:fdc:101', foodId: 'id:fdc:200', itemId: 'id:fdc:101' }]);
        expect(set.children.partsVariantIds).toEqual(['id:fdc:101']);
        expect(set.children.parts.every((part) => part.variantId === 'id:fdc:101')).toBe(true);
        expect(set.children.headers.map((row) => row.variantId)).toEqual(['id:fdc:101']);
    });

    it('restores a retired root and a retired variant under their ids', () => {
        const retired = makeSnapshot(makeContent([CHICKEN]), { retired: makeContent([BRISKET], [FLAT]) });
        const { set } = resolve(makeContent([BRISKET, CHICKEN], [FLAT]), retired);

        expect(set.rootUpdates.map((row) => [row.id, row.restore])).toEqual([['id:fdc:100', true]]);
        expect(set.variantRestores).toEqual(['id:fdc:101']);
    });

    it('retires the rows whose key and item leave the seed', () => {
        const { set } = resolve(makeContent([CHICKEN]), makeSnapshot(makeContent([BRISKET, CHICKEN], [FLAT])));

        expect(set.rootRetires).toEqual(['id:fdc:100']);
        expect(set.variantRetires).toEqual(['id:fdc:101']);
    });

    it('carries a name claim and a key claim through as the ids and source rows they name', () => {
        const snapshot = makeSnapshot(makeContent([]), {
            liveNames: new Map([['beef brisket', 'live-1']]),
            liveSourceHolders: new Map([
                ['usda\u0000101', { foodId: 'live-2', authored: false, retired: false }],
                ['usda\u000017', { foodId: 'old-3', authored: false, retired: true }],
            ]),
        });
        const { set } = resolve(CATALOG, snapshot);

        expect(set.claims).toEqual(['live-1', 'live-2']);
        expect(set.releases).toEqual([
            { holderId: 'live-2', source: 'usda', externalKey: '101' },
            { holderId: 'old-3', source: 'usda', externalKey: '17' },
        ]);
        expect(set.forwardInserts).toEqual([
            {
                sourceId: 'live-1',
                sourceKind: 'root',
                sourceKey: null,
                targetFoodId: only(set.rootInserts, (row) => row.seedKey, 'fdc:100').id,
                targetVariantId: null,
            },
            {
                sourceId: 'live-2',
                sourceKind: 'root',
                sourceKey: null,
                targetFoodId: null,
                targetVariantId: set.variantInserts[0]?.id,
            },
        ]);
    });
});

describe('resolveCatalogWriteSet — a plan it cannot resolve', () => {
    const base = buildCatalogPlan(CATALOG, EMPTY_SNAPSHOT, NO_CHANGES);

    /**
     * The rule a resolution is refused by.
     *
     * @param plan - A corrupt plan.
     * @returns The rule.
     */
    function refusal(plan: CatalogPlan): string {
        try {
            resolveCatalogWriteSet(plan, EMPTY_SNAPSHOT.ids, counter());
        } catch (error) {
            if (isCatalogApplyError(error)) {
                return error.rule;
            }

            throw error;
        }

        throw new Error('expected the plan to be refused');
    }

    it('refuses a portion that cites a source row its own item does not have', () => {
        const [first, ...rest] = base.rows.itemChildren;
        const stray =
            first === undefined
                ? []
                : [
                      {
                          ...first,
                          portions: [
                              {
                                  label: 'lb',
                                  gramWeight: '453.6',
                                  source: { source: 'usda' as const, externalKey: '999' },
                              },
                          ],
                      },
                  ];

        expect(refusal({ ...base, rows: { ...base.rows, itemChildren: [...stray, ...rest] } })).toBe(
            'unresolvedSource',
        );
    });

    it('refuses an owner that no row the snapshot holds or the plan inserts stands for', () => {
        expect(
            refusal({
                ...base,
                rows: {
                    ...base.rows,
                    nutrition: [{ owner: { kind: 'root', key: 'fdc:777' }, nutrition: null }],
                },
            }),
        ).toBe('unresolvedOwner');
    });

    it('refuses an item no row the snapshot holds or the plan inserts stands for', () => {
        expect(
            refusal({
                ...base,
                rows: {
                    ...base.rows,
                    roots: {
                        ...base.rows.roots,
                        insert: base.rows.roots.insert.map((row) =>
                            row.seedKey === 'fdc:100' ? { ...row, item: 'fdc:777' as const } : row,
                        ),
                    },
                },
            }),
        ).toBe('unresolvedItem');
    });

    it('refuses a root update that names no held id', () => {
        expect(
            refusal({
                ...base,
                rows: {
                    ...base.rows,
                    roots: { ...base.rows.roots, update: [{ ...BRISKET, id: null, restore: false }] },
                },
            }),
        ).toBe('unresolvedOwner');
    });
});
