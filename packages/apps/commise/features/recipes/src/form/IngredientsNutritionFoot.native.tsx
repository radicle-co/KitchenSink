/**
 * @module @commise/features-recipes/form — `IngredientsNutritionFoot` (native), the React Native leaf of
 * `./IngredientsNutritionFoot.tsx`: the running total at the section index's rail foot (build spec §7.2, §7.5.6), drawn at `@wide` beside the form. It reads the SAME total as the Ingredients
 * section's foot (`nutritionTotalViewOf`), so the two cannot disagree, and offers no Try again of its own: the section's
 * foot, on the same page, already does.
 *
 * Presentational: it reads only the locale and the copy, and draws the one total. The host passes it as
 * `RecipeEditorView`'s `railFooter`, with the draft and the editor's one nutrition read.
 *
 * @pattern Adapter — the total's view into the rail's foot, over the one presentational total
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import type { FC } from 'react';

import { IngredientsNutritionTotal } from './IngredientsNutritionTotal.native.js';
import { recipeFormMessages } from './messages.js';
import type { IngredientsNutritionFootProps } from './IngredientsNutritionFoot.js';
import { nutritionTotalViewOf } from './nutritionTotal.js';

/** The rail foot's running total. */
export const IngredientsNutritionFoot: FC<IngredientsNutritionFootProps> = ({ values, nutrition }) => {
    const m = useMessages(recipeFormMessages);
    const locale = useLocale();

    return (
        <IngredientsNutritionTotal
            view={nutritionTotalViewOf(values, nutrition, locale, m)}
            loadingLabel={m.nutritionLoading}
            failedText={m.nutritionLoadFailed}
            retryLabel={m.statusActionRetry}
        />
    );
};
