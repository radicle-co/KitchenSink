'use client';

/**
 * @module components/recipes/RecipeGridRouteLoading — the localized route-level loading state for the two
 * segments whose settled body is a recipe-card GRID (`/[locale]/recipes`, `/[locale]/discover`).
 *
 * Pure `props → JSX` (no props): the shared {@link RecipeCardGridSkeleton} plus the one thing a `loading.tsx`
 * cannot supply on its own — the localized label, which comes from a client hook (`useMessages`), exactly as
 * {@link RouteLoadingState} resolves its own copy.
 *
 * ⛔ WHY NOT `RouteLoadingState` HERE. That is a single line of text. On a route that is about to paint a
 * four-column card grid, a text line means the whole page reflows the moment the segment resolves, and the
 * viewer sees nothing recipe-shaped in the meantime — which is what left "skeleton loaders for recipes"
 * unmet at the ROUTE level even after every in-page list grew one. `RecipeCardGridSkeleton`'s column rhythm
 * is character-identical to the populated `<ul>` in `RecipeList` / `RecipeDiscoveryList`, so the placeholder
 * reserves the space the cards will occupy.
 *
 * ⚠️ IT IS NOT FOR EVERY ROUTE. `/collections` settles into a THREE-column grid of COLLECTION cards, and
 * `/recipes/[id]` settles into a single detail view; painting recipe-card placeholders on either would
 * reflow rather than reserve, which is the exact invariant this skeleton exists to hold. Those two keep
 * `RouteLoadingState`.
 */
import { RecipeCardGridSkeleton, recipeMessages } from '@commise/features-recipes';
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';

/**
 * The route-level recipe-grid skeleton.
 *
 * @returns The captioned live region over the decorative, reduced-motion-safe placeholder card grid.
 */
export const RecipeGridRouteLoading: FC = () => {
    const { list } = useMessages(recipeMessages);

    return (
        <div className="mx-auto w-full max-w-6xl px-4 py-8">
            <RecipeCardGridSkeleton label={list.loadingLabel} />
        </div>
    );
};
