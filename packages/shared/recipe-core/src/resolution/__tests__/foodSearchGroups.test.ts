/**
 * The offering rule over plan 002 S5's two split searches (`docs/design/rowEditorOpenDecisions.md`, "S5 list
 * contract", L1 and L4.3): the cook's own foods, then the catalog's, each in food's order, a nameless result dropped.
 *
 * Two readers depend on it, so a drift between them is the failure this module exists to prevent: the app's list
 * model (`@commise/features-recipes` `foodSuggestions.model.ts`) and the cookbook importer, which resolves a line the
 * way a cook does (`@kitchensink/cookbook-import` `resolveIngredient.ts`).
 *
 * Mutation lens. Each case fails if: the groups swap; the rule re-ranks a group (the scores below run against food's
 * order on purpose, so a sort by score reorders them); a null, empty or whitespace-only name is offered; or a name is
 * rewritten (trimmed) on its way through.
 */
import { describe, expect, it } from 'vitest';

import { inGroupOrder, namedFoodHitsOf, offeredFoodsOf, type FoodSearchHit } from '../foodSearchGroups.js';

/** A result as either split search returns one: an id, a name food may leave null, and food's score. */
interface Hit extends FoodSearchHit {
    readonly id: string;
    readonly score: number;
}

const hit = (id: string, name: string | null, score = 0.5): Hit => ({ id, name, score });

describe('offeredFoodsOf', () => {
    it.each<{
        readonly scenario: string;
        readonly authored: readonly Hit[];
        readonly catalog: readonly Hit[];
        readonly offered: readonly (readonly ['authored' | 'catalog', string])[];
    }>([
        {
            scenario: 'the cook’s own foods come before the catalog’s',
            authored: [hit('a1', 'my egg')],
            catalog: [hit('c1', 'egg')],
            offered: [
                ['authored', 'a1'],
                ['catalog', 'c1'],
            ],
        },
        {
            // Food's order runs against the scores, so a re-rank by score would reorder both groups.
            scenario: 'each group keeps food’s order, whatever the scores say',
            authored: [hit('a1', 'egg yolk', 0.1), hit('a2', 'egg white', 0.9)],
            catalog: [hit('c1', 'egg, raw', 0.2), hit('c2', 'egg', 0.8), hit('c3', 'eggplant', 0.5)],
            offered: [
                ['authored', 'a1'],
                ['authored', 'a2'],
                ['catalog', 'c1'],
                ['catalog', 'c2'],
                ['catalog', 'c3'],
            ],
        },
        {
            scenario: 'a result with a null, empty or whitespace-only name is dropped, in either group',
            authored: [hit('a-null', null), hit('a1', 'my egg'), hit('a-empty', '')],
            catalog: [hit('c-blank', '   '), hit('c1', 'egg'), hit('c-tab', '\t\n')],
            offered: [
                ['authored', 'a1'],
                ['catalog', 'c1'],
            ],
        },
        {
            scenario: 'only the catalog answered with foods',
            authored: [],
            catalog: [hit('c1', 'egg')],
            offered: [['catalog', 'c1']],
        },
        {
            scenario: 'only the cook’s own foods answered with foods',
            authored: [hit('a1', 'my egg')],
            catalog: [],
            offered: [['authored', 'a1']],
        },
        {
            scenario: 'every result is nameless',
            authored: [hit('a-null', null)],
            catalog: [hit('c-empty', '')],
            offered: [],
        },
        {
            scenario: 'neither group has a result',
            authored: [],
            catalog: [],
            offered: [],
        },
    ])('$scenario', ({ authored, catalog, offered }) => {
        expect(offeredFoodsOf({ authored, catalog }).map((food) => [food.group, food.hit.id] as const)).toStrictEqual(
            offered,
        );
    });

    it('passes each result through whole: its name as food wrote it, and every other field', () => {
        const withVariant = {
            id: 'c1',
            name: '  beef brisket ',
            score: 1,
            variant: { id: 'variant_7', parts: [{ attribute: 'cut', text: 'flat' }] },
        };

        expect(offeredFoodsOf({ authored: [], catalog: [withVariant] })).toStrictEqual([
            { group: 'catalog', hit: withVariant },
        ]);
    });
});

describe('namedFoodHitsOf', () => {
    it('keeps the named results of one group, in food’s order', () => {
        const hits = [hit('h1', 'egg', 0.1), hit('h2', null), hit('h3', ' '), hit('h4', 'eggnog', 0.9)];

        expect(namedFoodHitsOf(hits).map((named) => named.id)).toStrictEqual(['h1', 'h4']);
    });
});

describe('inGroupOrder', () => {
    // The app's list holds each group's foods as its own options, so the order must pass them through, not copy them.
    it('puts the cook’s own group before the catalog’s, passing each item through as it is', () => {
        const mine = [{ option: 'a1' }, { option: 'a2' }];
        const catalog = [{ option: 'c1' }];

        const ordered = inGroupOrder({ authored: mine, catalog });

        expect(ordered).toStrictEqual([{ option: 'a1' }, { option: 'a2' }, { option: 'c1' }]);
        expect(ordered[0]).toBe(mine[0]);
        expect(ordered[2]).toBe(catalog[0]);
    });
});
