/**
 * @module @commise/features-recipes — web recipe-list card (building block).
 *
 * One row in the recipe list: an actionable control whose accessible name is the recipe title (so the
 * list navigates by title) plus the formatted total time. Presentational — it reports selection upward
 * and holds no state.
 */
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';

import { recipeMessages } from '../messages.js';
import { formatDurationMinutes, type RecipeListCardProps } from './model.js';

/**
 * A single recipe row on web.
 *
 * @param props - The recipe view-model and the selection callback.
 */
export const RecipeListCard: FC<RecipeListCardProps> = ({ recipe, onSelect }) => {
    const { list } = useMessages(recipeMessages);
    const duration = formatDurationMinutes(recipe.totalTimeMinutes, list.durationMinutes);

    return (
        <article aria-label={recipe.title}>
            <button type="button" onClick={() => onSelect(recipe.id)}>
                {recipe.title}
            </button>
            <span>{duration}</span>
        </article>
    );
};
