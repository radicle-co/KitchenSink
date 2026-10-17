'use client';

/**
 * @module @commise/features-recipes — the web version history's FAILED state (D3, D13; `buildSpec.md` §6.6: "Error:
 * "We couldn't load the history." + Try again").
 *
 * Under the SAME header the settled list draws, so a failed read still has its way back in its usual place. It replaces
 * a bare paragraph and a raw button beside a floating text link. The copy arrives as props from the app's boundary
 * dictionary.
 *
 * Presentational: props → JSX.
 */
import { Button } from '@commise/ui/button';
import type { FC } from 'react';

import { RecipeVersionListHeader } from './RecipeVersionListHeader.js';

/** Props for {@link RecipeVersionListError}. */
export interface RecipeVersionListErrorProps {
    /** Why there is no history: "We couldn’t load the history." */
    readonly title: string;
    /** The retry control's label: "Try again". */
    readonly retryLabel: string;
    /** Read the history again. */
    readonly onRetry: () => void;
    /** Back to the recipe; absent draws no Back (the native screen keeps its own above the read boundary). */
    readonly onBack?: () => void;
    /** The recipe's address, so a modified click on Back still works. */
    readonly backHref?: string;
}

/**
 * @param props - The words, the retry and the way back.
 * @returns The header, an alert, and a secondary Try again button.
 */
export const RecipeVersionListError: FC<RecipeVersionListErrorProps> = ({
    title,
    retryLabel,
    onRetry,
    onBack,
    backHref,
}) => (
    <section className="flex w-full max-w-list flex-col gap-4 pb-10">
        <RecipeVersionListHeader onBack={onBack} backHref={backHref} />
        <div role="alert" className="flex flex-col items-start gap-3">
            <p className="text-body text-ink">{title}</p>
            <Button variant="secondary" icon="refreshCw" onPress={onRetry}>
                {retryLabel}
            </Button>
        </div>
    </section>
);
