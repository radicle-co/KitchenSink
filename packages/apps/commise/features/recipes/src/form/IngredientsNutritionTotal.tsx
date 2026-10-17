'use client';

/**
 * @module @commise/features-recipes/form — `IngredientsNutritionTotal` (web): the Ingredients section's running total
 * (build spec §7.5.6), at the section's foot and at the section index's rail foot. Loading is skeleton text (still under
 * `prefers-reduced-motion`), never a partial figure; failed is the failure and, where the host offers it, Try again;
 * ready is "612 cal per serving · 7 of 9 counted", or "Nutrition appears as you match ingredients." — never "0 cal".
 *
 * Presentational: `props → JSX` over the total's view (`nutritionTotalViewOf`).
 *
 * @pattern Visitor — an exhaustive `switch` over the total's view
 */
import { Button } from '@commise/ui/button';
import type { FC, ReactElement } from 'react';

import type { NutritionTotalView } from './nutritionTotal.js';

/** Props for {@link IngredientsNutritionTotal}. */
export interface IngredientsNutritionTotalProps {
    readonly view: NutritionTotalView;
    /** The words a screen reader hears while the total loads (the skeleton is drawn, not read). */
    readonly loadingLabel: string;
    readonly failedText: string;
    readonly retryLabel: string;
    /** Read again; absent where the page already offers Try again (the rail foot beside the section's). */
    readonly onRetry?: () => void;
}

/** The running total. */
export const IngredientsNutritionTotal: FC<IngredientsNutritionTotalProps> = ({
    view,
    loadingLabel,
    failedText,
    retryLabel,
    onRetry,
}): ReactElement => {
    switch (view.kind) {
        case 'loading':
            return (
                <p role="status" className="flex flex-col gap-1">
                    <span className="sr-only">{loadingLabel}</span>
                    <span
                        aria-hidden="true"
                        className="block h-4 w-48 max-w-full rounded-sm bg-surface-muted motion-safe:animate-pulse"
                    />
                </p>
            );
        case 'failed':
            return (
                <div className="flex flex-wrap items-center gap-2">
                    <p className="text-caption text-ink-muted">{failedText}</p>
                    {onRetry !== undefined && (
                        <Button variant="secondary" icon="refreshCw" onPress={onRetry}>
                            {retryLabel}
                        </Button>
                    )}
                </div>
            );
        case 'ready':
            return (
                <div className="flex flex-col gap-1">
                    <p className="text-body-sm font-medium tabular-nums text-ink">{view.line}</p>
                    {/* R38: a total computed from one bound of a range says so rather than reading as exact. */}
                    {view.rangeNotice !== undefined && (
                        <p className="text-caption text-ink-muted">{view.rangeNotice}</p>
                    )}
                </div>
            );
    }
};
