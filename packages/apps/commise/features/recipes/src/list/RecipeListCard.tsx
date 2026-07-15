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
        <article aria-label={recipe.title} className="group">
            <button
                type="button"
                onClick={() => onSelect(recipe.id)}
                // The accessible name stays exactly the title (not "title + duration") so name-based
                // selection — tests, the Playwright suite, and the Maestro flows — keeps resolving the card.
                aria-label={recipe.title}
                className="flex w-full flex-col gap-2 rounded-2xl bg-card p-5 text-left shadow-sm ring-1 ring-border transition hover:-translate-y-0.5 hover:shadow-md"
            >
                <span className="font-display text-heading-md font-semibold text-charcoal transition-colors group-hover:text-seafoam">
                    {recipe.title}
                </span>
                <span className="flex items-center gap-1 text-body-sm text-slate">{duration}</span>
            </button>
        </article>
    );
};
