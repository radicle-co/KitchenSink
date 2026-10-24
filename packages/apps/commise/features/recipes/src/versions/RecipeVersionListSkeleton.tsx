'use client';

/**
 * @module @commise/features-recipes — the web version history's LOADING state (D3; `buildSpec.md` §6.6: "Loading: 3
 * skeleton rows").
 *
 * Under the SAME header the settled list draws, so the page does not move when the history lands. The pinned-back-bar frame
 * is the container's (`RecipeVersionsRouteLoading`). The copy arrives as props from the app's boundary dictionary.
 *
 * Presentational: props → JSX.
 */
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';

import { recipeVersionMessages } from './messages.js';
import { VERSION_TITLE_ID, versionBackOf } from './history.js';
import { RecipeVersionListHeader } from './RecipeVersionListHeader.js';

/** How many placeholder rows stand in for the history. */
const PLACEHOLDER_ROWS = [0, 1, 2] as const;

/** Props for the loading state, native's too: what is loading. */
export interface RecipeVersionListSkeletonProps {
    /** What is loading, localised ("Loading version history"): the status's name and its content. */
    readonly label: string;
}

/** Props for the WEB loading state: the shared props and the way back, which native's pinned bar owns instead. */
export interface RecipeVersionListSkeletonWebProps extends RecipeVersionListSkeletonProps {
    /** Back to the recipe, the header's eyebrow from 840; absent draws no Back. */
    readonly onBack?: () => void;
    /** The recipe's address, so a modified click on Back still works. */
    readonly backHref?: string;
}

/**
 * @param props - The status's name and the way back.
 * @returns The header, one polite status, and three decorative rows.
 */
export const RecipeVersionListSkeleton: FC<RecipeVersionListSkeletonWebProps> = ({ label, onBack, backHref }) => {
    const { versionList } = useMessages(recipeVersionMessages);
    const back = versionBackOf(versionList.backToRecipe, versionList.recipeParent, onBack, backHref);

    return (
        <section className="flex w-full max-w-list flex-col gap-4 pb-10">
            <RecipeVersionListHeader headingId={VERSION_TITLE_ID} back={back} />
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
};
