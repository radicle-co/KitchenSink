/**
 * @module @commise/features-recipes — web recipe-widget loading skeleton (building block).
 */

import type { FC } from 'react';

import { MAX_RECENT_RECIPES, type RecipeWidgetSkeletonProps } from './props.js';

/**
 * Loading placeholder for the recipe Home widget on web. Marked presentational so
 * screen readers skip the placeholder rows.
 */
export const RecipeWidgetSkeleton: FC<RecipeWidgetSkeletonProps> = ({ itemCount = MAX_RECENT_RECIPES }) => {
    const placeholders = Array.from({ length: itemCount }, (_unused, index) => index);

    return (
        <div role="presentation" aria-hidden="true" className="flex flex-col gap-2">
            {placeholders.map((key) => (
                <div key={key} className="h-8 animate-pulse rounded-lg bg-pearl" />
            ))}
        </div>
    );
};
