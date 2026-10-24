'use client';

/**
 * @module components/recipes/RecipeVersionsFrame — the version history's pinned-back-bar frame, shared by its three states
 * (loading, failed, settled) so each draws the SAME bar over the SAME page
 * (`docs/design/uiRefreshWorkshop5/pinnedBackBar.md` §6), and the route's way back.
 *
 * The frame belongs to the ROUTE, not to the presentational leaves: `RecipeVersionsRouteLoading` and
 * `RecipeVersionsContainer` mount it around the leaves, which draw the header's eyebrow (from 840) and no bar. The bar's
 * title is "Version history" in every state. Its parent is "Recipe" while loading and failed, and the recipe's own title
 * once settled (`parent`): only the label text changes when the page settles, the chevron does not move.
 *
 * @pattern Adapter over the design system's `PushedPageFrame` — names the history's title and its Back
 */
import { recipeVersionMessages, VERSION_TITLE_ID, versionBackOf } from '@commise/features-recipes';
import { useMessages } from '@commise/i18n/react';
import { PushedPageFrame } from '@commise/ui/pushed-page';
import type { Route } from 'next';
import { useParams, useRouter } from 'next/navigation';
import type { FC, ReactNode } from 'react';

/** The way back to a recipe, for the leaves' eyebrow and the frame's bar alike. */
export interface RecipeVersionsNav {
    /** The recipe's address, so a modified click still works. */
    readonly recipeHref: string;
    /** Go to the recipe. */
    readonly goToRecipe: () => void;
}

/**
 * The route's way back to the recipe.
 *
 * @param recipeId - The recipe the history belongs to.
 * @returns Its address and the navigation to it.
 */
export function useRecipeVersionsNav(recipeId: string): RecipeVersionsNav {
    const { locale } = useParams<{ locale: string }>();
    const router = useRouter();
    const recipeHref = `/${locale}/recipes/${recipeId}`;

    return { recipeHref, goToRecipe: () => router.push(recipeHref as Route) };
}

/** Props for {@link RecipeVersionsFrame}. */
export interface RecipeVersionsFrameProps {
    /** The recipe the history belongs to. */
    readonly recipeId: string;
    /** The parent's name beside the chevron: the recipe's title once it is known; absent says "Recipe". */
    readonly parent?: string;
    readonly children: ReactNode;
}

/**
 * The pinned bar over one state of the version history.
 *
 * @param props - The recipe, the parent's name once known, and the state's content.
 * @returns The content in the frame.
 */
export const RecipeVersionsFrame: FC<RecipeVersionsFrameProps> = ({ recipeId, parent, children }) => {
    const { versionList } = useMessages(recipeVersionMessages);
    const { recipeHref, goToRecipe } = useRecipeVersionsNav(recipeId);
    const back = versionBackOf(versionList.backToRecipe, parent ?? versionList.recipeParent, goToRecipe, recipeHref);

    return (
        <PushedPageFrame back={back} headingId={VERSION_TITLE_ID} title={versionList.heading}>
            {() => children}
        </PushedPageFrame>
    );
};
