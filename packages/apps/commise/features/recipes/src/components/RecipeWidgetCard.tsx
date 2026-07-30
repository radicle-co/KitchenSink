/**
 * @module @commise/features-recipes — web recipe-widget card shell (skeleton building block).
 */

import type { FC } from 'react';

import type { RecipeWidgetCardProps } from './props.js';

/**
 * Section container for the recipe Home widget on web. The accessible name is the
 * widget title so assistive tech can navigate between Home widgets by heading.
 *
 * Deliberately carries NO surface of its own — no background, shadow, or ring. The mockup's
 * section-level Home widgets (Recent Recipes, This Week's Meals) are a heading row plus their grid
 * directly on the page background, and the U8 frosted-glass treatment lives on each CARD inside.
 * An opaque `bg-card` (#FFFFFF) here would sit between the page and `glass.card`'s translucent
 * rgba(255,255,255,0.85), rendering the glass and its saturate() as flat white-on-white — the brand
 * surface would be present in the DOM yet invisible on screen. (The roadmap placeholders are a
 * different shape: they ARE cards, via `PlaceholderWidgetCard`.)
 */
export const RecipeWidgetCard: FC<RecipeWidgetCardProps> = ({ title, children }) => {
    return (
        <section aria-label={title} className="flex flex-col gap-4">
            <h3 className="font-display text-heading-md font-semibold text-charcoal">{title}</h3>
            {children}
        </section>
    );
};
