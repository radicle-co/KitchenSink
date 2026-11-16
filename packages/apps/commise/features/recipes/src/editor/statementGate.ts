/**
 * @module @commise/features-recipes/editor — what the editor does about the source question (ADR-0092), derived once.
 *
 * Exactly one of two things covers a Publish that ends public: the source-statement sheet, when the recipe must say where it
 * is from, or the passive line under the Public card, when it need not. Both the Publish gate and the visibility field read
 * this one answer, so the line is drawn and sent together or neither is.
 *
 * Pure and platform-agnostic. No React, no platform APIs.
 *
 * @pattern Policy — one pure decision over the draft, the stored recipe and whether the cook answered
 */
import { RecipeVisibility, type RecipeDetail } from '@kitchensink/recipe-core';

import { askForStatement } from '../actions/sourceStatement.js';
import { derivedVisibility, draftSourceOf } from '../form/sourceLink.js';
import type { RecipeFormValues } from '../form/values.js';

/** What the editor does about the source question. */
export interface StatementPlan {
    /** A Publish now opens the sheet. */
    readonly asks: boolean;
    /** The passive line is drawn under the Public card, and a publishing write sends the wording it shows. */
    readonly confirmLineShown: boolean;
}

/**
 * @param input.draft - The draft as it is now.
 * @param input.recipe - The recipe the server holds, or `undefined` before the first save.
 * @param input.answered - The cook answered the sheet in this session.
 * @returns Whether Publish asks, and whether the line is shown. Pure.
 */
export function statementPlanOf(input: {
    readonly draft: RecipeFormValues;
    readonly recipe: RecipeDetail | undefined;
    readonly answered: boolean;
}): StatementPlan {
    const { draft, recipe, answered } = input;
    const resultPublic = derivedVisibility(draft, recipe) === RecipeVisibility.PUBLIC;
    const asks = askForStatement({
        draftPasted: draft.pasted === true,
        recipe,
        draftHasSource: draftSourceOf(draft).kind === 'link',
        answered,
        resultPublic,
    });

    return { asks, confirmLineShown: resultPublic && !asks && !answered };
}
