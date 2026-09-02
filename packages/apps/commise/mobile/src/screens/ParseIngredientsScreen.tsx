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
import { useCreateParseJob } from '@kitchensink/recipe-service-client/hooks';
import type { JSX } from 'react';
import { useState } from 'react';

/** Props for {@link ParseIngredientsScreen}. */
export interface ParseIngredientsScreenProps {
    /** Invoked with the accepted job's id once the paste has been submitted. */
    readonly onCreated: (jobId: string) => void;
}

export function ParseIngredientsScreen({ onCreated }: ParseIngredientsScreenProps): JSX.Element {
    const messages = useMessages(recipeParseMessages);
    const [text, setText] = useState('');
    const createJob = useCreateParseJob();
    const submission = toParseSubmissionModel(text, messages);

    return (
        <ParsePasteForm
            value={text}
            onChange={setText}
            submission={submission}
            submitting={createJob.isPending}
            // ⚠️ The paste is NOT cleared on failure. A failed create leaves the cook's text where it was,
            // so "try again" costs one press rather than a retype — which on a phone matters more, not less.
            errorNotice={createJob.isError ? messages.pasteFailed : undefined}
            onSubmit={() => {
                // The leaf already refuses to fire while inadmissible or in flight; this is the second gate,
                // for the same reason the client parses outbound bodies.
                if (!submission.canSubmit || createJob.isPending) {
                    return;
                }

                createJob.mutate({ text }, { onSuccess: (job) => onCreated(job.id) });
            }}
        />
    );
}
