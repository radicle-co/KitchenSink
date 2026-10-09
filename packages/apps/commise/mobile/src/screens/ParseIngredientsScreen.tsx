/**
 * Ingredient-paste screen (mobile). The container that drives the shared, presentational native
 * `ParsePasteForm` from the typed `useCreateParseJob` mutation: it owns the pasted text, runs the shared
 * admission projection, and reports the created job's id upward so the composing screen can push the
 * review surface.
 *
 * It performs no rendering of its own — the view lives in `@commise/features-recipes`, shared with web —
 * and it decides nothing the web container decides differently. The one genuine per-platform difference is
 * how a created job is reached: web REPLACES its route, this pushes a stack entry.
 */
import { ParsePasteForm, recipeParseMessages, toParseSubmissionModel } from '@commise/features-recipes';
import { useMessages } from '@commise/i18n/react';
import { useBackIntercept } from '@commise/ui/back-intercept';
import { ConfirmDialog } from '@commise/ui/confirm-dialog';
import { useCreateParseJob } from '@kitchensink/recipe-service-client/hooks';
import type { JSX } from 'react';
import { useState } from 'react';

import { mobileMessages } from '../i18n/messages.js';

/** Props for {@link ParseIngredientsScreen}. */
export interface ParseIngredientsScreenProps {
    /** Invoked with the accepted job's id once the paste has been submitted. */
    readonly onCreated: (jobId: string) => void;
    /**
     * Invoked when the cook leaves without submitting.
     *
     * ⛔ REQUIRED. This is a pushed surface over a stack with no chrome — no tab bar, no shell — so without
     * it there was no exit at all on iOS, which has no hardware back either. Every sibling pushed screen
     * (`RecipeCreateScreen.onCancel`, `RecipeVersionsScreen.onBack`, …) already takes this seam.
     *
     * ⚠️ It is the ANSWER to a leave, never the leave itself: a paste in progress is confirmed first.
     */
    readonly onBack: () => void;
}

export function ParseIngredientsScreen({ onCreated, onBack }: ParseIngredientsScreenProps): JSX.Element {
    const messages = useMessages(recipeParseMessages);
    const { common } = useMessages(mobileMessages);
    const [text, setText] = useState('');
    const [confirmingExit, setConfirmingExit] = useState(false);
    // ⛔ THE CALLBACK LIVES ON THE MUTATION, not on a per-call `mutate(vars, { onSuccess })` — TanStack
    // skips those when the observer unmounts before the mutation settles, which here loses the created
    // job's ID permanently (the service publishes no list endpoint, so nothing can address it again).
    const createJob = useCreateParseJob({ onSuccess: (job) => onCreated(job.id) });
    const submission = toParseSubmissionModel(text, messages);

    /**
     * Leave, or ask first. Whitespace is nothing to lose — the splitter discards it, so a stray newline
     * must not raise a dialog over an empty paste.
     *
     * @sideEffect Either navigates away or opens the confirmation.
     */
    const requestBack = (): void => {
        if (text.trim().length === 0) {
            onBack();

            return;
        }

        setConfirmingExit(true);
    };

    // ⛔ THE SYSTEM BACK BUTTON IS THE SECOND ENTRY POINT TO THIS GUARD. The host pops a pushed surface for
    // a press nothing claims, and the pasted list lives only in the state above — so an unguarded press
    // destroys it silently, exactly as it did for the recipe wizard before `@commise/ui/back-intercept`.
    //
    // ⛔ `true` IN BOTH BRANCHES: the clean branch navigates ITSELF, and answering `false` after navigating
    // lets the host's own default run as well and pops two surfaces for one press.
    useBackIntercept(() => {
        requestBack();

        return true;
    });

    return (
        <>
            <ParsePasteForm
                value={text}
                onChange={setText}
                submission={submission}
                submitting={createJob.isPending}
                onBack={requestBack}
                // ⚠️ The paste is NOT cleared on failure. A failed create leaves the cook's text where it was,
                // so "try again" costs one press rather than a retype — which on a phone matters more, not less.
                errorNotice={createJob.isError ? messages.pasteFailed : undefined}
                onSubmit={() => {
                    // The leaf already refuses to fire while inadmissible or in flight; this is the second gate,
                    // for the same reason the client parses outbound bodies.
                    if (!submission.canSubmit || createJob.isPending) {
                        return;
                    }

                    createJob.mutate({ text });
                }}
            />
            <ConfirmDialog
                open={confirmingExit}
                title={common.discard.title}
                body={common.discard.body}
                confirm={{ label: common.discard.confirm, icon: 'trash' }}
                keep={{ label: common.discard.cancel }}
                onConfirm={() => {
                    setConfirmingExit(false);
                    onBack();
                }}
                onKeep={() => setConfirmingExit(false)}
            />
        </>
    );
}
