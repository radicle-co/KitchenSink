/**
 * Unit tests for `panelBodyOf` (`../ingredientRowPanel.ts`) — which body the row's status panel shows for each panel
 * kind the row policy names.
 *
 * REWRITTEN for plan 002 V1 B5: `RESOLVED` and the declared row now open the NUTRITION body (fed by the editor's one
 * read), and `PENDING` gets its explanation back — a poll that turns it `RESOLVED` now SWAPS the body under an open
 * panel instead of unmounting it (SPECIFY §4, "Status advances while open").
 *
 * REWRITTEN for plan 002 V1 B7: the two bodies that were owed land with the controls their copy names (row 2's two
 * paths name Create my own food; a nameless row 12 names Change food, both in the row's `⋮`), so every panel has a body
 * and every row shows its glyph (V1 sign-off item 3a). The table is total over `IngredientRowPanel`, so a kind added to
 * the policy without a decision here fails.
 */
import { describe, expect, it } from 'vitest';

import type { IngredientRowPanel } from '../ingredientRowPolicy.js';
import { panelBodyOf, type RowPanelBody, type RowPanelExplanationKey } from '../ingredientRowPanel.js';
import { recipeFormMessages } from '../messages.js';

const explanation = (key: RowPanelExplanationKey): RowPanelBody => ({ kind: 'explanation', key });

const CASES: readonly {
    readonly panel: IngredientRowPanel;
    readonly standIn: boolean;
    readonly expected: ReturnType<typeof panelBodyOf>;
}[] = [
    { panel: 'noData', standIn: false, expected: { kind: 'nutrition' } },
    // §5a: the two paths, fixing named first; the prompt names Create my own food, in the row's `⋮`.
    { panel: 'twoPaths', standIn: false, expected: { kind: 'twoPaths' } },
    { panel: 'nutrition', standIn: false, expected: { kind: 'nutrition' } },
    { panel: 'working', standIn: false, expected: explanation('nutritionWorking') },
    // Row 6: the candidate picker over the binding's own candidate set, with None of these (SPECIFY.1 row 6, §3a).
    { panel: 'candidates', standIn: false, expected: { kind: 'candidates' } },
    { panel: 'shortlist', standIn: false, expected: { kind: 'shortlist' } },
    { panel: 'needsReview', standIn: false, expected: explanation('statusExplainNeedsReview') },
    { panel: 'notFound', standIn: false, expected: explanation('statusExplainNotFound') },
    // Orchestrator slice 2: the FAILED explanation carries its own Try again (a status read, no recipe write).
    { panel: 'failed', standIn: false, expected: { kind: 'lookupFailed' } },
    { panel: 'privateFood', standIn: true, expected: explanation('nutritionNoneUnavailable') },
    { panel: 'foodRemoved', standIn: false, expected: explanation('statusExplainFoodRemoved') },
    // `namelessLineCopy.md` §6c: the nameless copy tells the cook to use Change food, in the row's `⋮`.
    { panel: 'foodRemoved', standIn: true, expected: { kind: 'foodRemovedNameless' } },
    { panel: 'foodUnreachable', standIn: true, expected: explanation('statusExplainFoodUnreachable') },
];

describe('panelBodyOf', () => {
    it.each(CASES)('$panel (stand-in: $standIn)', ({ panel, standIn, expected }) => {
        expect(panelBodyOf(panel, standIn)).toEqual(expected);
    });

    it('every explanation key it answers is a real, non-empty `en` string (no literal ever reaches a row)', () => {
        for (const { panel, standIn } of CASES) {
            const body = panelBodyOf(panel, standIn);

            if (body?.kind === 'explanation') {
                expect(recipeFormMessages.en[body.key].length).toBeGreaterThan(0);
            }
        }
    });

    it('⛔ the named FOOD_REMOVED copy is never shown on a nameless row: it says the name is unchanged', () => {
        expect(recipeFormMessages.en.statusExplainFoodRemoved).toMatch(/name/);
        expect(panelBodyOf('foodRemoved', true)).toEqual({ kind: 'foodRemovedNameless' });
    });

    it('the two prompts name the row actions they point at, by their own labels', () => {
        const en = recipeFormMessages.en;

        expect(en.errorPromptEntryMode).toContain('{createLabel}');
        expect(en.statusExplainFoodRemovedUnnamed).toContain('{changeFoodLabel}');
    });
});
