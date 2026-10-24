/**
 * The committed curated seed projects and plans (curated catalog plan U5, KTD-11): the real pinned archives and the
 * real committed files, through the real Facade, image, projection and planner.
 *
 * Like `curatedSeedLoad.integration.test.ts`, this suite needs no database and no network, so it never skips: it reads
 * only files committed beside the code. Counts are DERIVED from the parsed files, never written here, because the
 * curated files are regenerated.
 */
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import { buildCatalogPlan, isEmptyPlan, type CatalogChange } from '../src/foods/seed/catalog/catalogPlanBuilder.js';
import { EMPTY_SNAPSHOT, type CatalogSnapshot, type CitedPortion } from '../src/foods/seed/catalog/catalogSnapshot.js';
import { composeSeedImage, type SeedImage, type SeedInputs } from '../src/foods/seed/catalog/seedImage.js';
import { projectSeed } from '../src/foods/seed/catalog/seedProjection.js';
import { loadSeedSources } from '../src/foods/seed/catalog/seedSources.js';
import type { FdcKey, ItemKey } from '../src/foods/seed/catalogKey.js';

const DATA_DIR = fileURLToPath(new URL('../src/foods/seed/data/', import.meta.url));

let inputs: SeedInputs;
let image: SeedImage;
let projected: CatalogSnapshot;

beforeAll(async () => {
    inputs = await loadSeedSources(DATA_DIR);
    image = composeSeedImage(inputs);
    projected = projectSeed(image);
});

describe('the committed curated seed, projected', () => {
    it('projects every root, every variant and every owned item of the image', () => {
        const variants = [...image.roots.values()].flatMap((root) => root.variants.map((variant) => variant.item));

        expect([...projected.content.roots.keys()].sort()).toEqual([...image.roots.keys()].sort());
        expect([...projected.content.variants.keys()].sort()).toEqual([...variants].sort());
        expect([...projected.content.items.keys()].sort()).toEqual([...image.items.keys()].sort());
    });

    it('gives every variant, and every root on a USDA item, a header with values; and a no-numbers root none', () => {
        const empty = [...projected.content.variants.values()].filter(
            (variant) => variant.nutrition.values.length === 0,
        );
        const rootsWithItemNumbers = [...image.roots.values()].filter((root) => root.numbers.from === 'item');
        const noNumbers = [...image.roots.values()].filter((root) => root.numbers.from === 'none');

        expect(empty.map((variant) => variant.item)).toEqual([]);
        expect(
            rootsWithItemNumbers.filter(
                (root) => (projected.content.roots.get(root.seedKey)?.nutrition?.values.length ?? 0) === 0,
            ),
        ).toEqual([]);
        expect(noNumbers.every((root) => projected.content.roots.get(root.seedKey)?.nutrition === null)).toBe(true);
    });

    it('stores no Branded or label zero (OQ-2)', () => {
        const zeros = [...projected.content.roots.values()].flatMap((root) =>
            root.nutrition !== null &&
            (root.nutrition.citation.dataset === 'usdaBranded' || root.nutrition.citation.dataset === 'label')
                ? root.nutrition.values.filter((value) => value.amount === '0').map(() => root.seedKey)
                : [],
        );

        expect(zeros).toEqual([]);
    });

    it('spells every USDA key bare and every decimal canonically', () => {
        const keys = [...projected.content.items.values()].flatMap((item) => item.sources.map((s) => s.externalKey));
        const grams = [...projected.content.items.values()].flatMap((item) =>
            item.portions.map((portion) => portion.gramWeight),
        );

        expect(keys.filter((key) => !/^[1-9][0-9]*$/u.test(key))).toEqual([]);
        expect(grams.length).toBeGreaterThan(0);
        expect(grams.filter((gram) => /e|\.\d*0$/u.test(gram))).toEqual([]);
    });

    it('gives every label root its label’s serving, and every Branded root its stated household serving, as a portion citing the root’s citation (OQ-1)', () => {
        const expected = [...image.roots.values()].flatMap((root) => {
            if (root.numbers.from === 'manufacturerLabel') {
                return [[root.seedKey, root.numbers.label.serving.label]];
            }

            const household =
                root.numbers.from === 'usdaBranded' ? root.numbers.product.household_serving_fulltext : '';

            return household.trim() === '' ? [] : [[root.seedKey, household.trim()]];
        });
        const citedOf = (item: ItemKey): readonly CitedPortion[] =>
            (projected.content.items.get(item)?.portions ?? []).flatMap((portion) =>
                'citation' in portion ? [portion] : [],
            );
        const roots = [...projected.content.roots.values()];
        const served = roots.flatMap((root) => citedOf(root.item).map((portion) => [root.seedKey, portion.label]));

        expect(expected.length).toBeGreaterThan(0);
        expect(served.sort()).toEqual(expected.sort());

        for (const root of roots) {
            for (const portion of citedOf(root.item)) {
                expect(portion.citation).toEqual(root.nutrition?.citation);
            }
        }

        expect([...projected.content.variants.values()].flatMap((variant) => citedOf(variant.item))).toEqual([]);
    });

    it('carries the KTD-16 anchors with their variants and synonyms', () => {
        const anchors = [...projected.content.roots.values()].filter(
            (root) => root.name === 'beef brisket' || root.name === 'boneless skinless chicken breasts',
        );

        expect(anchors).toHaveLength(2);

        for (const anchor of anchors) {
            expect(anchor.synonyms.length).toBeGreaterThan(0);
            expect([...projected.content.variants.values()].some((variant) => variant.root === anchor.seedKey)).toBe(
                true,
            );
        }
    });
});

describe('the committed curated seed, planned', () => {
    it('against an empty catalog: inserts every row with no id, and records no forward', () => {
        const plan = buildCatalogPlan(projected.content, EMPTY_SNAPSHOT, inputs.curated.changes);
        const { roots, variants, items, forwards, claims } = plan.rows;

        expect(roots.insert).toHaveLength(projected.content.roots.size);
        expect(variants.insert).toHaveLength(projected.content.variants.size);
        expect(items.insert).toHaveLength(projected.content.items.size);
        expect([...roots.insert, ...variants.insert].filter((row) => row.id !== null)).toEqual([]);
        expect(forwards).toEqual({ delete: [], insert: [] });
        expect(claims).toEqual([]);
        expect([...roots.update, ...roots.retire, ...roots.delete, ...variants.delete, ...items.delete]).toEqual([]);
        expect(new Set(plan.changes.map((change) => change.kind))).toEqual(new Set(['rootAdded', 'variantAdded']));
    });

    it('against itself: plans nothing', () => {
        const plan = buildCatalogPlan(projected.content, projected, inputs.curated.changes);

        expect(isEmptyPlan(plan)).toBe(true);
        expect(plan.changes).toEqual([]);
    });

    it('over the bare USDA baseline: plans only renames, sourceless roots, and exactly the declared merges and aliases', () => {
        const baseline = projectSeed(
            composeSeedImage({
                ...inputs,
                curated: {
                    roots: [],
                    changes: { merges: [], aliases: [], exclusions: inputs.curated.changes.exclusions, splits: [] },
                },
                candidates: [],
            }),
        );
        const plan = buildCatalogPlan(projected.content, baseline, inputs.curated.changes);
        const removed = (reason: string): Extract<CatalogChange, { kind: 'rootRemoved' }>[] =>
            plan.changes.flatMap((change) =>
                change.kind === 'rootRemoved' && change.reason === reason ? [change] : [],
            );
        const ownerOf = (item: FdcKey): string =>
            projected.content.variants.has(item) ? `variant ${item}` : `root ${item}`;

        expect(new Set(plan.changes.map((change) => change.kind))).toEqual(
            new Set(['rootAdded', 'rootRenamed', 'rootSynonymsChanged', 'rootRemoved', 'variantAdded', 'itemChanged']),
        );
        expect(
            plan.changes
                .flatMap((change) => (change.kind === 'rootAdded' ? [change.seedKey] : []))
                .filter((key) => !key.startsWith('curated:')),
        ).toEqual([]);
        expect(
            removed('merged')
                .map((change) => `${change.seedKey}>${change.to.key}`)
                .sort(),
        ).toEqual(inputs.curated.changes.merges.map((merge) => `${merge.from}>${merge.into}`).sort());
        expect(
            removed('aliased')
                .map((change) => `${change.seedKey}>${change.to.kind} ${change.to.key}`)
                .sort(),
        ).toEqual(inputs.curated.changes.aliases.map((alias) => `${alias.from}>${ownerOf(alias.of)}`).sort());
        expect(plan.rows.forwards.insert).toHaveLength(
            inputs.curated.changes.merges.length + inputs.curated.changes.aliases.length,
        );
    });
});
