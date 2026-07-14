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
        <article aria-label={recipe.title}>
            <button type="button" onClick={() => onSelect(recipe.id)}>
                {recipe.title}
            </button>
            {recipe.sourceAttribution !== undefined ? (
                <p>{fillTemplate(discovery.attribution, { source: recipe.sourceAttribution })}</p>
            ) : null}
            <button
                type="button"
                aria-label={cloneLabel}
                aria-busy={isCloning}
                disabled={isCloning}
                onClick={() => onClone(recipe.id)}
            >
                {isCloning ? discovery.cloning : discovery.clone}
            </button>
        </article>
    );
};
