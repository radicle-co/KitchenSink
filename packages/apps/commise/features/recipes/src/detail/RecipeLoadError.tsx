/**
 * @module @commise/features-recipes/detail — `RecipeLoadError`: what a recipe read's boundary renders when the read fails.
 * A 404 is final, so it offers no retry; any other failure — including an id that cannot name a recipe, where there is no
 * evidence the recipe is gone — is the generic one, whose retry is the boundary's reset, which refetches. Both keep a way
 * back, which the host names ("Back to My recipes", "Back to Discover") because only it knows where back goes.
 *
 * ONE file for both apps: the design system's `StateNotice` is a platform pair, so the web page gets an alert in its flow
 * and the mobile screen gets the thumb-reach stack.
 *
 * @pattern Adapter over the design system's `StateNotice` — picks the title and whether a retry is on offer from the error
 */
import { useMessages } from '@commise/i18n/react';
import { StateNotice, type StateNoticeAction } from '@commise/ui/state-notice';
import { isNotFoundError } from '@kitchensink/recipe-service-client';
import type { FC } from 'react';

import { recipeLoadMessages } from './messages.js';

/** Props for {@link RecipeLoadError}. */
export interface RecipeLoadErrorProps {
    /** What the read failed with. */
    readonly error: unknown;
    /** Read again: the boundary's reset. */
    readonly onRetry: () => void;
    /** The way back, if the host has one. */
    readonly back?: StateNoticeAction;
}

/** A recipe read failed: presentational, props → JSX. */
export const RecipeLoadError: FC<RecipeLoadErrorProps> = ({ error, onRetry, back }) => {
    const copy = useMessages(recipeLoadMessages);
    const notFound = isNotFoundError(error);

    return (
        <StateNotice
            title={notFound ? copy.notFoundTitle : copy.errorTitle}
            {...(notFound ? {} : { primary: { label: copy.retry, icon: 'refreshCw', onPress: onRetry } })}
            {...(back === undefined ? {} : { secondary: back })}
        />
    );
};
