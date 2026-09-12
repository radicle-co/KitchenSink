/**
 * @module @commise/features-recipes — native discovery LOADING body (presentational).
 *
 * The React Native twin of `RecipeDiscoveryLoading`: the shared native `RecipeCardGridSkeleton` — inert, motion-free
 * placeholders under the localized label — while a search with nothing to show yet is pending.
 */
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';

import { RecipeCardGridSkeleton } from '../card/RecipeCardGridSkeleton.native.js';
import { discoveryMessages } from './messages.js';

export const RecipeDiscoveryLoading: FC = () => {
    const discovery = useMessages(discoveryMessages);

    return <RecipeCardGridSkeleton label={discovery.loadingLabel} />;
};
