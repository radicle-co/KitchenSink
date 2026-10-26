'use client';

/**
 * @module @commise/features-recipes/import — `ImportWizardStep` (web): one step of the bulk import review (board
 * WizardStep). Save and leave at the top; the recipe as the page's heading; "Recipe 14 of 309 · 3 lines to choose" in
 * words and as a progress bar; the recipe's lines (the host's `ImportLineList`); then Back, Skip and Next recipe.
 *
 * Below the wide container class the action bar is pinned to the bottom of the viewport, so the step's primary action
 * stays within thumb reach however long the recipe; at it (1194 and web) the bar sits in flow under the lines and the
 * recipe rail stands beside the step. Back is absent on the first recipe, and named for the recipe it returns to.
 *
 * When a pick leaves nothing open, the host asks Next recipe to take focus (`nextFocus`), so focus is never dropped to
 * the top of the page (staff-ux 2026-10-25).
 *
 * Presentational: the host decides what each action does. The native leaf is `./ImportWizardStep.native.tsx`.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { ProgressBar } from '@commise/ui/progress-bar';
import type { FC } from 'react';

import { fillTemplate } from '../format/fillTemplate.js';
import { importMessages } from './messages.js';
import type { ImportWizardStepProps } from './props.js';
import { backTargetOf, progressTextOf } from './wizardCopy.js';

/** One step of the import review. */
export const ImportWizardStep: FC<ImportWizardStepProps> = ({
    recipeTitle,
    position,
    total,
    openLines,
    children,
    rail,
    onBack,
    onSkip,
    onNext,
    onSaveAndLeave,
    nextFocus,
}) => {
    const { wizard: w } = useMessages(importMessages);
    const locale = useLocale();
    const backTo = backTargetOf(position);

    return (
        <div className="flex flex-col gap-6 @wide/main:flex-row @wide/main:items-start">
            {rail === undefined ? null : <div className="hidden w-64 shrink-0 @wide/main:block">{rail}</div>}
            <div className="flex min-w-0 max-w-reading flex-1 flex-col gap-4">
                <div className="flex justify-end">
                    <Button variant="ghost" size="sm" onPress={onSaveAndLeave}>
                        {w.saveLeave}
                    </Button>
                </div>
                <h1 className="break-words font-display text-large-title text-ink">{recipeTitle}</h1>
                <div className="flex flex-col gap-2">
                    <p className="text-meta text-ink-muted">
                        {progressTextOf({ position, total, openLines }, w, locale)}
                    </p>
                    <ProgressBar label={w.progressLabel} value={position} max={total} />
                </div>
                {children}
                <div
                    role="group"
                    aria-label={w.actionsLabel}
                    className="sticky bottom-0 flex items-center gap-3 border-t border-line-divider bg-bar py-3 @wide/main:static"
                >
                    {backTo === undefined ? null : (
                        <Button
                            variant="secondary"
                            icon="chevronLeft"
                            accessibilityLabel={fillTemplate(w.backName, { n: backTo })}
                            onPress={onBack}
                        >
                            {w.back}
                        </Button>
                    )}
                    <Button variant="ghost" onPress={onSkip}>
                        {w.skip}
                    </Button>
                    <span className="flex-1" />
                    <Button
                        icon="chevronRight"
                        iconPlacement="end"
                        focusRequested={nextFocus.requested}
                        onFocusRequestHandled={nextFocus.onHandled}
                        onPress={onNext}
                    >
                        {w.next}
                    </Button>
                </div>
            </div>
        </div>
    );
};
