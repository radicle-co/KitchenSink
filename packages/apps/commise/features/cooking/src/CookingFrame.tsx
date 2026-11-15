'use client';

/**
 * @module CookingFrame — the web cooking surface: full screen, outside AppShell, because cooking is a
 * focused task.
 *
 * One centred column at every band: the top bar pinned at the top, the foot pinned at the bottom (the
 * Next preview above the actions), and only the body between them scrolls, so a focus line taller than the screen at
 * the largest text never pushes the place or Back / Next away. The foot keeps a gap above it, so a line cut off at the
 * bottom of the body reads as more to scroll. The surface is a size container, for the under-360 width rules and the
 * short-screen height rule, and is busy while the recipe loads.
 *
 * Presentational: props → JSX.
 */
import type { FC } from 'react';

import type { CookingFrameProps } from './cookingViewProps.js';
import { COOKING_COLUMN } from './cookingLayout.js';

/** The id of the cooking surface's `main`. */
export const COOKING_SURFACE_ID = 'cooking-surface';

/** The web cooking surface. */
export const CookingFrame: FC<CookingFrameProps> = ({ topBar, body, foot, busy }) => (
    <main
        id={COOKING_SURFACE_ID}
        aria-busy={busy ? true : undefined}
        className="flex h-dvh flex-col bg-canvas text-ink [container-type:size]"
    >
        <div className={`mx-auto flex min-h-0 w-full flex-1 flex-col ${COOKING_COLUMN.webClassName}`}>
            {topBar}
            <div data-cooking-scroll className="min-h-0 flex-1 overflow-y-auto">
                {body}
            </div>
            {foot === undefined ? null : (
                <div data-cooking-foot className="flex flex-col gap-2 pt-3">
                    {foot.preview}
                    {foot.actions}
                </div>
            )}
        </div>
    </main>
);
