'use client';

/**
 * @module @commise/features-recipes/card — the meta line's shared logic, behind a client boundary, for both `RecipeCard`
 * leaves: which parts make the run, when there is no line at all, and where the calorie figure's lead dot comes from.
 *
 * The leaves differ only in the primitives they draw a part with and the frame (a `<p>` on web, a `Text` on native) the run
 * sits in; everything else is decided here once, so the two cannot drift. It holds a React context, which is why it is not
 * part of the pure `metaRun.ts` builder: a server page reaches that module, and `createContext` may not be called there.
 *
 * @pattern Template Method — the shared skeleton of the line; the leaf supplies its parts and its frame
 */
import { createContext, useContext, type ComponentType, type FC, type ReactNode } from 'react';

import { META_SEPARATOR, metaRunOf } from './metaRun.js';
import { RecipeCardNutritionContext } from './recipeCardContext.js';

/**
 * What a part that may settle on nothing (the calorie figure) draws before itself: the separator when parts precede it, and
 * nothing when it comes first. The part draws it only when it has something to say, so a figure that settles on nothing
 * leaves no dot behind, on either platform.
 */
export const MetaLeadContext = createContext('');

/** Props for {@link MetaLine}. */
export interface MetaLineProps {
    /** The line's parts in reading order; a part with no data is `undefined`, `null`, `false` or `''`. */
    readonly parts: readonly ReactNode[];
    /** The frame the run sits in: a paragraph on web, a text on native. */
    readonly Frame: ComponentType<{ readonly children: ReactNode }>;
}

/**
 * The meta line: the parts that exist joined into one run, then the calorie figure. A line with no part and no figure is not
 * drawn at all, so a tile does not hold a blank row (UI Designer ruling, 2026-11-03).
 *
 * @param props - The parts and the frame.
 * @returns The line, or nothing.
 */
export const MetaLine: FC<MetaLineProps> = ({ parts, Frame }) => {
    const nutrition = useContext(RecipeCardNutritionContext);
    const run = metaRunOf(parts);

    if (run.length === 0 && nutrition === null) {
        return null;
    }

    return (
        <Frame>
            {run}
            <MetaLeadContext.Provider value={run.length > 0 ? META_SEPARATOR : ''}>
                {nutrition}
            </MetaLeadContext.Provider>
        </Frame>
    );
};
