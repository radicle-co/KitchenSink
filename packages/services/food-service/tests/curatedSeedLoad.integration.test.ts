/**
 * The committed curated seed loads and composes (plan U1, KTD-16): the real pinned USDA archives, the real
 * curated catalog, changes, Branded extract and popularity file, through the real Facade and pipeline.
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

import type { SeedInputs, SeedImage } from '../src/foods/seed/catalog/seedImage.js';
import { composeSeedImage } from '../src/foods/seed/catalog/seedImage.js';
import { loadSeedSources } from '../src/foods/seed/catalog/seedSources.js';
import { fdcKey } from '../src/foods/seed/catalogKey.js';
import { isTableDataset } from '../src/foods/seed/citationDatasets.js';
import { normalizePriorFraction } from '../src/foods/seed/fnddsPrior.js';

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
        expect(image.items.get('fdc:331960')?.sources).toContainEqual({ item: 'fdc:171140', role: 'derivedAlias' });
        expect(image.roots.has('fdc:171140')).toBe(false);
    });

    it('"all-purpose flour" carries its SR alias’s cup portion, and its weight is the alias’s FNDDS weight', () => {
        const flour = image.items.get('fdc:789890');
        const aliasWeight = inputs.popularity.get('fdc:168894');

        expect(flour?.sources).toContainEqual({ item: 'fdc:168894', role: 'declaredAlias' });
        expect(flour?.portions).toContainEqual(expect.objectContaining({ label: 'cup', source: 'fdc:168894' }));
        expect(aliasWeight).toBeGreaterThan(0);
        // Rewritten for U5 slice 0: weights and fractions are decimal strings (exact sum, nine-place fraction).
        expect(flour?.weight).toBe(String(aliasWeight));
        expect(flour?.priorFraction).toBe(normalizePriorFraction(String(aliasWeight)));
    });

    it('"Oil, canola" keys fdc:172336: the SR item with energy supplies, the Foundation twin is its alias', () => {
        expect(image.items.get('fdc:172336')?.sources).toEqual([
            { item: 'fdc:172336', role: 'supplier' },
            { item: 'fdc:748278', role: 'derivedAlias' },
        ]);
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
