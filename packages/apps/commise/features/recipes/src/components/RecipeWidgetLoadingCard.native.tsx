/**
 * @module @commise/features-recipes — the native loading state of Home's "Recent recipes" block: the real heading over
 * four skeletons of the variant the cards will use (`docs/design/uiOverhaul/buildSpec.md` §4.2 Loading).
 */
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';

import { RecipeCardGridSkeleton } from '../card/RecipeCardGridSkeleton.native.js';
import { recipeMessages } from '../messages.js';
import { MAX_RECENT_RECIPES, type RecipeWidgetLoadingCardProps } from './props.js';
import { RecipeWidgetCard } from './RecipeWidgetCard.native.js';

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
