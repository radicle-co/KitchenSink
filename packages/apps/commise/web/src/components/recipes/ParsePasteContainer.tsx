'use client';

/**
 * Container for the paste route: binds the shared, presentational `ParsePasteForm` to the create mutation.
 *
 * It owns exactly two things — the pasted text (client state, never a server value) and where a created job
 * lands. Everything else is delegated: the admission verdict to `toParseSubmissionModel`, the request to
 * `useCreateParseJob`, the copy to `recipeParseMessages`.
 *
 * ⛔ NAVIGATION IS A `replace`, NOT A `push`. The paste route and the review route are two views of ONE act,
 * so a Back press from the review should return to the recipe list rather than to a form still holding text
 * for a job that already exists — pressing submit again there would create a SECOND job from the same paste.
 */
import { ParsePasteForm, recipeParseMessages, toParseSubmissionModel } from '@commise/features-recipes';
import { useMessages } from '@commise/i18n/react';
import { useCreateParseJob } from '@kitchensink/recipe-service-client/hooks';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { FC } from 'react';

/** Props for {@link ParsePasteContainer}. */
export interface ParsePasteContainerProps {
    /** The active route locale, used to build the locale-prefixed review target. */
    readonly locale: string;
}

export const ParsePasteContainer: FC<ParsePasteContainerProps> = ({ locale }) => {
    const router = useRouter();
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
            // ⚠️ The paste is NOT cleared here. A failed create leaves the cook's text exactly where it was,
            // so "try again" costs one press rather than a retype — which for a 200-line block matters.
            errorNotice={createJob.isError ? messages.pasteFailed : undefined}
            onSubmit={() => {
                // The leaf already refuses to fire while inadmissible or in flight; this is the second gate,
                // for the same reason the client parses outbound bodies — the caller's own bug should not
                // reach the wire.
                if (!submission.canSubmit || createJob.isPending) {
                    return;
                }

                createJob.mutate(
                    { text },
                    {
                        onSuccess: (job) => {
                            router.replace(`/${locale}/recipes/parse/${job.id}` as Route);
                        },
                    },
                );
            }}
        />
    );
};
