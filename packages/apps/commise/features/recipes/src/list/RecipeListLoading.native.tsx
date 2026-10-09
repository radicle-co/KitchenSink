/**
 * @module @commise/features-recipes — native recipe-list LOADING fallback (presentational): what the list's `Suspense`
 * renders while the library is pending.
 *
 * Skeleton cards (NOT a blank view — U4): inert, motion-free placeholders shaped like a recipe card, so the surface has
 * structure while the library loads. Motion-free ⇒ no reduce-motion gate. ⛔ No create button and no chips — see the web
 * leaf and `shouldShowCreateButton` for why a button must not mount over an unanswered library.
 */
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';

import { RecipeCardGridSkeleton } from '../card/RecipeCardGridSkeleton.native.js';
import { recipeMessages } from '../messages.js';
import type { RecipeListLoadingProps } from './model.js';

/** Six skeletons of the variant the cards will use (`docs/design/uiOverhaul/buildSpec.md` §4.3 Loading). */
export const RecipeListLoading: FC<RecipeListLoadingProps> = ({ variant }) => {
    const { list } = useMessages(recipeMessages);

    return <RecipeCardGridSkeleton label={list.loadingLabel} variant={variant} />;
};
