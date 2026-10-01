'use client';

/**
 * @module @commise/features-recipes — web recipe-list FRAME (presentational).
 *
 * The chrome of the recipe list — the gradient title band, the source switcher and the search field — rendered
 * OUTSIDE the list's suspense boundary, which the composing container passes as `children`. A pending or failed read
 * therefore swaps only what is under the search field, never the field a viewer is typing in. It fetches nothing.
 *
 * The heading takes focus when `headingFocusSignal` advances: a retry from the refresh notice (inside the boundary)
 * that succeeds removes the button the viewer pressed, and the container reports that across the boundary.
 */
import { useMessages } from '@commise/i18n/react';
import { useFocusOnSignal } from '@commise/ui/dialog-focus';
import { GradientSurface } from '@commise/ui/surface';
import type { FC } from 'react';

import { recipeMessages } from '../messages.js';
import { RecipeSourceTabs } from './RecipeSourceTabs.js';
import type { RecipeListFrameProps } from './model.js';

export const RecipeListFrame: FC<RecipeListFrameProps> = ({
    searchValue,
    onSearchChange,
    tab,
    headingFocusSignal,
    children,
}) => {
    const { list } = useMessages(recipeMessages);
    const headingRef = useFocusOnSignal<HTMLHeadingElement>(headingFocusSignal);

    return (
        <section aria-label={list.heading} className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8">
            {/* U8: the heading rides a beach-glow gradient title band (mockup recipe-list). */}
            <GradientSurface gradient="hero" className="rounded-2xl">
                <header className="flex items-center justify-between gap-4 p-6">
                    <h1 ref={headingRef} tabIndex={-1} className="font-display text-display-md font-bold text-charcoal">
                        {list.heading}
                    </h1>
                </header>
            </GradientSurface>

            {/* The source switcher (L5) is the ONE shared `RecipeSourceTabs` — the same strip the community
                surface mounts, so the pair stays symmetric and a viewer can always get back. */}
            {tab !== undefined && <RecipeSourceTabs tab={tab} />}

            <input
                type="search"
                aria-label={list.searchLabel}
                placeholder={list.searchPlaceholder}
                value={searchValue}
                onChange={(event) => onSearchChange(event.target.value)}
                // Placeholder text is TEXT: `placeholder:text-slate`, never `mist` (palette JSDoc,
                // `@commise/ui`'s `tokens/colors.ts`). The `border-border` hairline stays `mist`-derived.
                className="w-full rounded-full border border-border bg-card px-5 py-3 text-body-md text-charcoal shadow-sm outline-none placeholder:text-slate focus:ring-2 focus:ring-seafoam"
            />

            {children}
        </section>
    );
};
