'use client';

/**
 * @module @commise/features-recipes — the web version history's LOADING state (D3; `buildSpec.md` §6.6: "Loading: 3
 * skeleton rows").
 *
 * Under the SAME header the settled list draws, so the page does not move when the history lands. The copy arrives as
 * props from the app's boundary dictionary.
 *
 * Presentational: props → JSX.
 */
import type { FC } from 'react';

import { RecipeVersionListHeader } from './RecipeVersionListHeader.js';

/** How many placeholder rows stand in for the history. */
const PLACEHOLDER_ROWS = [0, 1, 2] as const;

/** Props for {@link RecipeVersionListSkeleton}. */
export interface RecipeVersionListSkeletonProps {
    /** What is loading, localised ("Loading version history"): the status's name and its content. */
    readonly label: string;
    /** Back to the recipe; absent draws no Back (the native screen keeps its own above the read boundary). */
    readonly onBack?: () => void;
    /** The recipe's address, so a modified click on Back still works. */
    readonly backHref?: string;
}

/**
 * @param props - The status's name and the way back.
 * @returns The header, one polite status, and three decorative rows.
 */
export const RecipeVersionListSkeleton: FC<RecipeVersionListSkeletonProps> = ({ label, onBack, backHref }) => (
    <section className="flex w-full max-w-list flex-col gap-4 pb-10">
        <RecipeVersionListHeader onBack={onBack} backHref={backHref} />
        <p role="status" aria-label={label} className="sr-only">
            {label}
        </p>
        <ul aria-hidden="true" className="flex flex-col divide-y divide-line-divider">
            {PLACEHOLDER_ROWS.map((row) => (
                <li key={row} data-skeleton-row className="flex flex-col gap-2 py-3">
                    <div className="h-5 w-2/3 animate-pulse rounded-md bg-surface-muted motion-reduce:animate-none" />
                    <div className="h-4 w-1/3 animate-pulse rounded-md bg-surface-muted motion-reduce:animate-none" />
                </li>
            ))}
        </ul>
    </section>
);
