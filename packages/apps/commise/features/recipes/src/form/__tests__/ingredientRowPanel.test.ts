/**
 * Unit tests for `panelBodyOf` (`../ingredientRowPanel.ts`) — which body the row's status panel shows for each panel
 * kind the row policy names.
 *
 * REWRITTEN for plan 002 V1 B5: `RESOLVED` and the declared row now open the NUTRITION body (fed by the editor's one
 * read), and `PENDING` gets its explanation back — a poll that turns it `RESOLVED` now SWAPS the body under an open
 * panel instead of unmounting it (SPECIFY §4, "Status advances while open").
 *
 * ⛔ An `undefined` answer means the row renders NO status glyph, so each one is pinned with the reason it is owed: a
 * panel whose designed copy names a control that has not shipped would tell the cook to press something that is not
 * there. The table is total over `IngredientRowPanel`, so a kind added to the policy without a decision here fails.
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
    // Owed to plan 002 V1 B7: `errorPromptEntryMode` names the combobox and Create my own food.
    { panel: 'twoPaths', standIn: false, expected: undefined },
    { panel: 'nutrition', standIn: false, expected: { kind: 'nutrition' } },
    { panel: 'working', standIn: false, expected: explanation('nutritionWorking') },
    { panel: 'candidates', standIn: false, expected: explanation('statusExplainUnresolved') },
    { panel: 'shortlist', standIn: false, expected: explanation('statusExplainAmbiguous') },
    { panel: 'needsReview', standIn: false, expected: explanation('statusExplainNeedsReview') },
    { panel: 'notFound', standIn: false, expected: explanation('statusExplainNotFound') },
    // Orchestrator slice 2: the FAILED explanation carries its own Try again (a status read, no recipe write).
    { panel: 'failed', standIn: false, expected: { kind: 'lookupFailed' } },
    { panel: 'privateFood', standIn: true, expected: explanation('nutritionNoneUnavailable') },
    { panel: 'foodRemoved', standIn: false, expected: explanation('statusExplainFoodRemoved') },
    // Owed to B7: the nameless copy (`namelessLineCopy.md` §6c) tells the cook to use Change food.
    { panel: 'foodRemoved', standIn: true, expected: undefined },
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
        expect(panelBodyOf('foodRemoved', true)).toBeUndefined();
    });
});
