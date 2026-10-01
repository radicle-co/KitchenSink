/**
 * `buildCatalogPlan` (curated catalog plan U5, KTD-8, KTD-11): a pure planner from a target content and a snapshot to
 * a canonical plan. It reads no clock and mints no id: a row the snapshot holds keeps its id, and a new row is named by
 * its natural key with `id: null`.
 *
 * Every snapshot here names each row `id:<key>` (see the fixtures), so a reused id reads as one.
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
import { buildCatalogPlan, isEmptyPlan, type CatalogPlan } from '../catalogPlanBuilder.js';
import { isCatalogPlanRefusedError, type CatalogPlanIssue } from '../catalogPlanBuilder.errors.js';
import {
    EMPTY_SNAPSHOT,
    sourceRefKey,
    type CatalogContent,
    type CatalogSnapshot,
    type ContentItem,
    type ContentNutrition,
    type ContentRoot,
} from '../catalogSnapshot.js';
import type { CatalogChanges } from '../curatedSeedFormat.js';

const NO_CHANGES = makeCatalogChanges({ merges: [], aliases: [], exclusions: [], splits: [] });

const BRISKET = makeContentRoot();
const FLAT = makeContentVariant();
const CHICKEN = makeContentRoot({
    seedKey: 'fdc:200',
    name: 'chicken breast',
    item: 'fdc:200',
    nutrition: makeNutrition('fdc:200'),
});
const SAFFRON = makeContentRoot({
    seedKey: 'curated:saffron',
    name: 'saffron',
    item: 'curated:saffron',
    nutrition: null,
});

/**
 * Plan with no declared changes.
 *
 * @param target - The seed's content.
 * @param snapshot - The catalog.
 * @param changes - The declared changes.
 * @returns The plan.
 */
function plan(target: CatalogContent, snapshot: CatalogSnapshot, changes: CatalogChanges = NO_CHANGES): CatalogPlan {
    return buildCatalogPlan(target, snapshot, changes);
}

/**
 * Plan inputs that must be refused, and return the (rule, where) of every issue.
 *
 * @param build - The plan.
 * @returns The causes.
 */
function causesOf(build: () => unknown): Pick<CatalogPlanIssue, 'rule' | 'where'>[] {
    try {
        build();
    } catch (error) {
        if (isCatalogPlanRefusedError(error)) {
            return error.issues.map(({ rule, where }) => ({ rule, where }));
        }

        throw error;
    }

    throw new Error('expected the plan to be refused');
}

describe('buildCatalogPlan — an empty catalog', () => {
    const target = makeContent([BRISKET, SAFFRON], [FLAT]);
    const built = plan(target, EMPTY_SNAPSHOT);

    it('inserts every root, variant and item with no id, so only the apply mints one', () => {
        expect(built.rows.roots.insert).toEqual([
            {
                id: null,
                seedKey: 'curated:saffron',
                name: 'saffron',
                synonyms: [],
                item: 'curated:saffron',
                restore: false,
            },
            { id: null, seedKey: 'fdc:100', name: 'beef brisket', synonyms: [], item: 'fdc:100', restore: false },
        ]);
        expect(built.rows.variants.insert).toEqual([{ id: null, item: 'fdc:101', root: 'fdc:100' }]);
        expect(built.rows.items.insert).toEqual([
            { key: 'curated:saffron', ownerKind: 'root' },
            { key: 'fdc:100', ownerKind: 'root' },
            { key: 'fdc:101', ownerKind: 'variant' },
        ]);
    });

    it('writes every item’s children, every owner’s nutrition (none for a no-numbers root) and every variant’s parts', () => {
        expect(built.rows.itemChildren.map((item) => item.key)).toEqual(['curated:saffron', 'fdc:100', 'fdc:101']);
        expect(built.rows.nutrition).toEqual([
            { owner: { kind: 'root', key: 'fdc:100' }, nutrition: BRISKET.nutrition },
            { owner: { kind: 'variant', key: 'fdc:101' }, nutrition: FLAT.nutrition },
        ]);
        expect(built.rows.parts).toEqual([{ item: 'fdc:101', parts: FLAT.parts }]);
    });

    it('records no forward and touches no existing row', () => {
        expect(built.rows.forwards).toEqual({ delete: [], insert: [] });
        expect(built.rows.roots.update).toEqual([]);
        expect(built.rows.roots.retire).toEqual([]);
        expect(built.rows.roots.delete).toEqual([]);
        expect(built.rows.items.delete).toEqual([]);
    });

    it('describes the change as roots and variants added', () => {
        expect(built.changes).toEqual([
            { kind: 'rootAdded', seedKey: 'curated:saffron', name: 'saffron' },
            { kind: 'rootAdded', seedKey: 'fdc:100', name: 'beef brisket' },
            { kind: 'variantAdded', item: 'fdc:101', root: 'fdc:100' },
        ]);
    });
});

describe('buildCatalogPlan — a catalog that already holds the seed', () => {
    it('plans nothing', () => {
        const target = makeContent([BRISKET, SAFFRON], [FLAT]);
        const built = plan(target, makeSnapshot(target));

        expect(isEmptyPlan(built)).toBe(true);
        expect(built.changes).toEqual([]);
    });

    it('ignores the order an adapter lists children in: a re-ordered value list is the same nutrition', () => {
        const values = [
            { name: 'Protein', unit: 'g', amount: '21.5' },
            { name: 'Energy', unit: 'kcal', amount: '155' },
        ];
        const nutrition = { ...makeNutrition('fdc:100'), values };
        const target = makeContent([makeContentRoot({ nutrition })]);
        const snapshot = makeSnapshot(
            makeContent([makeContentRoot({ nutrition: { ...nutrition, values: [...values].reverse() } })]),
        );

        expect(isEmptyPlan(plan(target, snapshot))).toBe(true);
    });
});

describe('buildCatalogPlan — a kept root (AE4)', () => {
    it('a rename keeps the root’s id and writes its new name', () => {
        const built = plan(makeContent([{ ...BRISKET, name: 'brisket' }]), makeSnapshot(makeContent([BRISKET])));

        expect(built.rows.roots.update).toEqual([
            { id: 'id:fdc:100', seedKey: 'fdc:100', name: 'brisket', synonyms: [], item: 'fdc:100', restore: false },
        ]);
        expect(built.rows.roots.insert).toEqual([]);
        expect(built.changes).toEqual([
            { kind: 'rootRenamed', seedKey: 'fdc:100', from: 'beef brisket', to: 'brisket' },
        ]);
    });

    it('a synonym change writes the root and says so', () => {
        const built = plan(makeContent([{ ...BRISKET, synonyms: ['brisket'] }]), makeSnapshot(makeContent([BRISKET])));

        expect(built.rows.roots.update).toHaveLength(1);
        expect(built.changes).toEqual([{ kind: 'rootSynonymsChanged', seedKey: 'fdc:100', from: [], to: ['brisket'] }]);
    });

    it('replaces only the children that differ: one item’s portions, one owner’s values', () => {
        const portioned: ContentItem = makeContentItem('fdc:200', {
            portions: [{ label: 'cup', gramWeight: '140', source: { source: 'usda', externalKey: '200' } }],
        });
        const target = makeContent(
            [BRISKET, { ...CHICKEN, nutrition: makeNutrition('fdc:200', '31') }],
            [FLAT],
            [portioned],
        );
        const built = plan(target, makeSnapshot(makeContent([BRISKET, CHICKEN], [FLAT])));

        expect(built.rows.itemChildren).toEqual([portioned]);
        expect(built.rows.nutrition).toEqual([
            { owner: { kind: 'root', key: 'fdc:200' }, nutrition: makeNutrition('fdc:200', '31') },
        ]);
        expect(built.rows.parts).toEqual([]);
        expect(built.changes).toEqual([
            { kind: 'itemChanged', item: 'fdc:200' },
            { kind: 'nutritionValuesChanged', owner: { kind: 'root', key: 'fdc:200' } },
        ]);
    });

    it('replaces an item whose popularity source alone changed: a new survey cycle is a source fact', () => {
        const weighed = (source: string): ContentItem =>
            makeContentItem('fdc:100', { popularity: { weight: '40000.1', priorFraction: '0.5', source } });
        const recycled = weighed('fndds-2023-2025+nhanes-2023-2025-day1');
        const built = plan(
            makeContent([BRISKET], [], [recycled]),
            makeSnapshot(makeContent([BRISKET], [], [weighed('fndds-2021-2023+nhanes-2021-2023-day1')])),
        );

        expect(built.rows.itemChildren).toEqual([recycled]);
        expect(built.changes).toEqual([{ kind: 'itemChanged', item: 'fdc:100' }]);
    });

    it('replaces an item whose categories alone changed, in any order', () => {
        const usda = { source: 'usda' as const, externalKey: '100' };
        const categorized = makeContentItem('fdc:100', {
            categories: [
                { name: 'Beef Products', source: usda },
                { name: 'Meats', source: null },
            ],
        });
        const reordered = makeContentItem('fdc:100', { categories: [...categorized.categories].reverse() });
        const built = plan(makeContent([BRISKET], [], [categorized]), makeSnapshot(makeContent([BRISKET])));

        expect(built.rows.itemChildren).toEqual([categorized]);
        expect(built.changes).toEqual([{ kind: 'itemChanged', item: 'fdc:100' }]);
        expect(
            isEmptyPlan(
                plan(makeContent([BRISKET], [], [reordered]), makeSnapshot(makeContent([BRISKET], [], [categorized]))),
            ),
        ).toBe(true);
    });

    it('a serving change alone replaces the item holding its cited portion and is an item change (OQ-1)', () => {
        const citation = makeNutrition('fdc:100').citation;
        const served = (grams: string): ContentItem =>
            makeContentItem('fdc:100', { portions: [{ label: '1 ONZ', gramWeight: grams, citation }] });
        const built = plan(
            makeContent([BRISKET], [], [served('30')]),
            makeSnapshot(makeContent([BRISKET], [], [served('28')])),
        );

        expect(isEmptyPlan(built)).toBe(false);
        expect(built.rows.itemChildren).toEqual([served('30')]);
        expect(built.rows.nutrition).toEqual([]);
        expect(built.changes).toEqual([{ kind: 'itemChanged', item: 'fdc:100' }]);
    });

    it('a nutrition rewrite also replaces the item’s cited portion, which the citation’s delete cascades away', () => {
        const citation = makeNutrition('fdc:100').citation;
        const served = makeContentItem('fdc:100', { portions: [{ label: '1 ONZ', gramWeight: '28', citation }] });
        const reweighed: ContentRoot = { ...BRISKET, nutrition: makeNutrition('fdc:100', '22') };
        const built = plan(makeContent([reweighed], [], [served]), makeSnapshot(makeContent([BRISKET], [], [served])));

        expect(built.rows.nutrition).toEqual([
            { owner: { kind: 'root', key: 'fdc:100' }, nutrition: reweighed.nutrition },
        ]);
        expect(built.rows.itemChildren).toEqual([served]);
        expect(built.changes).toEqual([{ kind: 'nutritionValuesChanged', owner: { kind: 'root', key: 'fdc:100' } }]);
    });

    it('a nutrition rewrite leaves an item with no cited portion alone', () => {
        const reweighed: ContentRoot = { ...BRISKET, nutrition: makeNutrition('fdc:100', '22') };
        const built = plan(makeContent([reweighed]), makeSnapshot(makeContent([BRISKET])));

        expect(built.rows.itemChildren).toEqual([]);
    });

    it('a citation change is its own change, so the diff can show a tier a person graded (KTD-22)', () => {
        const cited = makeNutrition('fdc:100');
        const regraded = { ...cited, citation: { ...cited.citation, match: 'close' as const } };
        const built = plan(makeContent([{ ...BRISKET, nutrition: regraded }]), makeSnapshot(makeContent([BRISKET])));

        expect(built.changes).toEqual([
            {
                kind: 'citationChanged',
                owner: { kind: 'root', key: 'fdc:100' },
                from: cited.citation,
                to: regraded.citation,
            },
        ]);
        expect(built.rows.nutrition).toEqual([{ owner: { kind: 'root', key: 'fdc:100' }, nutrition: regraded }]);
    });

    it('a variant’s new parts are rewritten under its kept id', () => {
        const relabelled = { ...FLAT, parts: [{ attribute: 'cut' as const, text: 'first cut' }] };
        const built = plan(makeContent([BRISKET], [relabelled]), makeSnapshot(makeContent([BRISKET], [FLAT])));

        expect(built.rows.parts).toEqual([{ item: 'fdc:101', parts: relabelled.parts }]);
        expect(built.rows.variants).toEqual({ insert: [], restore: [], retire: [], delete: [] });
        expect(built.changes).toEqual([
            { kind: 'variantPartsChanged', item: 'fdc:101', from: FLAT.parts, to: relabelled.parts },
        ]);
    });
});

describe('buildCatalogPlan — retire and restore (KTD-8, R33)', () => {
    it('retires a root whose key and item leave the seed, keeping its item and adding no forward', () => {
        const built = plan(makeContent([BRISKET]), makeSnapshot(makeContent([BRISKET, CHICKEN])));

        expect(built.rows.roots.retire).toEqual([{ id: 'id:fdc:200', key: 'fdc:200' }]);
        expect(built.rows.roots.delete).toEqual([]);
        expect(built.rows.items.delete).toEqual([]);
        expect(built.rows.forwards).toEqual({ delete: [], insert: [] });
        expect(built.changes).toEqual([{ kind: 'rootRetired', seedKey: 'fdc:200', name: 'chicken breast' }]);
    });

    it('retires a variant whose item leaves the seed', () => {
        const built = plan(makeContent([BRISKET]), makeSnapshot(makeContent([BRISKET], [FLAT])));

        expect(built.rows.variants.retire).toEqual([{ id: 'id:fdc:101', key: 'fdc:101' }]);
        expect(built.changes).toEqual([{ kind: 'variantRetired', item: 'fdc:101', root: 'fdc:100' }]);
    });

    it('refuses to retire a root a forward resolves to', () => {
        const snapshot = makeSnapshot(makeContent([BRISKET, CHICKEN]), {
            forwards: [
                { sourceId: 'live-1', sourceKind: 'root', sourceKey: null, target: { kind: 'root', id: 'id:fdc:200' } },
            ],
        });

        expect(causesOf(() => plan(makeContent([BRISKET]), snapshot))).toEqual([
            { rule: 'forwardStranded', where: 'fdc:200' },
        ]);
    });

    it('restores a retired root under its old id, rewriting only what changed', () => {
        const snapshot = makeSnapshot(makeContent([BRISKET]), { retired: makeContent([CHICKEN]) });
        const built = plan(makeContent([BRISKET, CHICKEN]), snapshot);

        expect(built.rows.roots.update).toEqual([
            {
                id: 'id:fdc:200',
                seedKey: 'fdc:200',
                name: 'chicken breast',
                synonyms: [],
                item: 'fdc:200',
                restore: true,
            },
        ]);
        expect(built.rows.roots.insert).toEqual([]);
        expect(built.rows.items.insert).toEqual([]);
        expect(built.rows.nutrition).toEqual([]);
        expect(built.changes).toEqual([{ kind: 'rootRestored', seedKey: 'fdc:200', name: 'chicken breast' }]);
    });

    it('restores a retired variant under its old id', () => {
        const snapshot = makeSnapshot(makeContent([BRISKET]), { retired: makeContent([], [FLAT]) });
        const built = plan(makeContent([BRISKET], [FLAT]), snapshot);

        expect(built.rows.variants.restore).toEqual([{ id: 'id:fdc:101', key: 'fdc:101' }]);
        expect(built.rows.variants.insert).toEqual([]);
        expect(built.changes).toEqual([{ kind: 'variantRestored', item: 'fdc:101', root: 'fdc:100' }]);
    });

    it('restores a deleted root under the id its forward kept, and deletes that forward', () => {
        const snapshot = makeSnapshot(makeContent([BRISKET]), {
            forwards: [
                {
                    sourceId: 'old-chicken',
                    sourceKind: 'root',
                    sourceKey: 'fdc:200',
                    target: { kind: 'root', id: 'id:fdc:100' },
                },
            ],
        });
        const built = plan(makeContent([BRISKET, CHICKEN]), snapshot);

        expect(built.rows.roots.insert).toEqual([
            {
                id: 'old-chicken',
                seedKey: 'fdc:200',
                name: 'chicken breast',
                synonyms: [],
                item: 'fdc:200',
                restore: false,
            },
        ]);
        expect(built.rows.forwards).toEqual({ delete: ['old-chicken'], insert: [] });
        expect(built.rows.nutrition).toEqual([
            { owner: { kind: 'root', key: 'fdc:200' }, nutrition: CHICKEN.nutrition },
        ]);
        expect(built.changes).toEqual([{ kind: 'rootRestored', seedKey: 'fdc:200', name: 'chicken breast' }]);
    });

    it('moves a variant to another root by deleting and re-inserting it under the same id, with its children', () => {
        const target = makeContent([BRISKET, CHICKEN], [{ ...FLAT, root: 'fdc:200' }]);
        const built = plan(target, makeSnapshot(makeContent([BRISKET, CHICKEN], [FLAT])));

        expect(built.rows.variants.delete).toEqual([{ id: 'id:fdc:101', key: 'fdc:101' }]);
        expect(built.rows.variants.insert).toEqual([{ id: 'id:fdc:101', item: 'fdc:101', root: 'fdc:200' }]);
        expect(built.rows.nutrition).toEqual([
            { owner: { kind: 'variant', key: 'fdc:101' }, nutrition: FLAT.nutrition },
        ]);
        expect(built.rows.parts).toEqual([{ item: 'fdc:101', parts: FLAT.parts }]);
        expect(built.changes).toEqual([{ kind: 'variantMoved', item: 'fdc:101', from: 'fdc:100', to: 'fdc:200' }]);
    });
});

describe('buildCatalogPlan — refusals', () => {
    it('refuses a source row a live, non-seed item holds (Q1)', () => {
        const snapshot = makeSnapshot(makeContent([BRISKET]), {
            liveSourceKeys: new Set([sourceRefKey({ source: 'usda', externalKey: '200' })]),
        });

        expect(causesOf(() => plan(makeContent([BRISKET, CHICKEN]), snapshot))).toEqual([
            { rule: 'liveSourceHeld', where: 'fdc:200' },
        ]);
    });

    /**
     * Rewritten for slice 3, which plans declared changes: a declaration carries no authority of its own. Where the
     * structure does not move the absorbed root's item, the root is retired, as any root whose item leaves is; U1's
     * format check is what refuses a merge with no variant (`mergeWithoutVariant`).
     */
    it('a declared merge the structure does not carry out plans as the structure says: a retirement', () => {
        const changes = makeCatalogChanges({
            merges: [{ from: 'fdc:200', into: 'fdc:100' }],
            aliases: [],
            exclusions: [],
            splits: [],
        });
        const built = plan(makeContent([BRISKET]), makeSnapshot(makeContent([BRISKET, CHICKEN])), changes);

        expect(built.rows.roots.retire).toEqual([{ id: 'id:fdc:200', key: 'fdc:200' }]);
        expect(built.rows.forwards.insert).toEqual([]);
    });

    it('a declared merge whose root the snapshot never held is a no-op, as on a template0 database', () => {
        const changes = makeCatalogChanges({
            merges: [{ from: 'fdc:999', into: 'fdc:100' }],
            aliases: [],
            exclusions: [],
            splits: [],
        });

        expect(plan(makeContent([BRISKET]), EMPTY_SNAPSHOT, changes).rows.roots.insert).toHaveLength(1);
    });
});

describe('buildCatalogPlan — declared changes, by structure (KTD-8, R41)', () => {
    const POINT = makeContentVariant({
        item: 'fdc:102',
        parts: [{ attribute: 'cut', text: 'point' }],
        nutrition: makeNutrition('fdc:102'),
    });

    it('a merge deletes the absorbed root, makes its item a variant of the survivor with its numbers, and forwards (AE7)', () => {
        const absorbedAsVariant = makeContentVariant({
            item: 'fdc:200',
            root: 'fdc:100',
            nutrition: CHICKEN.nutrition ?? makeNutrition('fdc:200'),
        });
        const built = plan(makeContent([BRISKET], [absorbedAsVariant]), makeSnapshot(makeContent([BRISKET, CHICKEN])));

        expect(built.rows.roots.delete).toEqual([{ id: 'id:fdc:200', key: 'fdc:200' }]);
        expect(built.rows.variants.insert).toEqual([{ id: null, item: 'fdc:200', root: 'fdc:100' }]);
        expect(built.rows.items).toEqual({
            insert: [],
            reown: [{ id: 'id:fdc:200', key: 'fdc:200', ownerKind: 'variant' }],
            delete: [],
        });
        expect(built.rows.nutrition).toEqual([
            { owner: { kind: 'variant', key: 'fdc:200' }, nutrition: absorbedAsVariant.nutrition },
        ]);
        expect(built.rows.forwards).toEqual({
            delete: [],
            insert: [
                {
                    sourceId: 'id:fdc:200',
                    sourceKind: 'root',
                    sourceKey: 'fdc:200',
                    target: { kind: 'root', key: 'fdc:100' },
                },
            ],
        });
        expect(built.changes).toEqual([
            {
                kind: 'rootRemoved',
                seedKey: 'fdc:200',
                name: 'chicken breast',
                reason: 'merged',
                to: { kind: 'root', key: 'fdc:100' },
            },
            { kind: 'variantAdded', item: 'fdc:200', root: 'fdc:100' },
        ]);
    });

    it('a merge carries the absorbed root’s own variants to the survivor under their ids', () => {
        const chickenTender = makeContentVariant({
            item: 'fdc:201',
            root: 'fdc:200',
            nutrition: makeNutrition('fdc:201'),
        });
        const target = makeContent(
            [BRISKET],
            [
                { ...chickenTender, root: 'fdc:100' },
                makeContentVariant({ item: 'fdc:200', nutrition: makeNutrition('fdc:200') }),
            ],
        );
        const built = plan(target, makeSnapshot(makeContent([BRISKET, CHICKEN], [chickenTender])));

        expect(built.rows.variants.delete).toEqual([{ id: 'id:fdc:201', key: 'fdc:201' }]);
        expect(built.rows.variants.insert).toEqual([
            { id: null, item: 'fdc:200', root: 'fdc:100' },
            { id: 'id:fdc:201', item: 'fdc:201', root: 'fdc:100' },
        ]);
    });

    it('a split gives the new root a new key and forwards the promoted variant to it, keeping the original root', () => {
        const changes = makeCatalogChanges({
            merges: [],
            aliases: [],
            exclusions: [],
            splits: [{ from: 'fdc:100', newKey: 'fdc:102', items: ['fdc:102'] }],
        });
        const pointRoot = makeContentRoot({
            seedKey: 'fdc:102',
            name: 'brisket point',
            item: 'fdc:102',
            nutrition: makeNutrition('fdc:102'),
        });
        const built = plan(
            makeContent([BRISKET, pointRoot], [FLAT]),
            makeSnapshot(makeContent([BRISKET], [FLAT, POINT])),
            changes,
        );

        expect(built.rows.roots.insert).toEqual([
            { id: null, seedKey: 'fdc:102', name: 'brisket point', synonyms: [], item: 'fdc:102', restore: false },
        ]);
        expect(built.rows.roots.update).toEqual([]);
        expect(built.rows.variants.delete).toEqual([{ id: 'id:fdc:102', key: 'fdc:102' }]);
        expect(built.rows.items.reown).toEqual([{ id: 'id:fdc:102', key: 'fdc:102', ownerKind: 'root' }]);
        expect(built.rows.forwards.insert).toEqual([
            {
                sourceId: 'id:fdc:102',
                sourceKind: 'variant',
                sourceKey: 'fdc:102',
                target: { kind: 'root', key: 'fdc:102' },
            },
        ]);
        expect(built.changes).toEqual([
            { kind: 'rootSplit', seedKey: 'fdc:102', name: 'brisket point', from: 'fdc:100' },
            {
                kind: 'variantRemoved',
                item: 'fdc:102',
                root: 'fdc:100',
                reason: 'promoted',
                to: { kind: 'root', key: 'fdc:102' },
            },
        ]);
    });

    it('an alias deletes the absorbed root and its item, forwards it to the owner of `of`, and moves the source row', () => {
        const flourWithAlias = makeContentItem('fdc:100', {
            sources: [
                { source: 'usda', externalKey: '100' },
                { source: 'usda', externalKey: '200' },
            ],
        });
        const built = plan(makeContent([BRISKET], [], [flourWithAlias]), makeSnapshot(makeContent([BRISKET, CHICKEN])));

        expect(built.rows.roots.delete).toEqual([{ id: 'id:fdc:200', key: 'fdc:200' }]);
        expect(built.rows.items.delete).toEqual([{ id: 'id:fdc:200', key: 'fdc:200' }]);
        expect(built.rows.itemChildren).toEqual([flourWithAlias]);
        expect(built.rows.forwards.insert).toEqual([
            {
                sourceId: 'id:fdc:200',
                sourceKind: 'root',
                sourceKey: 'fdc:200',
                target: { kind: 'root', key: 'fdc:100' },
            },
        ]);
        expect(built.changes).toEqual([
            {
                kind: 'rootRemoved',
                seedKey: 'fdc:200',
                name: 'chicken breast',
                reason: 'aliased',
                to: { kind: 'root', key: 'fdc:100' },
            },
            { kind: 'itemChanged', item: 'fdc:100' },
        ]);
    });

    it('a root that gains a USDA item keeps its key and id, drops its sourceless item, and the displaced owner forwards', () => {
        const gained = { ...SAFFRON, item: 'fdc:200' as const, nutrition: makeNutrition('fdc:200') };
        const built = plan(makeContent([gained]), makeSnapshot(makeContent([SAFFRON, CHICKEN])));

        expect(built.rows.roots.update).toEqual([
            {
                id: 'id:curated:saffron',
                seedKey: 'curated:saffron',
                name: 'saffron',
                synonyms: [],
                item: 'fdc:200',
                restore: false,
            },
        ]);
        expect(built.rows.roots.delete).toEqual([{ id: 'id:fdc:200', key: 'fdc:200' }]);
        expect(built.rows.items.delete).toEqual([{ id: 'id:curated:saffron', key: 'curated:saffron' }]);
        expect(built.rows.forwards.insert).toEqual([
            {
                sourceId: 'id:fdc:200',
                sourceKind: 'root',
                sourceKey: 'fdc:200',
                target: { kind: 'root', key: 'curated:saffron' },
            },
        ]);
        expect(built.changes).toEqual([
            { kind: 'rootItemChanged', seedKey: 'curated:saffron', from: 'curated:saffron', to: 'fdc:200' },
            {
                kind: 'rootRemoved',
                seedKey: 'fdc:200',
                name: 'chicken breast',
                reason: 'displaced',
                to: { kind: 'root', key: 'curated:saffron' },
            },
            {
                kind: 'citationChanged',
                owner: { kind: 'root', key: 'curated:saffron' },
                from: null,
                to: gained.nutrition.citation,
            },
            { kind: 'nutritionValuesChanged', owner: { kind: 'root', key: 'curated:saffron' } },
        ]);
    });

    it('a root whose item becomes a variant’s item: the displaced variant forwards to the root', () => {
        const target = makeContent([{ ...BRISKET, item: 'fdc:101', nutrition: makeNutrition('fdc:101') }]);
        const built = plan(target, makeSnapshot(makeContent([BRISKET], [FLAT])));

        expect(built.rows.variants.delete).toEqual([{ id: 'id:fdc:101', key: 'fdc:101' }]);
        expect(built.rows.items.reown).toEqual([{ id: 'id:fdc:101', key: 'fdc:101', ownerKind: 'root' }]);
        expect(built.rows.items.delete).toEqual([{ id: 'id:fdc:100', key: 'fdc:100' }]);
        expect(built.rows.forwards.insert).toEqual([
            {
                sourceId: 'id:fdc:101',
                sourceKind: 'variant',
                sourceKey: 'fdc:101',
                target: { kind: 'root', key: 'fdc:100' },
            },
        ]);
    });

    it('retargets a forward whose target the plan deletes to that target’s own destination', () => {
        const snapshot = makeSnapshot(makeContent([BRISKET, CHICKEN]), {
            forwards: [
                { sourceId: 'live-9', sourceKind: 'root', sourceKey: null, target: { kind: 'root', id: 'id:fdc:200' } },
            ],
        });
        const absorbed = makeContentVariant({ item: 'fdc:200', nutrition: makeNutrition('fdc:200') });
        const built = plan(makeContent([BRISKET], [absorbed]), snapshot);

        expect(built.rows.forwards).toEqual({
            delete: ['live-9'],
            insert: [
                {
                    sourceId: 'id:fdc:200',
                    sourceKind: 'root',
                    sourceKey: 'fdc:200',
                    target: { kind: 'root', key: 'fdc:100' },
                },
                { sourceId: 'live-9', sourceKind: 'root', sourceKey: null, target: { kind: 'root', key: 'fdc:100' } },
            ],
        });
    });

    it('refuses to retire a variant under a root the plan deletes', () => {
        const chickenTender = makeContentVariant({
            item: 'fdc:201',
            root: 'fdc:200',
            nutrition: makeNutrition('fdc:201'),
        });
        const absorbed = makeContentVariant({ item: 'fdc:200', nutrition: makeNutrition('fdc:200') });

        expect(
            causesOf(() =>
                plan(
                    makeContent([BRISKET], [absorbed]),
                    makeSnapshot(makeContent([BRISKET, CHICKEN], [chickenTender])),
                ),
            ),
        ).toEqual([{ rule: 'retiredVariantLosesRoot', where: 'fdc:201' }]);
    });
});

describe('buildCatalogPlan — the live-name exception (KTD-12)', () => {
    it('retires a live, unauthored food whose name a seed root claims, and forwards it and its forwards to the root', () => {
        const snapshot = makeSnapshot(makeContent([]), {
            liveNames: new Map([['beef brisket', 'live-7']]),
            forwards: [
                { sourceId: 'live-3', sourceKind: 'root', sourceKey: null, target: { kind: 'root', id: 'live-7' } },
            ],
        });
        const built = plan(makeContent([{ ...BRISKET, name: 'Beef Brisket' }]), snapshot);

        expect(built.rows.claims).toEqual([{ id: 'live-7', by: 'fdc:100' }]);
        expect(built.rows.forwards).toEqual({
            delete: ['live-3'],
            insert: [
                { sourceId: 'live-3', sourceKind: 'root', sourceKey: null, target: { kind: 'root', key: 'fdc:100' } },
                { sourceId: 'live-7', sourceKind: 'root', sourceKey: null, target: { kind: 'root', key: 'fdc:100' } },
            ],
        });
        expect(built.changes).toContainEqual({ kind: 'liveFoodClaimed', id: 'live-7', seedKey: 'fdc:100' });
    });

    it('claims nothing when no live food holds the name', () => {
        expect(plan(makeContent([BRISKET]), EMPTY_SNAPSHOT).rows.claims).toEqual([]);
    });
});

describe('buildCatalogPlan — an older seed over a newer one restores every id (R33)', () => {
    const SEED_A = makeContent([BRISKET, CHICKEN]);
    const SEED_B = makeContent(
        [BRISKET],
        [makeContentVariant({ item: 'fdc:200', nutrition: makeNutrition('fdc:200') })],
    );

    it('B merged A’s chicken root; A again restores the root under its forwarded id and forwards the variant to it', () => {
        const afterB = makeSnapshot(SEED_B, {
            forwards: [
                {
                    sourceId: 'chicken-root',
                    sourceKind: 'root',
                    sourceKey: 'fdc:200',
                    target: { kind: 'root', id: 'id:fdc:100' },
                },
            ],
        });
        const built = plan(SEED_A, afterB);

        expect(built.rows.roots.insert).toEqual([
            {
                id: 'chicken-root',
                seedKey: 'fdc:200',
                name: 'chicken breast',
                synonyms: [],
                item: 'fdc:200',
                restore: false,
            },
        ]);
        expect(built.rows.variants.delete).toEqual([{ id: 'id:fdc:200', key: 'fdc:200' }]);
        expect(built.rows.items.reown).toEqual([{ id: 'id:fdc:200', key: 'fdc:200', ownerKind: 'root' }]);
        expect(built.rows.forwards).toEqual({
            delete: ['chicken-root'],
            insert: [
                {
                    sourceId: 'id:fdc:200',
                    sourceKind: 'variant',
                    sourceKey: 'fdc:200',
                    target: { kind: 'root', key: 'fdc:200' },
                },
            ],
        });
    });

    it('and B again re-merges under the variant’s forwarded id, so no key is ever minted twice', () => {
        const afterA = makeSnapshot(SEED_A, {
            forwards: [
                {
                    sourceId: 'chicken-variant',
                    sourceKind: 'variant',
                    sourceKey: 'fdc:200',
                    target: { kind: 'root', id: 'id:fdc:200' },
                },
            ],
        });
        const built = plan(SEED_B, afterA);

        expect(built.rows.variants.insert).toEqual([{ id: 'chicken-variant', item: 'fdc:200', root: 'fdc:100' }]);
        expect(built.rows.roots.delete).toEqual([{ id: 'id:fdc:200', key: 'fdc:200' }]);
        expect(built.rows.forwards.delete).toEqual(['chicken-variant']);
    });
});

describe('buildCatalogPlan — an aliased root comes back (R33)', () => {
    it('restores the aliased root under its forwarded id, mints its item again, and takes the alias row off its host', () => {
        const hostWithAlias = makeContentItem('fdc:100', {
            sources: [
                { source: 'usda', externalKey: '100' },
                { source: 'usda', externalKey: '200' },
            ],
        });
        const afterAlias = makeSnapshot(makeContent([BRISKET], [], [hostWithAlias]), {
            forwards: [
                {
                    sourceId: 'chicken-root',
                    sourceKind: 'root',
                    sourceKey: 'fdc:200',
                    target: { kind: 'root', id: 'id:fdc:100' },
                },
            ],
        });
        const built = plan(makeContent([BRISKET, CHICKEN]), afterAlias);

        expect(built.rows.roots.insert).toEqual([
            {
                id: 'chicken-root',
                seedKey: 'fdc:200',
                name: 'chicken breast',
                synonyms: [],
                item: 'fdc:200',
                restore: false,
            },
        ]);
        expect(built.rows.items.insert).toEqual([{ key: 'fdc:200', ownerKind: 'root' }]);
        expect(built.rows.itemChildren.map((item) => item.key)).toEqual(['fdc:100', 'fdc:200']);
        expect(built.rows.forwards).toEqual({ delete: ['chicken-root'], insert: [] });
    });
});

describe('buildCatalogPlan — canonical (KTD-11)', () => {
    /**
     * The same content with every map built in reverse order.
     *
     * @param content - Content.
     * @returns Equal content, inserted backwards, with every child list backwards too.
     */
    function reversed(content: CatalogContent): CatalogContent {
        const flip = (nutrition: ContentNutrition | null): ContentNutrition | null =>
            nutrition === null ? null : { ...nutrition, values: [...nutrition.values].reverse() };

        return {
            roots: new Map(
                [...content.roots].reverse().map(([key, root]) => [key, { ...root, nutrition: flip(root.nutrition) }]),
            ),
            variants: new Map(
                [...content.variants]
                    .reverse()
                    .map(([key, variant]) => [
                        key,
                        { ...variant, nutrition: flip(variant.nutrition) ?? variant.nutrition },
                    ]),
            ),
            items: new Map(
                [...content.items]
                    .reverse()
                    .map(([key, item]) => [
                        key,
                        { ...item, sources: [...item.sources].reverse(), portions: [...item.portions].reverse() },
                    ]),
            ),
        };
    }

    /**
     * The same content with every map rotated by one.
     *
     * @param content - Content.
     * @returns Equal content, inserted from its second entry.
     */
    function rotated(content: CatalogContent): CatalogContent {
        const rotate = <Entry>(entries: Entry[]): Entry[] => [...entries.slice(1), ...entries.slice(0, 1)];

        return {
            roots: new Map(rotate([...content.roots])),
            variants: new Map(rotate([...content.variants])),
            items: new Map(rotate([...content.items])),
        };
    }

    it('gives the same plan, nutrition included, for the same inputs in any order', () => {
        const twoValues = (item: `fdc:${string}`, protein: string): ContentNutrition => ({
            ...makeNutrition(item, protein),
            values: [
                { name: 'Energy', unit: 'kcal', amount: '155' },
                { name: 'Protein', unit: 'g', amount: protein },
            ],
        });
        const pork = makeContentRoot({
            seedKey: 'fdc:300',
            name: 'pork',
            item: 'fdc:300',
            nutrition: twoValues('fdc:300', '9'),
        });
        const porkItem = makeContentItem('fdc:300', {
            sources: [
                { source: 'usda', externalKey: '300' },
                { source: 'usda', externalKey: '301' },
            ],
            portions: [
                { label: 'chop', gramWeight: '90', source: { source: 'usda', externalKey: '300' } },
                { label: 'oz', gramWeight: '28.35', source: { source: 'usda', externalKey: '301' } },
            ],
        });
        const target = makeContent(
            [{ ...BRISKET, name: 'brisket' }, { ...CHICKEN, nutrition: twoValues('fdc:200', '31') }, SAFFRON, pork],
            [FLAT],
            [porkItem],
        );
        const live = makeContent(
            [BRISKET, makeContentRoot({ seedKey: 'fdc:400', name: 'veal', item: 'fdc:400' })],
            [FLAT],
        );
        const retired = makeContent([{ ...CHICKEN, nutrition: makeNutrition('fdc:200', '1') }]);
        const forwards = [
            {
                sourceId: 'old-pork',
                sourceKind: 'root' as const,
                sourceKey: 'fdc:300',
                target: { kind: 'root' as const, id: 'id:fdc:100' },
            },
        ];
        const reference = plan(target, makeSnapshot(live, { retired, forwards }));

        for (const order of [reversed, rotated]) {
            expect(plan(order(target), makeSnapshot(order(live), { retired: order(retired), forwards }))).toEqual(
                reference,
            );
        }

        expect(reference.changes.length).toBeGreaterThan(3);
    });
});
