/**
 * Unit tests for `rowMenu.ts` — the read row's `⋯` (build spec §7.5.1): Edit · Food details · the state's remedies ·
 * Move to group… · Move up · Move down · divider · Remove.
 *
 * The state's remedies come from the ONE row policy (`rowPresentationOf`) and are not restated here; this pins only the
 * composition: the order, that a position item shows only when it does something (never greyed), and that Remove is
 * always last.
 */
import { describe, expect, it } from 'vitest';

import type { IngredientRowAction } from '../ingredientRowPolicy.js';
import { rowMenuOf, type RowMenuFacts } from '../rowMenu.js';

const facts = (over: Partial<RowMenuFacts> = {}): RowMenuFacts => ({
    foodDetails: false,
    canMoveUp: false,
    canMoveDown: false,
    canMoveToGroup: false,
    ...over,
});

describe('rowMenuOf', () => {
    it('a resolved row in a grouped list, mid-group: the spec order in full', () => {
        expect(
            rowMenuOf(
                ['changeFood', 'remove'],
                facts({ foodDetails: true, canMoveUp: true, canMoveDown: true, canMoveToGroup: true }),
            ),
        ).toEqual(['edit', 'foodDetails', 'changeFood', 'moveToGroup', 'moveUp', 'moveDown', 'remove']);
    });

    it('keeps the policy order of the remedies (remedy first, §3a) and puts Remove last', () => {
        const policy: IngredientRowAction[] = ['changeFood', 'editDetails', 'createOwnFood', 'remove'];

        expect(rowMenuOf(policy, facts())).toEqual(['edit', 'changeFood', 'editDetails', 'createOwnFood', 'remove']);
    });

    it('a lone row in an ungrouped list: Edit and Remove only, nothing greyed', () => {
        expect(rowMenuOf(['remove'], facts())).toEqual(['edit', 'remove']);
    });

    it('the first row of a group offers Move down only; the last offers Move up only', () => {
        expect(rowMenuOf(['remove'], facts({ canMoveDown: true }))).toEqual(['edit', 'moveDown', 'remove']);
        expect(rowMenuOf(['remove'], facts({ canMoveUp: true }))).toEqual(['edit', 'moveUp', 'remove']);
    });

    it('Remove is the last item whatever the policy order', () => {
        expect(rowMenuOf(['remove', 'changeFood'], facts()).at(-1)).toBe('remove');
    });

    it('never lists an item twice', () => {
        const menu = rowMenuOf(
            ['changeFood', 'addDetails', 'createOwnFood', 'findFood', 'remove'],
            facts({ foodDetails: true, canMoveUp: true, canMoveDown: true, canMoveToGroup: true }),
        );

        expect(new Set(menu).size).toBe(menu.length);
    });
});
