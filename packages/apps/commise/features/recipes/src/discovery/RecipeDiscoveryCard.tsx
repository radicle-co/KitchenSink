/**
 * @module @commise/features-recipes — web public-discovery result card (T076 / W4 S1).
 *
 * One search result, composed from the shared {@link RecipeCard} COMPOUND parts (P7 — search is one of the
 * card's four surfaces): a tappable cover + title that navigates to the recipe, the `by @handle` author
 * attribution (and imported-source provenance when present), the cuisine/time/calorie meta, the visibility
 * badge, rating, and tags — plus the Clone action that copies the public recipe into the viewer's library.
 * Presentational: it reports selection/clone upward and holds no state. Building it from `RecipeCard.*`
 * (rather than a widening discovery prop bag) is exactly why the card is a compound component.
 *
 * The Clone action is the design-system `Button` on the `secondary` tier — the same tier the recipe-detail and
 * collection clone affordances wear, so ONE decision governs every clone control in the product. It previously
 * hand-rolled a coral OUTLINE while the collections rail hand-rolled a coral FILL: the shared premise ("clone
 * is coral") is false — no mockup contains a clone action at all, the mockups never fill a button coral, and
 * coral's documented role is the danger register, which is the wrong register for a safe, additive, reversible
 * action. Migrating also fixed real gaps the hand-rolled surface had: no 44px touch floor, no focus ring, and
 * no in-place busy affordance.
 */
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import type { FC } from 'react';

import { CloneIcon } from '../actions/icons.js';
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
                {/* `busy` supplies the in-place spinner, the disabled in-flight guard, and `aria-busy`. The
                    accessible name is the ROW-UNIQUE template (the visible label is the generic "Clone", which
                    would collide across sibling rows), so it is passed as an explicit override. */}
                <div className="mt-1 flex flex-col items-start">
                    <Button
                        variant="secondary"
                        icon={<CloneIcon />}
                        accessibilityLabel={cloneLabel}
                        busy={isCloning}
                        onPress={() => onClone(recipe.id)}
                    >
                        {isCloning ? discovery.cloning : discovery.clone}
                    </Button>
                </div>
            </div>
        </RecipeCard>
    );
};
