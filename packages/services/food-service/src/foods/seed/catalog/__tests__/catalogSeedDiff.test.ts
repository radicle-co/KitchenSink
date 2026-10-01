/**
 * `renderCatalogDiff` (curated catalog plan U5, R41, KTD-22): a seed plan as the Markdown a reviewer reads in the CI
 * summary. It lists every R41 class, and every citation, tier and value change, because a tier is a hand judgment the
 * format check cannot verify.
 */
import { describe, expect, it } from 'vitest';

import {
    makeContent,
    makeContentItem,
    makeContentRoot,
    makeNutrition,
    makeSnapshot,
} from '../__fixtures__/catalogContent.fixtures.js';
import { buildCatalogPlan, type CatalogChange, type CatalogPlan } from '../catalogPlanBuilder.js';
import { renderCatalogDiff } from '../catalogSeedDiff.js';
import { EMPTY_CONTENT, EMPTY_SNAPSHOT, type ContentItem, type SourceEntryCitation } from '../catalogSnapshot.js';
import type { CitationMatch } from '../citationPrecedence.js';

const BRISKET = { kind: 'root', key: 'fdc:100' } as const;

/**
 * A source-entry citation.
 *
 * @param dataset - Its dataset.
 * @param externalKey - Its key.
 * @param match - Its tier.
 * @returns The citation.
 */
function citation(
    dataset: SourceEntryCitation['dataset'],
    externalKey: string,
    match: CitationMatch,
): SourceEntryCitation {
    return { dataset, externalKey, match, densityGPerMl: null, kcalFromKj: false };
}

/** One change of every kind; a new kind fails to compile here until it has a case. */
const EVERY_KIND: { readonly [Kind in CatalogChange['kind']]: Extract<CatalogChange, { kind: Kind }> } = {
    rootAdded: { kind: 'rootAdded', seedKey: 'curated:saffron', name: 'saffron' },
    rootSplit: { kind: 'rootSplit', seedKey: 'fdc:102', name: 'brisket point', from: 'fdc:100' },
    rootRestored: { kind: 'rootRestored', seedKey: 'fdc:200', name: 'chicken breast' },
    rootRenamed: { kind: 'rootRenamed', seedKey: 'fdc:100', from: 'Beef, brisket, whole', to: 'beef brisket' },
    rootSynonymsChanged: { kind: 'rootSynonymsChanged', seedKey: 'fdc:100', from: [], to: ['brisket'] },
    rootItemChanged: { kind: 'rootItemChanged', seedKey: 'curated:saffron', from: 'curated:saffron', to: 'fdc:300' },
    rootRetired: { kind: 'rootRetired', seedKey: 'fdc:400', name: 'veal' },
    rootRemoved: { kind: 'rootRemoved', seedKey: 'fdc:171268', name: 'Beef, flat', reason: 'merged', to: BRISKET },
    variantAdded: { kind: 'variantAdded', item: 'fdc:101', root: 'fdc:100' },
    variantRestored: { kind: 'variantRestored', item: 'fdc:103', root: 'fdc:100' },
    variantMoved: { kind: 'variantMoved', item: 'fdc:104', from: 'fdc:100', to: 'fdc:200' },
    variantRetired: { kind: 'variantRetired', item: 'fdc:105', root: 'fdc:100' },
    variantRemoved: { kind: 'variantRemoved', item: 'fdc:102', root: 'fdc:100', reason: 'promoted', to: BRISKET },
    variantPartsChanged: {
        kind: 'variantPartsChanged',
        item: 'fdc:101',
        from: [{ attribute: 'cut', text: 'flat' }],
        to: [{ attribute: 'cut', text: 'first cut' }],
    },
    itemChanged: { kind: 'itemChanged', item: 'fdc:789890' },
    citationChanged: {
        kind: 'citationChanged',
        owner: { kind: 'root', key: 'curated:adobo-seasoning' },
        from: citation('ciqual', '2076', 'close'),
        to: citation('usdaBranded', '2096555', 'exact'),
    },
    nutritionValuesChanged: { kind: 'nutritionValuesChanged', owner: BRISKET },
    liveFoodClaimed: { kind: 'liveFoodClaimed', id: '01J9LIVEFOOD', seedKey: 'fdc:100' },
};

/**
 * A plan whose only content is its changes.
 *
 * @param changes - The changes.
 * @returns The plan.
 */
function planOf(changes: readonly CatalogChange[]): CatalogPlan {
    return {
        ...buildCatalogPlan(EMPTY_CONTENT, EMPTY_SNAPSHOT, { merges: [], aliases: [], exclusions: [], splits: [] }),
        changes,
    };
}

describe('renderCatalogDiff', () => {
    const markdown = renderCatalogDiff(planOf(Object.values(EVERY_KIND)), {});

    it('describes every kind of change, naming its keys', () => {
        for (const expected of [
            '`curated:saffron` saffron',
            '`fdc:102` brisket point, split from `fdc:100`',
            '`fdc:200` chicken breast',
            '`fdc:100` Beef, brisket, whole → beef brisket',
            '`fdc:100` (none) → brisket',
            '`curated:saffron` item `curated:saffron` → `fdc:300`',
            '`fdc:400` veal',
            '`fdc:171268` Beef, flat → root `fdc:100`',
            '`fdc:101` under `fdc:100`',
            '`fdc:104` `fdc:100` → `fdc:200`',
            '`fdc:102` under `fdc:100` → root `fdc:100`',
            '`fdc:101` cut: flat → cut: first cut',
            '`fdc:789890`',
            'root `curated:adobo-seasoning` ciqual 2076 (close) → usdaBranded 2096555 (exact)',
            'live food `01J9LIVEFOOD` → root `fdc:100`',
        ]) {
            expect(markdown).toContain(`- ${expected}\n`);
        }
    });

    it('counts each class in a table, splitting removals by why (R41)', () => {
        expect(markdown).toContain('| Roots merged | 1 |\n');
        expect(markdown).toContain('| Variants promoted to roots | 1 |\n');
        expect(markdown).toContain('| Citations or tiers changed | 1 |\n');
        expect(markdown).not.toContain('| Roots aliased |');
    });

    it('caps each class’s lines and says how many it left out', () => {
        const added = Array.from({ length: 5 }, (_, index) => ({
            kind: 'rootAdded' as const,
            seedKey: `curated:food-${String(index)}` as const,
            name: `food ${String(index)}`,
        }));
        const capped = renderCatalogDiff(planOf(added), { limit: 2 });

        expect(capped).toContain('- `curated:food-1` food 1\n- … 3 more\n');
        expect(capped).not.toContain('food 2');
    });

    it('lists a serving-only change as its item changing (OQ-1)', () => {
        const { citation: cited } = makeNutrition('fdc:100');
        const served = (grams: string): ContentItem =>
            makeContentItem('fdc:100', { portions: [{ label: '1 ONZ', gramWeight: grams, citation: cited }] });
        const root = makeContentRoot();
        const rendered = renderCatalogDiff(
            buildCatalogPlan(
                makeContent([root], [], [served('30')]),
                makeSnapshot(makeContent([root], [], [served('28')])),
                { merges: [], aliases: [], exclusions: [], splits: [] },
            ),
            {},
        );

        expect(rendered).not.toContain('No catalog change.');
        expect(rendered).toContain('- `fdc:100`\n');
    });

    it('says when nothing changes', () => {
        expect(renderCatalogDiff(planOf([]), {})).toContain('No catalog change.');
    });

    it('leads with the note a caller gives, such as a base that does not compose', () => {
        const noted = renderCatalogDiff(planOf([]), { note: 'The base seed does not compose; diffed against empty.' });

        expect(noted.split('\n').slice(0, 3)).toContain('> The base seed does not compose; diffed against empty.');
    });

    it('escapes Markdown in a name, so a committed name cannot format or inject the summary', () => {
        const escaped = renderCatalogDiff(
            planOf([{ kind: 'rootAdded', seedKey: 'curated:x', name: '*bold* <b>|' }]),
            {},
        );

        expect(escaped).toContain('- `curated:x` \\*bold\\* &lt;b&gt;\\|\n');
    });
});
