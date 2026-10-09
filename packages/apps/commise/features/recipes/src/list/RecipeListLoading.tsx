'use client';

/**
 * @module @commise/features-recipes — web recipe-list LOADING fallback (presentational): what the list's `Suspense`
 * renders while the library is pending.
 *
 * The ONE authoritative web recipe-grid skeleton, shared with `RecipeDiscoveryLoading` so the two card-grid surfaces
 * cannot drift; it captions itself with the localized label, because an empty `role="status"` region announces
 * nothing. ⛔ It renders NO create button and no chips: until the library answers, the app cannot tell an empty library
 * from an unanswered one, and a button mounted here unmounted under a first-run cook's finger when the empty state
 * settled (see `shouldShowCreateButton`).
 */
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';

import { RecipeCardGridSkeleton } from '../card/RecipeCardGridSkeleton.js';
import { recipeMessages } from '../messages.js';
import type { RecipeListLoadingProps } from './model.js';

/** Six skeletons of the variant the cards will use (`docs/design/uiOverhaul/buildSpec.md` §4.3 Loading). */
export const RecipeListLoading: FC<RecipeListLoadingProps> = ({ variant }) => {
    const { list } = useMessages(recipeMessages);

    return <RecipeCardGridSkeleton label={list.loadingLabel} variant={variant} />;
};
