/**
 * @module @commise/features-recipes/hooks — the food search every picking surface asks, behind one module: food-service's
 * ONE progressive answer (ADR-0055 points 5 and 9), read from food directly (`docs/design/rowEditorBlueprint.md`
 * decision 1). It reduces the TanStack read to a {@link ProgressiveRead} (`foodSuggestions.model.ts`), so the entry
 * fields, rows 6 and 7 and the ambiguity review read that shape and never a client hook's (owner ruling 2026-10-02).
 *
 * Two deadlines, each running from the request (`docs/design/rowEditorOpenDecisions.md`, S7 list contract P2 and P3):
 * - the database part's, {@link FOOD_SEARCH_DEADLINE_MS}: with no database frame by then the whole answer stops;
 * - the whole answer's, {@link PROGRESSIVE_SEARCH_DEADLINE_MS}: the loader always ends, keeping what arrived.
 * When either fires, the request still running is cancelled, so nothing it started can land later. Food keeps an
 * admitted source call running so the cache fills (ADR-0055 point 6).
 *
 * ⚠️ No deadline runs while the read is parked offline: a parked read resumes by itself on reconnect, and a deadline
 * that had already fired would read the resumed answer as failed. A read that resumes starts fresh deadlines
 * (`useReadDeadline` starts afresh for a key it comes back to), and its answer is a resumed one, which P1 and P2 place
 * differently.
 *
 * A source frame that reports the cook's own limit is handed to the session's holder as it arrives (system change 9),
 * because the limit must outlive this answer: the next keystroke starts another.
 *
 * @pattern Adapter — over `useProgressiveFoodSearch`
 * @pattern Timeout — the database part's and the whole answer's deadlines, through `useReadDeadline`
 */
import {
    foodServiceKeys,
    useFoodServiceSubject,
    useProgressiveFoodSearch,
} from '@kitchensink/food-service-client/hooks';
import type { ProgressiveAnswer } from '@kitchensink/food-service-client';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import { progressiveReadOf, type ProgressiveRead } from './foodSuggestions.model.js';
import { useAppFocused } from './useAppFocused.js';
import { useReadDeadline } from './useReadDeadline.js';
import { limitEndOf } from './sourceLimit.model.js';

/**
 * How long the database frame may take, from the request, on both platforms (S7 list contract P3, which keeps S5's
 * L1 figure). Unmeasured: the S5 blueprint set it, and a phone on cellular is what decides whether it holds.
 */
export const FOOD_SEARCH_DEADLINE_MS = 3_000;

/**
 * How long the whole answer may take, from the request (P3: past 10 s a person turns to another task). Food closes each
 * source's frame within 8 s, inside it (plan 002 S7).
 */
export const PROGRESSIVE_SEARCH_DEADLINE_MS = 10_000;

/** The search, and a way to ask it again. */
export interface FoodSuggestionSource {
    /** Where the read stands. The same object across renders that change nothing. */
    readonly read: ProgressiveRead;
    /** Ask again, under fresh deadlines: a list the cook was told is incomplete or failed. */
    readonly refetch: () => void;
}

/**
 * The latest end of a wait the cook's own limit put on one of the answer's sources, or `undefined`. Pure.
 *
 * @param answer - The answer so far.
 * @returns The time, in epoch milliseconds.
 */
const limitedUntilOf = (answer: ProgressiveAnswer | undefined): number | undefined => {
    const ends = (answer?.sources ?? []).flatMap((frame) => (frame.outcome === 'limited' ? [frame.retryAt] : []));

    return ends.length === 0 ? undefined : Math.max(...ends);
};

/**
 * The progressive food search for `query`.
 *
 * @param query - The settled, trimmed text.
 * @param enabled - Whether to read at all (a surface gates on the search minimum, and the entry on its active field).
 * @param onLimited - The session's limit holder (`SourceLimit.hold`): given the minute a source frame says the cook's
 *   limit ends, when that frame arrives.
 * @returns The read and Try again.
 * @sideEffect Reads the progressive search while enabled, cancels it when a deadline fires, and hands a reported limit
 *   to `onLimited`.
 */
export function useIngredientSuggestionSource(
    query: string,
    enabled: boolean,
    onLimited?: (until: number) => void,
): FoodSuggestionSource {
    const queryClient = useQueryClient();
    const subject = useFoodServiceSubject();
    const search = useProgressiveFoodSearch(query, { enabled });
    const appIsFocused = useAppFocused();
    // Try again's count: part of the deadlines' key, so asking again starts fresh deadlines and a fresh answer.
    const [attempt, setAttempt] = useState(0);
    const key = `${String(attempt)}:${query}`;
    const parked = search.fetchStatus === 'paused';
    const running = enabled && !parked;

    // The answer this read resumed, if it was parked offline first. Adjusted during render, React's previous-value form.
    const [parkedKey, setParkedKey] = useState<string | undefined>(undefined);

    if (parked && appIsFocused && parkedKey !== key) {
        setParkedKey(key);
    }

    const cancel = (): void => {
        const queryKey = foodServiceKeys.progressiveSearch(subject, query);

        // ⛔ Never a parked read: it is waiting for a connection, and cancelling it would lose the resume.
        if (queryClient.getQueryState(queryKey)?.fetchStatus === 'fetching') {
            void queryClient.cancelQueries({ queryKey, exact: true });
        }
    };

    const databaseExpired = useReadDeadline(
        running && search.data?.database === undefined ? key : undefined,
        FOOD_SEARCH_DEADLINE_MS,
        cancel,
    );
    const overallExpired = useReadDeadline(running ? key : undefined, PROGRESSIVE_SEARCH_DEADLINE_MS, cancel);
    const resumed = parkedKey === key;

    const limitedUntil = limitedUntilOf(search.data);

    // An effect, not a derivation: the frame's arrival is an event from the network, and the limit it reports must
    // outlive this answer, so it goes to the session's holder (`useSourceLimit`), which keeps the later of two ends.
    useEffect(() => {
        if (limitedUntil !== undefined) {
            onLimited?.(limitEndOf(limitedUntil));
        }
    }, [limitedUntil, onLimited]);

    // Built from the fields TanStack keeps stable, so a surface's effects see a new read only when something moved.
    const read = useMemo<ProgressiveRead>(
        () =>
            progressiveReadOf({
                data: search.data,
                status: search.status,
                fetchStatus: search.fetchStatus,
                databaseExpired,
                overallExpired,
                appIsFocused,
                resumed,
            }),
        [search.data, search.status, search.fetchStatus, databaseExpired, overallExpired, appIsFocused, resumed],
    );

    return {
        read,
        refetch: () => {
            // With no cook there is nothing to ask (`skipToken`), and asking anyway is an error.
            if (subject === undefined) {
                return;
            }

            setAttempt((count) => count + 1);
            void search.refetch();
        },
    };
}
