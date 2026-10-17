'use client';

/**
 * @module @commise/features-recipes — web discovery LOADING body (presentational).
 *
 * What the discovery suspense boundary renders while a search with nothing to show yet is pending: the shared
 * `RecipeCardGridSkeleton`, the ONE web recipe-grid skeleton (also `RecipeListLoading`'s), so the two card-grid
 * surfaces cannot drift. Its localized label is the visible caption, because an empty `role="status"` announces nothing.
 */
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';

import { RecipeCardGridSkeleton } from '../card/RecipeCardGridSkeleton.js';
import { discoveryMessages } from './messages.js';

export const RecipeDiscoveryLoading: FC<{
    /** The variant the results will draw (compact below 600, grid from 600), so the skeleton sits in their grid. */
    readonly variant?: 'compact' | 'grid';
}> = ({ variant = 'grid' }) => {
    const discovery = useMessages(discoveryMessages);

    return <RecipeCardGridSkeleton label={discovery.loadingLabel} layout="discover" variant={variant} />;
};
