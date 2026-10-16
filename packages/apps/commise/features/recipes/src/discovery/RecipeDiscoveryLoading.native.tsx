/**
 * @module @commise/features-recipes — native discovery LOADING body (presentational).
 *
 * The React Native twin of `RecipeDiscoveryLoading`: the shared native `RecipeCardGridSkeleton` — inert, motion-free
 * placeholders under the localized label — while a search with nothing to show yet is pending. Like the web leaf it
 * draws the variant the results will use (`docs/design/uiOverhaul/buildSpec.md` §4.1: "the same rows at the same
 * sizes"), so nothing changes shape when they land.
 */
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';

import { RecipeCardGridSkeleton } from '../card/RecipeCardGridSkeleton.native.js';
import { discoveryMessages } from './messages.js';

export const RecipeDiscoveryLoading: FC<{
    /** The variant the results will draw (compact below 600, grid from 600), so the skeleton matches them. */
    readonly variant?: 'compact' | 'grid';
}> = ({ variant = 'grid' }) => {
    const discovery = useMessages(discoveryMessages);

    return <RecipeCardGridSkeleton label={discovery.loadingLabel} variant={variant} />;
};
