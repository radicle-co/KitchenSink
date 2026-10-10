/**
 * @module @commise/features-recipes/form — the explanation each ingredient-row panel shows
 * (`docs/design/ingredientStatusExplanation.md` SPECIFY.2, `namelessLineCopy.md` §6c).
 *
 * The row policy (`./ingredientRowPolicy.ts`) names WHICH panel a row's glyph opens; this module names its body: the
 * nutrition panel, the FAILED Try again, one sentence that explains the row, or a prompt that names one of the row's
 * actions by its label. Every panel has a body, so every row shows its glyph (V1 sign-off item 3a).
 *
 * Pure and platform-agnostic: both leaves read it, so the two cannot explain a row differently.
 *
 * @pattern Visitor — an exhaustive `switch` over `IngredientRowPanel`
 */
import type { IngredientRowPanel } from './ingredientRowPolicy.js';
import type { RecipeFormMessages } from './messages.js';

/** The message keys a row panel can explain itself with. */
export type RowPanelExplanationKey = keyof Pick<
    RecipeFormMessages,
    | 'nutritionWorking'
    | 'nutritionNoneUnavailable'
    | 'statusExplainUnresolved'
    | 'statusExplainNeedsReview'
    | 'statusExplainNotFound'
    | 'statusExplainFoodRemoved'
    | 'statusExplainFoodUnreachable'
>;

/** A row panel's body. */
export type RowPanelBody =
    /** The nutrition panel (`./nutritionPanel.ts`). */
    | { readonly kind: 'nutrition' }
    /** The FAILED explanation with its own Try again: a status read that re-asks food, no recipe write. */
    | { readonly kind: 'lookupFailed' }
    | { readonly kind: 'explanation'; readonly key: RowPanelExplanationKey }
    /** Row 2's two equal paths (§5a), naming Create my own food (`errorPromptEntryMode`). */
    | { readonly kind: 'twoPaths' }
    /** A nameless row 12, naming Change food (`statusExplainFoodRemovedUnnamed`, `namelessLineCopy.md` §6c). */
    | { readonly kind: 'foodRemovedNameless' }
    /** Row 6: the binding's own candidates to choose from, and None of these (SPECIFY.1 row 6). */
    | { readonly kind: 'candidates' }
    /** Row 7: the line's re-derived shortlist, one pick for this line, and None of these (SPECIFY.1 row 7). */
    | { readonly kind: 'shortlist' };

const explanation = (key: RowPanelExplanationKey): RowPanelBody => ({ kind: 'explanation', key });

/**
 * The body a row's panel shows. Pure.
 *
 * @param panel - The panel the row policy chose.
 * @param standIn - Whether the row shows a stand-in instead of a name.
 * @returns The body.
 */
export const panelBodyOf = (panel: IngredientRowPanel, standIn: boolean): RowPanelBody => {
    switch (panel) {
        case 'noData':
        case 'nutrition':
            // The nutrition body: the cook's own figures, food's, or "no nutritional data available" (§6b).
            return { kind: 'nutrition' };
        case 'twoPaths':
            return { kind: 'twoPaths' };
        case 'working':
            return explanation('nutritionWorking');
        case 'candidates':
            return { kind: 'candidates' };
        case 'shortlist':
            return { kind: 'shortlist' };
        case 'needsReview':
            return explanation('statusExplainNeedsReview');
        case 'notFound':
            return explanation('statusExplainNotFound');
        case 'failed':
            return { kind: 'lookupFailed' };
        case 'privateFood':
            return explanation('nutritionNoneUnavailable');
        case 'foodRemoved':
            // ⛔ The named copy says "Your amount and name are unchanged", false on a nameless row.
            return standIn ? { kind: 'foodRemovedNameless' } : explanation('statusExplainFoodRemoved');
        case 'foodUnreachable':
            return explanation('statusExplainFoodUnreachable');
    }
};
