'use client';

/**
 * @module @commise/features-recipes/import — `ImportWizardNotice`: what the review says in place of a step it cannot
 * show (board WizardStates). Loading names the recipe being read; an error names the recipe, says the choices so far are
 * saved, and offers Try again and Skip this recipe; offline says the choices are kept on the device and the review
 * resumes by itself — with no control, because there is nothing the cook must do (the `OfflineReadSlot` contract).
 *
 * The board's two other states are not here, on purpose: a recipe with nothing to fix is a step whose lines are all
 * matched (`ImportLineList` says so), and a review with no recipe to review has no step at all — every recipe is added
 * without one and the import ends at `ImportSummary`.
 *
 * ONE component for both platforms: it composes only the design system's notices, which resolve to their web or native
 * leaf at bundle time.
 *
 * Presentational: props → JSX; the host decides what Try again and Skip do.
 *
 * @pattern Visitor — an exhaustive switch over the `kind` discriminated union, one house notice per state
 */
import { useMessages } from '@commise/i18n/react';
import { LoadingNotice } from '@commise/ui/loading-notice';
import { OfflineReadSlot } from '@commise/ui/offline-notice';
import { StateNotice } from '@commise/ui/state-notice';
import type { FC } from 'react';

import { fillTemplate } from '@commise/i18n';
import { importMessages } from './messages.js';
import type { ImportWizardNoticeProps } from './props.js';

/** The review's loading, error and offline states. */
export const ImportWizardNotice: FC<ImportWizardNoticeProps> = (props) => {
    const { wizard: w } = useMessages(importMessages);

    switch (props.kind) {
        case 'loading':
            return <LoadingNotice label={fillTemplate(w.loading, { n: props.position, total: props.total })} />;

        case 'error':
            return (
                <StateNotice
                    title={fillTemplate(w.errorTitle, { recipe: props.recipeTitle })}
                    body={w.errorBody}
                    primary={{ label: w.retry, icon: 'refreshCw', onPress: props.onRetry }}
                    secondary={{ label: w.skipRecipe, icon: 'chevronRight', onPress: props.onSkip }}
                />
            );

        case 'offline':
            return <OfflineReadSlot message={w.offline} />;
    }
};
