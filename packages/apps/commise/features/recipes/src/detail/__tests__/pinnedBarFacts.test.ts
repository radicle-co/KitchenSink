/**
 * The words of the pinned ingredients bar (owner ruling R1; `docs/plans/2026-11-08-pinnedIngredientsBar.md`): what the
 * bar says, what its one button is named, and what the list is called. One derivation for both platforms, so the web
 * bar and the native bar cannot say different things.
 */
import { describe, expect, it } from 'vitest';

import { recipeMessages } from '../../messages.js';
import { pinnedBarFactsOf } from '../pinnedBarFacts.js';

const { detail } = recipeMessages.en;

const lines = (count: number): { ingredientId: string }[] =>
    Array.from({ length: count }, (_, index) => ({ ingredientId: `i${String(index)}` }));

const facts = (over: { count?: number; ticked?: readonly string[]; open?: boolean; servings?: number } = {}) =>
    pinnedBarFactsOf({
        ingredients: lines(over.count ?? 13),
        checked: new Set(over.ticked ?? []),
        servings: over.servings ?? 4,
        open: over.open ?? false,
        copy: detail,
        locale: 'en',
    });

describe('pinnedBarFactsOf', () => {
    it('names the button with the servings, the item count and the action, and says nothing of ticks at zero', () => {
        const bar = facts();

        expect(bar.name).toBe('Ingredients for 4, 13 items. Show list.');
        expect(bar.meta).toBe('13 items');
        expect(bar.cue).toBe('Show');
    });

    it('adds the ticked clause once something is ticked', () => {
        const bar = facts({ ticked: ['i1'] });

        expect(bar.name).toBe('Ingredients for 4, 13 items, 1 ticked. Show list.');
        expect(bar.meta).toBe('13 items · 1 ticked');
    });

    it('reads "13 items · 13 ticked" when every line is ticked', () => {
        expect(facts({ ticked: lines(13).map((line) => line.ingredientId) }).meta).toBe('13 items · 13 ticked');
    });

    it('uses the singular for one item', () => {
        expect(facts({ count: 1 }).meta).toBe('1 item');
    });

    it('counts only ticks that still belong to a line, so a stale mark never counts', () => {
        expect(facts({ ticked: ['i1', 'gone'] }).meta).toBe('13 items · 1 ticked');
    });

    it('ends the name with Hide list while the list is open, and the cue reads Hide', () => {
        const bar = facts({ open: true });

        expect(bar.name).toBe('Ingredients for 4, 13 items. Hide list.');
        expect(bar.cue).toBe('Hide');
    });

    it('names the list for the servings, and splits the label so the visible words are in the name (SC 2.5.3)', () => {
        const bar = facts({ servings: 6 });

        expect(bar.dialogName).toBe('Ingredients for 6');
        expect(bar.heading).toBe('Ingredients');
        expect(bar.forServings).toBe('for 6');
        expect(bar.name.startsWith(`${bar.heading} ${bar.forServings}`)).toBe(true);
    });
});
