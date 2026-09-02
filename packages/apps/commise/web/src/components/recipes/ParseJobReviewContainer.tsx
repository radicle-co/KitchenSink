'use client';

/**
 * Container for the parse-review route: binds the shared, presentational `ParseJobReview` to the live job.
 *
 * ⛔ It owns almost nothing, on purpose. `useParseJobReview` is the headless seam shared with mobile — it
 * holds the poll, both mutations, the clock and the error-to-sentence mapping — so this file's entire
 * contribution is the ONE thing that is genuinely per-platform: where "start over" goes.
 *
 * ⚠️ The correction slot is deliberately not supplied. `renderCorrection` is optional and its write route
 * does not exist yet (see `parse/props.ts`); passing a placeholder would put a control on screen that
 * cannot do what it says.
 */
import { ParseJobReview } from '@commise/features-recipes';
import { useParseJobReview } from '@commise/features-recipes/hooks';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import type { FC } from 'react';

/** Props for {@link ParseJobReviewContainer}. */
export interface ParseJobReviewContainerProps {
    /** The active route locale, used to build the locale-prefixed paste target. */
    readonly locale: string;
    /** The job this route addresses — the URL is the job's identity, so a refresh resumes the review. */
    readonly jobId: string;
}

export const ParseJobReviewContainer: FC<ParseJobReviewContainerProps> = ({ locale, jobId }) => {
    const router = useRouter();
    const review = useParseJobReview(jobId);

    return (
        <ParseJobReview
            state={review.state}
            retry={review.retry}
            edit={review.edit}
            // `push`, not `replace`: abandoning a job is a NEW act a cook may want to back out of, unlike the
            // create that got them here.
            onStartOver={() => router.push(`/${locale}/recipes/parse` as Route)}
        />
    );
};
