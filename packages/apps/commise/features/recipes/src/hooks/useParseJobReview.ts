/**
 * Headless-hook seam (CP-6/P2) — the shared ORCHESTRATION for the parse-review surface, so the web and
 * native leaves render the same state machine rather than two that happen to agree (plan U9).
 *
 * DESIGN PATTERN: **headless hook over a pure model.** Every judgement lives in `../parse/model.ts`; this
 * hook contributes only the three things a leaf must NOT own — the query and its two mutations, the CLOCK,
 * and the mapping from a typed client error to a localized sentence.
 *
 * ## ⛔ THE CLOCK IS A TIMER, NOT A RENDER-TIME `Date.now()` — and the first version was BROKEN
 *
 * The stall bound is the time-dependent state this clock exists for. The obvious implementation reads `Date.now()`
 * during render and leans on the poll to re-render every few seconds. **That does not work, and it fails
 * in exactly the case `stalled` exists for.** TanStack applies structural sharing to a refetch, so a poll
 * that answers a job whose lines have not moved preserves the `data` REFERENCE and notifies no observer —
 * no re-render, no new `Date.now()`, and a genuinely stuck job therefore never crosses the bound. The
 * state was unreachable in production, and only a fake-timer test forced it to show.
 *
 * So the clock is explicit: one `setTimeout` per run, which fires once at the bound and moves `stallClock`.
 * That also settles the purity objection to reading the clock during render — this hook now has ONE clock
 * source, and it is an effect.
 *
 * ⛔ `now` is still a PARAMETER of the projection (`toParseJobViewState`), never read inside it: the model
 * stays pure and every boundary stays table-testable.
 *
 * ⚠️ `stallClock` is deliberately STALE between updates. It is the `now` of two decisions: the stall bound
 * (`now - runningSince > PARSE_JOB_STALL_BOUND_MS`) and the review deadline (`parseJobIsLive(job, now)`). The timer
 * fires exactly at the bound crossing, so a stale value cannot change the first answer. It CAN delay the second: once a
 * run's single timer has fired the clock stops, so a deadline that passes later is not derived from it until the clock
 * moves again. The service still refuses a retry or an edit on the expired job, and that refusal carries the expiry
 * notice — so the cook is told, one action later than the clock alone would tell them.
 *
 * ## ⛔ WHY `runningSince` IS RESET BY A MUTATION AND NOT BY THE POLL
 *
 * A retry or a line edit re-opens asynchronous work: the affected lines go back to `pending` and the job
 * back to `running`. Measuring the new wait from the ORIGINAL mount would report a job as stalled the
 * instant a cook retried an old one — the one moment they are least entitled to be told nothing is
 * happening. It is reset on the mutation's success (an event), not derived from progress, because
 * "progress moved" needs previous-render state and buys nothing the reset does not already give.
 *
 * Platform-agnostic: no DOM and no React Native imports.
 */
import { useCallback, useEffect, useState } from 'react';
import { useMessages } from '@commise/i18n/react';
// The typed-error guard lives on the package's MAIN barrel (a guard needs no React); the hooks live on the
// React-only `./hooks` subpath. Two specifiers, deliberately — see that package's `index.ts`.
import { isParseJobExpiredError } from '@kitchensink/recipe-service-client';
import { useEditParseJobLine, useParseJob, useRetryParseJob } from '@kitchensink/recipe-service-client/hooks';

import { recipeParseMessages } from '../parse/messages.js';
import { PARSE_JOB_STALL_BOUND_MS, toParseJobViewState } from '../parse/model.js';
import type { ParseJobViewState } from '../parse/model.js';
import type { ParseLineEditControl, ParseRetryControl } from '../parse/props.js';

/** What a leaf gets to drive the whole review surface. */
export interface ParseJobReviewController {
    /** The single state the leaf switches over. */
    readonly state: ParseJobViewState;
    /** The retry command, with its busy flag and its localized failure sentence. */
    readonly retry: ParseRetryControl;
    /** The line-edit command, with the busy line index and its localized failure sentence. */
    readonly edit: ParseLineEditControl;
}

/**
 * Drive the review surface for one parse job.
 *
 * ⛔ `mutate`, never `mutateAsync` — the same reason `useIngredientCorrection` records: `mutateAsync` makes
 * an unhandled rejection possible in a leaf that forgot `.catch`, which on React Native is a redbox over a
 * working screen. Both refusals here are already rendered as state.
 *
 * @param jobId - The job to poll. An empty id disables the query (nothing has been created yet).
 * @returns The state and the two commands.
 * @sideEffect Polls `GET /api/v1/recipe-parse-jobs/{id}` and issues its two mutations.
 */
export function useParseJobReview(jobId: string): ParseJobReviewController {
    const messages = useMessages(recipeParseMessages);
    const query = useParseJob(jobId);
    const retryMutation = useRetryParseJob();
    const editMutation = useEditParseJobLine();
    // Captured once per mounted job; reset below when a mutation re-opens the work. See the module doc.
    const [runningSince, setRunningSince] = useState(() => Date.now());
    // The hook's ONE clock — see the module doc for why a render-time `Date.now()` left `stalled`
    // unreachable. It moves on mount and once at each run's bound.
    const [stallClock, setStallClock] = useState(runningSince);
    const { mutate: runRetry } = retryMutation;
    const { mutate: runEdit } = editMutation;

    // Only the bound's timer is an effect: a subscription to time, keyed on the start it measures. A re-open does
    // NOT need to move `stallClock` as well: the stall decision is `stallClock - runningSince > bound`, so a stale
    // clock read against a fresh start is negative and reads as running until this timer fires again. (The same clock
    // is the review deadline's `now` — see the module doc.)
    useEffect(() => {
        const timer = setTimeout(() => setStallClock(Date.now()), PARSE_JOB_STALL_BOUND_MS + 1);

        return () => clearTimeout(timer);
    }, [runningSince]);

    const retry = useCallback((): void => {
        runRetry(jobId, { onSuccess: () => setRunningSince(Date.now()) });
    }, [runRetry, jobId]);

    const editLine = useCallback(
        (lineIndex: number, sourceLine: string): void => {
            runEdit({ id: jobId, lineIndex, input: { sourceLine } }, { onSuccess: () => setRunningSince(Date.now()) });
        },
        [runEdit, jobId],
    );

    // ⛔ An EXPIRED refusal and a transient failure are two sentences, because the remedies differ: one is
    // "paste it again", the other is "try again in a moment". Collapsing them would send a cook to retry a
    // job the server will never accept.
    const noticeFor = (error: unknown, expired: string, failed: string): string | undefined => {
        if (error === null || error === undefined) {
            return undefined;
        }

        return isParseJobExpiredError(error) ? expired : failed;
    };

    return {
        state: toParseJobViewState({
            job: query.data,
            error: query.error,
            now: stallClock,
            runningSince,
        }),
        retry: {
            run: retry,
            busy: retryMutation.isPending,
            notice: noticeFor(retryMutation.error, messages.retryExpired, messages.retryFailed),
        },
        edit: {
            submit: editLine,
            busyLineIndex: editMutation.isPending ? editMutation.variables?.lineIndex : undefined,
            notice: noticeFor(editMutation.error, messages.lineEditExpired, messages.lineEditFailed),
        },
    };
}
