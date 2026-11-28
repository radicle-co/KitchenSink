'use client';

/**
 * @module @commise/features-recipes — the web version history's FAILED state (D3, D13; `buildSpec.md` §6.6: "Error:
 * "We couldn't load the history." + Try again").
 *
 * Under the SAME header the settled list draws (its pinned-back-bar frame is the container's), so a failed read still has its way back in its usual place. It replaces
 * a bare paragraph and a raw button beside a floating text link. The copy arrives as props from the app's boundary
 * dictionary.
 *
 * Presentational: props → JSX.
 */
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import type { FC } from 'react';

import { recipeVersionMessages } from './messages.js';
import { VERSION_TITLE_ID, versionBackOf } from './history.js';
import { RecipeVersionListHeader } from './RecipeVersionListHeader.js';

/**
 * The retry a failed read offers, or none: a 404 is final (the recipe was deleted, made private or hidden), so trying again
 * cannot help and the control is not drawn. The label and the handler come together or not at all.
 */
export type RecipeVersionListRetry =
    | {
          /** The retry control's label: "Try again". */
          readonly retryLabel: string;
          /** Read the history again. */
          readonly onRetry: () => void;
      }
    | { readonly retryLabel?: never; readonly onRetry?: never };

/** Props for the failed state, native's too: the words and the retry, if any. */
export type RecipeVersionListErrorProps = RecipeVersionListRetry & {
    /** Why there is no history: "We couldn’t load the history." Or the shared reader sentence, for a 404. */
    readonly title: string;
};

/** Props for the WEB failed state: the shared props and the way back, which native's pinned bar owns instead. */
export type RecipeVersionListErrorWebProps = RecipeVersionListErrorProps & {
    /** Back to the recipe, the header's eyebrow from 840; absent draws no Back. */
    readonly onBack?: () => void;
    /** The recipe's address, so a modified click on Back still works. */
    readonly backHref?: string;
};

/**
 * @param props - The words, the retry and the way back.
 * @returns The header, an alert, and a quiet Try again button when the read can be tried again.
 */
export const RecipeVersionListError: FC<RecipeVersionListErrorWebProps> = ({
    title,
    retryLabel,
    onRetry,
    onBack,
    backHref,
}) => {
    const { versionList } = useMessages(recipeVersionMessages);
    const back = versionBackOf(versionList.backToRecipe, versionList.recipeParent, onBack, backHref);

    return (
        <section className="flex w-full max-w-list flex-col gap-4 pb-12">
            <RecipeVersionListHeader headingId={VERSION_TITLE_ID} back={back} />
            <div role="alert" className="flex flex-col items-start gap-3">
                <p className="text-body text-ink">{title}</p>
                {onRetry === undefined ? null : (
                    <Button variant="quiet" icon="refreshCw" onPress={onRetry}>
                        {retryLabel}
                    </Button>
                )}
            </div>
        </section>
    );
};
