/**
 * @module @commise/features-recipes — the web loading state of Home's "Recent recipes" block: the real heading over four
 * skeletons of the variant the cards will use, in Home's grid (`docs/design/uiOverhaul/buildSpec.md` §4.2 Loading).
 * Shared by the widget's own Suspense and the host slot's, so the wait looks the same whichever is showing.
 */
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';

import { RecipeCardGridSkeleton } from '../card/RecipeCardGridSkeleton.js';
import { recipeMessages } from '../messages.js';
import { MAX_RECENT_RECIPES, type RecipeWidgetLoadingCardProps } from './props.js';
import { RecipeWidgetCard } from './RecipeWidgetCard.js';

export const RecipeWidgetLoadingCard: FC<RecipeWidgetLoadingCardProps> = ({ variant, seeAll }) => {
    const { widgetTitle, list } = useMessages(recipeMessages);

    return (
        <RecipeWidgetCard title={widgetTitle} {...(seeAll === undefined ? {} : { seeAll })}>
            <RecipeCardGridSkeleton
                label={list.loadingLabel}
                variant={variant}
                layout="home"
                count={MAX_RECENT_RECIPES}
            />
        </RecipeWidgetCard>
    );
};
