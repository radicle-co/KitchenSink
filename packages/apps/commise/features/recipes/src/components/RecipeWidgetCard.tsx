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
        <section aria-label={title}>
            <h3>{title}</h3>
            {children}
        </section>
    );
};
