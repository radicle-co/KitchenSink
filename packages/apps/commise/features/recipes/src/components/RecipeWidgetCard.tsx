/**
 * @module @commise/features-recipes — web recipe-widget card shell (skeleton building block).
 */

import type { FC } from 'react';

import type { RecipeWidgetCardProps } from './props.js';

/**
 * Card container for the recipe Home widget on web. The accessible name is the
 * widget title so assistive tech can navigate between Home widgets by heading.
 */
export const RecipeWidgetCard: FC<RecipeWidgetCardProps> = ({ title, children }) => {
    return (
        <section
            aria-label={title}
            className="flex flex-col gap-3 rounded-2xl bg-card p-5 shadow-sm ring-1 ring-border"
        >
            <h3 className="font-display text-heading-md font-semibold text-charcoal">{title}</h3>
            {children}
        </section>
    );
};
