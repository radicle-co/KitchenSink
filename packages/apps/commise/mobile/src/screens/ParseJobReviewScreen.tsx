/**
 * Parse-review screen (mobile). The container that drives the shared, presentational native
 * `ParseJobReview` from the `useParseJobReview` headless seam — the SAME hook the web container uses, so
 * the poll cadence, the stall bound, the expiry rule and every error sentence are one implementation
 * rather than two that happen to agree.
 *
 * ⚠️ ACCEPTED ASYMMETRY, recorded rather than left to be discovered. Web addresses a job by URL, so a
 * refresh (or returning tomorrow) resumes the review and the server's 24-hour TTL is reachable. This stack
 * is in-memory: the id lives as long as the app process, and a cold start loses it. That is a real
 * difference in reach, not a difference in behaviour — the review itself renders identically, and the
 * server's `expired` state is still reachable here for any job the process has held. Closing it properly
 * means persisting the id (the same decision `useRecentSearches` made for its own state), which is a
 * product call rather than an omission to patch over.
 *
 * ⛔ The correction slot is deliberately not supplied — see `parse/props.ts`. Its write route exists but
 * its contract is not yet reachable from this tree, and a placeholder would put a control on screen that
 * cannot do what it says.
 */
import { ParseJobReview } from '@commise/features-recipes';
import { useParseJobReview } from '@commise/features-recipes/hooks';
import type { JSX } from 'react';

/** Props for {@link ParseJobReviewScreen}. */
export interface ParseJobReviewScreenProps {
    /** The job to review. */
    readonly jobId: string;
    /** Invoked when the cook abandons this job to paste a fresh list. */
    readonly onStartOver: () => void;
}

export function ParseJobReviewScreen({ jobId, onStartOver }: ParseJobReviewScreenProps): JSX.Element {
    const review = useParseJobReview(jobId);

    return <ParseJobReview state={review.state} retry={review.retry} edit={review.edit} onStartOver={onStartOver} />;
}
