/**
 * @module @commise/features-recipes/form — the explanation each ingredient-row panel shows
 * (`docs/design/ingredientStatusExplanation.md` SPECIFY.2, `namelessLineCopy.md` §6c).
 *
 * The row policy (`./ingredientRowPolicy.ts`) names WHICH panel a row's glyph opens; this module names its body: the
 * nutrition panel, or the one sentence that explains the row. `undefined` means the panel's designed body has not shipped, and then the row renders no glyph rather
 * than a panel that points the cook at a control that is not there. Each such kind names the plan 002 V1 step that
 * fills it.
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
    | 'statusExplainAmbiguous'
    | 'statusExplainNeedsReview'
    | 'statusExplainNotFound'
    | 'statusExplainFoodRemoved'
    | 'statusExplainFoodUnreachable'
>;

/** A row panel's body: the nutrition panel (`./nutritionPanel.ts`), the FAILED Try again, or one sentence. */
export type RowPanelBody =
    | { readonly kind: 'nutrition' }
    /** The FAILED explanation with its own Try again: a status read that re-asks food, no recipe write. */
    | { readonly kind: 'lookupFailed' }
    | { readonly kind: 'explanation'; readonly key: RowPanelExplanationKey };

const explanation = (key: RowPanelExplanationKey): RowPanelBody => ({ kind: 'explanation', key });

/**
 * The body a row's panel shows, or `undefined` when that panel's body is still owed. Pure.
 *
 * @param panel - The panel the row policy chose.
 * @param standIn - Whether the row shows a stand-in instead of a name.
 * @returns The body, or `undefined`.
 */
export const panelBodyOf = (panel: IngredientRowPanel, standIn: boolean): RowPanelBody | undefined => {
    switch (panel) {
        case 'noData':
        case 'nutrition':
            // The nutrition body: the cook's own figures, food's, or "no nutritional data available" (§6b).
            return { kind: 'nutrition' };
        case 'twoPaths':
            // Owed to V1 B7: `errorPromptEntryMode` names the combobox and Create my own food, neither built yet.
            return undefined;
        case 'working':
            return explanation('nutritionWorking');
        case 'candidates':
            return explanation('statusExplainUnresolved');
        case 'shortlist':
            return explanation('statusExplainAmbiguous');
        case 'needsReview':
            return explanation('statusExplainNeedsReview');
        case 'notFound':
            return explanation('statusExplainNotFound');
        case 'failed':
            return { kind: 'lookupFailed' };
        case 'privateFood':
            return explanation('nutritionNoneUnavailable');
        case 'foodRemoved':
            // ⛔ The named copy says "Your amount and name are unchanged", false on a nameless row. The nameless copy
            // (`statusExplainFoodRemovedUnnamed`) tells the cook to use Change food, which is owed to V1 B7.
            return standIn ? undefined : explanation('statusExplainFoodRemoved');
        case 'foodUnreachable':
            return explanation('statusExplainFoodUnreachable');
    }
};
