'use client';

/**
 * @module @commise/features-recipes — the web recipe page's LOADING state (D3; `docs/design/uiOverhaul/buildSpec.md`
 * §6.7: "hero at its real ratio, title, stat and row skeletons. No layout shift").
 *
 * It lays out in the page's own container with the page's own classes (`detailLayoutClasses`), so the blocks sit where
 * the content lands and nothing jumps. The hero is 4:3, the carousel's ratio. ONE polite status names the state, and its
 * CONTENT is the name — a live region announces content, not a label — while every block is decorative and, for a reader
 * who asked for less motion, still.
 *
 * Presentational: props → JSX. The route's `loading.tsx` renders this too, or the swap would shift the layout.
 */
import type { FC } from 'react';

import {
    BODY_GRID,
    DETAIL_ARTICLE,
    DETAIL_TOP_GRID,
    HEADER_BESIDE_PHOTO,
    HERO_PHOTO_CELL,
    INGREDIENTS_COLUMN,
    STEPS_COLUMN,
} from './detailLayoutClasses.js';

/** A decorative block. */
const BLOCK = 'animate-pulse rounded-md bg-surface-muted motion-reduce:animate-none';

/** Props for {@link RecipeDetailSkeleton}. */
export interface RecipeDetailSkeletonProps {
    /** What is loading, localised ("Loading recipe"): the status's name and its content. */
    readonly label: string;
}

/** A column of `count` text-line blocks. */
const Lines: FC<{ readonly count: number }> = ({ count }) => (
    <div className="flex flex-col gap-3">
        {Array.from({ length: count }, (_, index) => (
            <div key={index} className={`${BLOCK} h-5 ${index === count - 1 ? 'w-2/3' : 'w-full'}`} />
        ))}
    </div>
);

/**
 * @param props - The localised name.
 * @returns The page's shape: hero, title, stat strip and the two sections' rows.
 */
export const RecipeDetailSkeleton: FC<RecipeDetailSkeletonProps> = ({ label }) => (
    <div className={DETAIL_ARTICLE}>
        <p role="status" aria-label={label} className="sr-only">
            {label}
        </p>
        <div aria-hidden="true" className="flex flex-col gap-6">
            <div className={DETAIL_TOP_GRID}>
                <div className={HERO_PHOTO_CELL}>
                    <div className={`${BLOCK} aspect-[4/3] w-full rounded-lg`} />
                </div>
                <div className={`flex min-w-0 flex-col gap-3 ${HEADER_BESIDE_PHOTO}`}>
                    <div className={`${BLOCK} h-4 w-1/3`} />
                    <div className={`${BLOCK} h-9 w-full`} />
                    <div className={`${BLOCK} h-9 w-2/3`} />
                    <div className={`${BLOCK} h-20 w-full rounded-lg`} />
                    <div className={`${BLOCK} h-11 w-1/2 rounded-full`} />
                </div>
            </div>
            <div className={BODY_GRID}>
                <div className={INGREDIENTS_COLUMN}>
                    <div className={`${BLOCK} h-6 w-1/3`} />
                    <Lines count={5} />
                </div>
                <div className={STEPS_COLUMN}>
                    <div className="flex flex-col gap-3">
                        <div className={`${BLOCK} h-6 w-1/4`} />
                        <Lines count={4} />
                    </div>
                </div>
            </div>
        </div>
    </div>
);
