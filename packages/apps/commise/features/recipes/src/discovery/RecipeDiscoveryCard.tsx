/**
 * @module @commise/features-recipes — web public-discovery result card (T076 / W4 S1).
 *
 * One search result, composed from the shared {@link RecipeCard} COMPOUND parts (P7 — search is one of the
 * card's four surfaces): a tappable cover + title that navigates to the recipe, the `by @handle` author
 * attribution (and imported-source provenance when present), the cuisine/time/calorie meta, the visibility
 * badge, rating, and tags — plus the Clone action that copies the public recipe into the viewer's library.
 * Presentational: it reports selection/clone upward and holds no state. Building it from `RecipeCard.*`
 * (rather than a widening discovery prop bag) is exactly why the card is a compound component.
 */
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';

import { RecipeCard } from '../card/index.js';
import { fillTemplate } from '../list/model.js';
import { discoveryMessages } from './messages.js';
import type { RecipeDiscoveryCardProps } from './model.js';

/**
 * A single public-recipe search result on web.
 *
 * @param props - The card view-model, the author handle / source attribution, the per-row clone-busy flag,
 *   and the selection/clone callbacks.
 */
export const RecipeDiscoveryCard: FC<RecipeDiscoveryCardProps> = ({
    recipe,
    authorHandle,
    sourceAttribution,
    isCloning,
    onSelect,
    onClone,
}) => {
    const discovery = useMessages(discoveryMessages);
    const cloneLabel = fillTemplate(isCloning ? discovery.cloningLabel : discovery.cloneLabel, { title: recipe.title });

    return (
        <RecipeCard recipe={recipe}>
            {/* Cover + title navigate; a single button so the row is reached by its title (list contract). */}
            <button
                type="button"
                aria-label={recipe.title}
                onClick={() => onSelect(recipe.id)}
                className="block w-full text-left"
            >
                <RecipeCard.Cover />
                <div className="px-4 pt-4">
                    <RecipeCard.Title />
                </div>
            </button>
            <div className="flex flex-col gap-2 px-4 pb-4 pt-2">
                {authorHandle !== undefined && (
                    <p className="text-body-sm text-slate">
                        {fillTemplate(discovery.byAuthor, { handle: authorHandle })}
                    </p>
                )}
                {sourceAttribution !== undefined && (
                    <p className="text-body-sm text-slate">
                        {fillTemplate(discovery.attribution, { source: sourceAttribution })}
                    </p>
                )}
                <RecipeCard.Meta />
                <RecipeCard.Badges />
                <RecipeCard.Rating />
                <RecipeCard.Tags />
                <button
                    type="button"
                    aria-label={cloneLabel}
                    aria-busy={isCloning}
                    disabled={isCloning}
                    onClick={() => onClone(recipe.id)}
                    className="mt-1 self-start rounded-full border border-coral bg-transparent px-4 py-2 text-body-sm font-semibold text-coral transition hover:bg-coral/10 disabled:opacity-60"
                >
                    {isCloning ? discovery.cloning : discovery.clone}
                </button>
            </div>
        </RecipeCard>
    );
};
