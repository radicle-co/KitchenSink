/**
 * @module @commise/features-recipes — web public-discovery card (T076 building block).
 *
 * One row in the discovery list: an actionable title (accessible name = the recipe title, so the list
 * navigates by title), the recipe's source attribution when present, and a Clone action that copies the
 * public recipe into the viewer's collection. The clone control busies (aria-busy) and disables while this
 * row's clone is in flight. Presentational — it reports selection/clone upward and holds no state.
 */
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';

import { fillTemplate } from '../list/model.js';
import { discoveryMessages } from './messages.js';
import type { RecipeDiscoveryCardProps } from './model.js';

/**
 * A single public-recipe row on web.
 *
 * @param props - The discovery view-model, the per-row clone-busy flag, and the selection/clone callbacks.
 */
export const RecipeDiscoveryCard: FC<RecipeDiscoveryCardProps> = ({ recipe, isCloning, onSelect, onClone }) => {
    const discovery = useMessages(discoveryMessages);
    const cloneLabel = fillTemplate(isCloning ? discovery.cloningLabel : discovery.cloneLabel, { title: recipe.title });

    return (
        <article
            aria-label={recipe.title}
            className="group flex h-full flex-col gap-3 rounded-2xl bg-card p-5 shadow-sm ring-1 ring-border transition hover:shadow-md"
        >
            <button
                type="button"
                aria-label={recipe.title}
                onClick={() => onSelect(recipe.id)}
                className="text-left font-display text-heading-md font-semibold text-charcoal transition-colors group-hover:text-seafoam"
            >
                {recipe.title}
            </button>
            {recipe.sourceAttribution !== undefined ? (
                <p className="text-body-sm text-slate">
                    {fillTemplate(discovery.attribution, { source: recipe.sourceAttribution })}
                </p>
            ) : null}
            <button
                type="button"
                aria-label={cloneLabel}
                aria-busy={isCloning}
                disabled={isCloning}
                onClick={() => onClone(recipe.id)}
                className="mt-auto self-start rounded-full bg-coral px-4 py-2 text-body-sm font-semibold text-white shadow-sm transition hover:opacity-90 disabled:opacity-60"
            >
                {isCloning ? discovery.cloning : discovery.clone}
            </button>
        </article>
    );
};
