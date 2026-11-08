'use client';

/**
 * @module @commise/features-recipes/form — `PasteChoicePane` (web): the side pane at 1194 and on web
 * (`docs/design/uiRefreshWorkshop5/redesignCanvas/ingredientMatching.md`). A named `aside`: which line it shows out of
 * ALL the recipe's lines ("Line 3 of 9", M4), the line as its heading, the muted prompt, a pick that did not save with
 * Try again, the line's `FoodChoiceList`, then Previous and Next open line (`paneStepsOf`).
 *
 * Previous and Next are always drawn and are refused at an end — focusable, the press cancelled, never natively
 * disabled, because the step that reaches the end is the one holding focus (WCAG 2.4.3) — so nothing moves under the
 * cook and the pair never changes shape (a top-level `hasNext && <Button>` would also be §11.2's boolean-selects-a-subtree). A pick in the pane
 * does not move on by itself (staff-ux ruling 2026-10-25): the check appears on the row, and Next moves on.
 *
 * Presentational: props in, markup out. The native leaf is `./PasteChoicePane.native.tsx`.
 */
import { Button } from '@commise/ui/button';
import type { FC } from 'react';

import { FoodChoiceList } from '../ingredientMatching/FoodChoiceList.js';
import { MatchFailureLine } from '../ingredientMatching/MatchFailureLine.js';
import { SeeWhy } from '../ingredientMatching/SeeWhy.js';
import { useRetryFocus } from '../ingredientMatching/useRetryFocus.js';
import type { PasteChoicePaneProps } from './pasteChoicePaneProps.js';

/** The side pane. */
export const PasteChoicePane: FC<PasteChoicePaneProps> = ({
    view,
    onPrevious,
    onNext,
    onRetryPick,
    onSeeWhy,
    retry: hostRetry,
    ...list
}) => {
    const ownRetry = useRetryFocus([view.open.send])(view.open.send.key);
    const retry = hostRetry ?? ownRetry;
    const { why } = view.open;

    return (
        <aside aria-label={view.label} className="flex flex-col gap-3 p-4">
            <div className="flex flex-col gap-1">
                <p className="text-list text-ink-muted">{view.position}</p>
                <h2 className="break-words text-card-title text-ink">{view.heading}</h2>
                {view.open.prompt === undefined ? null : (
                    <p className="break-words text-list text-ink-muted">{view.open.prompt}</p>
                )}
                {why === undefined ? null : (
                    <SeeWhy
                        key={view.open.send.key}
                        label={why.label}
                        reason={why.reason}
                        onOpen={() => onSeeWhy(why.reason)}
                    />
                )}
                {view.open.failure === undefined ? null : (
                    <MatchFailureLine failure={view.open.failure} onRetry={onRetryPick} focus={retry.tryAgain} />
                )}
            </div>
            <FoodChoiceList view={view.open.list} landing={retry.landing} {...list} />
            <div className="flex items-center justify-between gap-2">
                <Button variant="ghost" icon="chevronLeft" refused={view.previous.disabled} onPress={onPrevious}>
                    {view.previous.label}
                </Button>
                <Button
                    variant="ghost"
                    icon="chevronRight"
                    iconPlacement="end"
                    refused={view.next.disabled}
                    onPress={onNext}
                >
                    {view.next.label}
                </Button>
            </div>
        </aside>
    );
};
