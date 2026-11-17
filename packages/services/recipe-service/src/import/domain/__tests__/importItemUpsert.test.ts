/**
 * What `PUT /items` (and the first chunk of `POST /import`) does with one item that may already be held (ADR-0072 §3).
 *
 * The rule is keyed by ordinal so a replay is safe. The mutation each row is there to catch: replacing a recipe a paid parse
 * was made from (a second parse, a second bill), or refusing a harmless replay of the same recipe.
 */
import { describe, expect, it } from 'vitest';

import { decideItemUpsert } from '../importItemUpsert.js';

const RECIPE = {
    title: 'Soup',
    ingredientLines: ['2 cups tomatoes', '1 tsp salt'],
    steps: [{ instruction: 'Simmer.' }],
};
const OTHER = { ...RECIPE, ingredientLines: ['3 cups tomatoes'] };

describe('decideItemUpsert', () => {
    it('inserts an item the import does not hold', () => {
        expect(decideItemUpsert({ existing: undefined, recipe: RECIPE })).toEqual({ kind: 'insert' });
    });

    describe('received: the held recipe has been used for nothing yet', () => {
        it('keeps an identical recipe (a replay is a no-op for the recipe)', () => {
            expect(
                decideItemUpsert({
                    existing: { stage: 'received', payload: RECIPE, heldUnreadable: false },
                    recipe: RECIPE,
                }),
            ).toEqual({
                kind: 'keep',
            });
        });

        it('replaces a different recipe', () => {
            expect(
                decideItemUpsert({
                    existing: { stage: 'received', payload: RECIPE, heldUnreadable: false },
                    recipe: OTHER,
                }),
            ).toEqual({
                kind: 'replace',
            });
        });
    });

    describe.each(['parsing', 'matched'] as const)(
        '%s: a paid parse and a snapshot were made from the held recipe',
        (stage) => {
            it('keeps an identical recipe', () => {
                expect(
                    decideItemUpsert({ existing: { stage, payload: RECIPE, heldUnreadable: false }, recipe: RECIPE }),
                ).toEqual({
                    kind: 'keep',
                });
            });

            it('⛔ LOCKS against a different recipe, naming the stage', () => {
                expect(
                    decideItemUpsert({ existing: { stage, payload: RECIPE, heldUnreadable: false }, recipe: OTHER }),
                ).toEqual({
                    kind: 'locked',
                    stage,
                });
            });
        },
    );

    // Re-review of #220, item 3: a matched item the save holds as UNREADABLE can never be saved from what it holds, and a
    // matched item is otherwise locked, so the cook had no way out. Only that hold reopens it; every other matched item stays
    // locked, because a paid parse and a snapshot were made from its recipe.
    describe('matched, and held because the save cannot read its recipe', () => {
        it('⛔ REOPENS for a different recipe: the replace starts the item again from received', () => {
            expect(
                decideItemUpsert({
                    existing: { stage: 'matched', payload: RECIPE, heldUnreadable: true },
                    recipe: OTHER,
                }),
            ).toEqual({ kind: 'reopen' });
        });

        it('keeps an identical recipe: nothing changed, so it stays held', () => {
            expect(
                decideItemUpsert({
                    existing: { stage: 'matched', payload: RECIPE, heldUnreadable: true },
                    recipe: RECIPE,
                }),
            ).toEqual({ kind: 'keep' });
        });

        it('⛔ still LOCKS a parsing item, whatever its hold says', () => {
            expect(
                decideItemUpsert({
                    existing: { stage: 'parsing', payload: RECIPE, heldUnreadable: true },
                    recipe: OTHER,
                }),
            ).toEqual({ kind: 'locked', stage: 'parsing' });
        });
    });

    it('⛔ refuses ANYTHING for a saved item: its text was shed at the save, so nothing can be compared and an item is saved once', () => {
        expect(
            decideItemUpsert({ existing: { stage: 'saved', payload: null, heldUnreadable: false }, recipe: RECIPE }),
        ).toEqual({
            kind: 'saved',
        });
    });

    it('compares the recipe, not the order its keys were stored in (jsonb reorders them)', () => {
        const reordered = { steps: RECIPE.steps, ingredientLines: RECIPE.ingredientLines, title: RECIPE.title };

        expect(
            decideItemUpsert({
                existing: { stage: 'matched', payload: reordered, heldUnreadable: false },
                recipe: RECIPE,
            }),
        ).toEqual({
            kind: 'keep',
        });
    });

    it('treats an array in a different order as a different recipe (the lines are ordered)', () => {
        const swapped = { ...RECIPE, ingredientLines: [...RECIPE.ingredientLines].reverse() };

        expect(
            decideItemUpsert({
                existing: { stage: 'matched', payload: swapped, heldUnreadable: false },
                recipe: RECIPE,
            }),
        ).toEqual({
            kind: 'locked',
            stage: 'matched',
        });
    });

    it('ignores a key the request left undefined (the parsed recipe omits it; so does the stored one)', () => {
        expect(
            decideItemUpsert({
                existing: { stage: 'received', payload: RECIPE, heldUnreadable: false },
                recipe: { ...RECIPE, description: undefined },
            }),
        ).toEqual({ kind: 'keep' });
    });
});
