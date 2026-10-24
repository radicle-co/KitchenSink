/**
 * The committed curated seed loads and composes (plan U1, KTD-16): the real pinned USDA archives, the real
 * curated catalog, changes and Branded extract, through the real Facade and pipeline.
 *
 * This suite needs no database and no network, so it never skips: it reads only files committed beside the
 * code. It is the only tier that proves the COMMITTED files compose, which no fixture can: a change to any of
 * them that breaks a rule fails here with the rule named.
 *
 * ⚠️ Counts that describe the curated data are DERIVED from the parsed files, never written here, because the
 * curated files are regenerated (Track A) and a hand-kept count would turn red with no defect. The universe
 * (8,188) is written out because it moves only with a deliberate edit of `sourcePins.json`, and the named items
 * are the plan's KTD-16 anchors and R48 cases.
 */
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import { normalizeUnit } from '@kitchensink/recipe-core';

import {
    normalizePortion,
    normalizePortions,
    type NormalizedPortion,
} from '../src/foods/nutrition/portionNormalization.js';
import type { SeedInputs, SeedImage, SeedImagePortion } from '../src/foods/seed/catalog/seedImage.js';
import { composeSeedImage } from '../src/foods/seed/catalog/seedImage.js';
import { loadSeedSources } from '../src/foods/seed/catalog/seedSources.js';
import { fdcKey, type FdcKey } from '../src/foods/seed/catalogKey.js';
import { isTableDataset } from '../src/foods/seed/citationDatasets.js';

const DATA_DIR = fileURLToPath(new URL('../src/foods/seed/data/', import.meta.url));

describe('the committed curated seed', () => {
    let inputs: SeedInputs;
    let image: SeedImage;

    beforeAll(async () => {
        inputs = await loadSeedSources(DATA_DIR);
        image = composeSeedImage(inputs);
    });

    it('reads a universe of 8,188 items: all 7,793 SR Legacy items and the 395 current Foundation items', () => {
        expect(inputs.usdaItems).toHaveLength(8188);
        expect(inputs.usdaItems.filter((item) => item.isFoundation)).toHaveLength(395);
    });

    it('holds every Branded candidate in the extract, a cited one among them, and a merge row for every variant', () => {
        const candidates = inputs.candidates.flatMap((candidate) =>
            candidate.dataset === 'usdaBranded' ? [candidate.key] : [],
        );
        const cited = [...image.roots.values()].flatMap((root) =>
            root.numbers.from === 'usdaBranded' ? [fdcKey(root.numbers.product.fdcId)] : [],
        );
        const variants = inputs.curated.roots.reduce((count, root) => count + root.variants.length, 0);

        // A candidate the policy did not pick still has to be readable, or the policy cannot compare it (KTD-22).
        expect([...inputs.branded.keys()].sort()).toEqual([...new Set(candidates)].sort());
        expect(cited.length).toBeGreaterThan(0);
        expect(cited.every((key) => inputs.branded.has(key))).toBe(true);
        expect(variants).toBeGreaterThan(0);
        expect(inputs.curated.changes.merges).toHaveLength(variants);
    });

    it('holds every table candidate in its dataset’s extract, and cites an extract only through a listed candidate', () => {
        for (const candidate of inputs.candidates) {
            if (isTableDataset(candidate.dataset)) {
                expect(inputs.extracts.get(candidate.dataset)?.has(candidate.key)).toBe(true);
            }
        }

        const listed = new Set(inputs.candidates.map((c) => `${c.seedKey}\t${c.dataset}\t${c.key}`));
        const cited = [...image.roots.values()].flatMap((root) =>
            root.numbers.from === 'extract'
                ? [`${root.seedKey}\t${root.numbers.dataset}\t${root.numbers.line.key}`]
                : [],
        );

        expect(cited.length).toBeGreaterThan(0);
        expect(cited.filter((citation) => !listed.has(citation))).toEqual([]);
    });

    it('places every non-excluded universe item as a source of exactly one item', () => {
        const sources = [...image.items.values()].flatMap((item) => item.sources.map((source) => source.item));
        const excluded = new Set(inputs.curated.changes.exclusions);

        expect(new Set(sources).size).toBe(sources.length);
        expect(sources.length).toBe(inputs.usdaItems.filter((item) => !excluded.has(item.key)).length);
    });

    it('keeps every curated root, and makes an untouched baseline root of every other group', () => {
        const curated = [...image.roots.values()].filter((root) => root.origin === 'curated');

        expect(curated.map((root) => root.seedKey)).toEqual(inputs.curated.roots.map((root) => root.seedKey));
        expect(image.roots.size).toBeGreaterThan(curated.length);
    });

    it('"beef brisket" (fdc:169570) carries its 40 variants and its 4 synonyms', () => {
        const brisket = image.roots.get('fdc:169570');

        expect(brisket?.name).toBe('beef brisket');
        expect(brisket?.variants).toHaveLength(40);
        expect(brisket?.synonyms).toEqual(['first cut brisket', 'brisket flat', 'brisket point', 'brisket']);
    });

    it('"boneless skinless chicken breasts" (fdc:2646170) carries its 8 variants and "boneless chicken breasts"', () => {
        const chicken = image.roots.get('fdc:2646170');

        expect(chicken?.name).toBe('boneless skinless chicken breasts');
        expect(chicken?.variants).toHaveLength(8);
        expect(chicken?.synonyms).toContain('boneless chicken breasts');
    });

    it('SR fdc:171140 is an alias source of chicken variant item fdc:331960, which shares its description', () => {
        expect(image.items.get('fdc:331960')?.sources).toContainEqual({
            item: 'fdc:171140',
            role: 'derivedAlias',
            lineageKey: null,
        });
        expect(image.roots.has('fdc:171140')).toBe(false);
    });

    it('"all-purpose flour" carries its SR alias’s cup portion', () => {
        const flour = image.items.get('fdc:789890');

        expect(flour?.sources).toContainEqual({ item: 'fdc:168894', role: 'declaredAlias', lineageKey: null });
        // Rewritten for KTD-28: the label states USDA's amount (`1 cup`, where it read `cup`).
        expect(flour?.portions).toContainEqual(expect.objectContaining({ label: '1 cup', source: 'fdc:168894' }));
    });

    // Rewritten for curated plan R19: the Foundation twin's row also carries its NDB number, 4582 in the pinned
    // foundation_food.csv; the SR Legacy row carries none.
    it('"Oil, canola" keys fdc:172336: the SR item with energy supplies, the Foundation twin is its alias', () => {
        expect(image.items.get('fdc:172336')?.sources).toEqual([
            { item: 'fdc:172336', role: 'supplier', lineageKey: null },
            { item: 'fdc:748278', role: 'derivedAlias', lineageKey: 'foundation:4582' },
        ]);
    });

    it('gives every placed Foundation source its NDB number as a lineage key, and no SR Legacy source one (R19)', () => {
        const facts = new Map(inputs.usdaItems.map((item) => [item.key, item]));
        const sources = [...image.items.values()].flatMap((item) => item.sources);
        const foundation = sources.filter((source) => facts.get(source.item)?.isFoundation === true);

        expect(foundation.length).toBeGreaterThan(0);
        expect(foundation.filter((source) => !/^foundation:[1-9][0-9]*$/.test(source.lineageKey ?? ''))).toEqual([]);
        expect(
            sources.filter((source) => facts.get(source.item)?.isFoundation !== true && source.lineageKey !== null),
        ).toEqual([]);
        expect(new Set(foundation.map((source) => source.lineageKey)).size).toBe(foundation.length);
    });

    // The owner ruled on 2026-10-01 that the seed assigns USDA's own food groups. Every SR Legacy and Foundation row
    // states one in the pinned archives, so an item backed by USDA that ends up with none means a group was lost.
    it('gives every USDA-backed item a food group that one of its own source rows states', () => {
        expect(inputs.usdaItems.filter((item) => item.foodGroup === null)).toEqual([]);

        const backed = [...image.items].filter(([, item]) => item.sources.length > 0);
        const sourcesOf = (item: (typeof backed)[number][1]): Set<string> =>
            new Set(item.sources.map((source) => source.item));

        expect(backed.length).toBeGreaterThan(0);
        expect(backed.filter(([, item]) => item.categories.length === 0).map(([key]) => key)).toEqual([]);
        expect(
            backed.flatMap(([key, item]) =>
                item.categories.filter((category) => !sourcesOf(item).has(category.source)).map(() => key),
            ),
        ).toEqual([]);
    });

    describe('servings, as the nutrition read normalizes them (KTD-3, KTD-28)', () => {
        /**
         * Every stored USDA serving, with the universe item it came from.
         *
         * @returns The image's portions.
         */
        function usdaServings(): readonly SeedImagePortion[] {
            return [...image.items.values()].flatMap((item) => item.portions);
        }

        /**
         * The normalized servings of one universe item's own rows.
         *
         * @param key - The universe item.
         * @returns Its servings, one per unit.
         */
        function servingsOf(key: FdcKey): readonly NormalizedPortion[] {
            return normalizePortions(
                usdaServings()
                    .filter((portion) => portion.source === key)
                    .map((portion) => ({ label: portion.label, gramWeight: Number(portion.gramWeight) })),
            );
        }

        it('stores every USDA serving with the amount USDA states, so its gram weight is true of its label', () => {
            const labels = usdaServings().map((portion) => portion.label);

            expect(labels.length).toBeGreaterThan(0);
            expect(labels.filter((label) => !/^\d/.test(label))).toEqual([]);
        });

        it('reads at least nine in ten USDA servings as a unit and a weight (2 in 14,572 before KTD-28)', () => {
            const servings = usdaServings();
            const read = servings.filter(
                (portion) =>
                    normalizePortion({ label: portion.label, gramWeight: Number(portion.gramWeight) }) !== null,
            );

            expect(read.length / servings.length).toBeGreaterThan(0.9);
        });

        it('emits only units recipe-core keeps fixed, and never a Rec 20 code, for USDA and Branded servings alike', () => {
            const branded = [...inputs.branded.values()].map((product) => ({
                label: product.household_serving_fulltext,
                gramWeight: Number(product.serving_size),
            }));
            const usda = usdaServings().map((portion) => ({
                label: portion.label,
                gramWeight: Number(portion.gramWeight),
            }));
            const units = [...usda, ...branded].flatMap((portion) => normalizePortion(portion)?.unit ?? []);

            expect(units.length).toBeGreaterThan(0);
            expect(units.filter((unit) => normalizeUnit(unit) !== unit || !/^\p{L}/u.test(unit))).toEqual([]);
            expect(units.filter((unit) => ['onz', 'oza', 'grm', 'mlt'].includes(unit))).toEqual([]);
            expect(units).toEqual(expect.arrayContaining(['oz', 'fluid ounce', 'g']));
        });

        it.each<[FdcKey, string, string, number]>([
            ['fdc:168894', 'all-purpose flour', 'cup', 125],
            ['fdc:171287', 'a whole egg', 'large', 50],
            ['fdc:170000', 'raw onion, whose `10 rings` weigh 60 g', 'ring', 6],
            ['fdc:171265', 'whole milk', 'fluid ounce', 30.5],
        ])('weighs %s (%s) per %s as USDA states it', (key, _food, unit, gramsPerUnit) => {
            expect(servingsOf(key)).toContainEqual({ unit, gramsPerUnit });
        });

        it('never reads a part or a refuse weight of a Foundation food as one of the food', () => {
            const foundation = new Set(inputs.usdaItems.flatMap((item) => (item.isFoundation ? [item.key] : [])));
            const parts = usdaServings().filter(
                (portion) => foundation.has(portion.source) && /^1 (egg (white|yolk)|Banana Peel)$/.test(portion.label),
            );

            expect(parts.length).toBeGreaterThan(0);
            expect(
                parts.filter(
                    (portion) =>
                        normalizePortion({ label: portion.label, gramWeight: Number(portion.gramWeight) }) !== null,
                ),
            ).toEqual([]);
        });
    });

    it('resolves every root’s numbers from the source its catalog line states', () => {
        const kinds = inputs.curated.roots.map((root) => {
            const resolved = image.roots.get(root.seedKey)?.numbers.from;

            if (root.item !== null || root.nutrition === null || root.nutrition.source === 'manufacturerLabel') {
                return [root.item === null ? (root.nutrition?.source ?? 'none') : 'item', resolved];
            }

            return [root.nutrition.source === 'usda' ? 'usda' : 'table', resolved];
        });
        const allowed: Record<string, readonly (string | undefined)[]> = {
            item: ['item'],
            none: ['none'],
            manufacturerLabel: ['manufacturerLabel'],
            usda: ['usdaBranded', 'usdaStandIn', 'extract'],
            table: ['extract'],
        };

        expect(kinds.filter(([stated, resolved]) => !(allowed[String(stated)] ?? []).includes(resolved))).toEqual([]);
        expect(kinds.map(([, resolved]) => resolved)).toEqual(expect.arrayContaining(['usdaBranded', 'none']));
    });
});
