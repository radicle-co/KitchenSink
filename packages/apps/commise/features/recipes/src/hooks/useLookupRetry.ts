/**
 * @module @commise/features-recipes/hooks — Try again for a row whose lookup FAILED (plan 002 V1; SPECIFY.1 row 10).
 *
 * It is `GET /api/v1/ingredients/{id}/status`, which re-asks food for an open failure and settles it — a read with no
 * recipe write. Answers are applied the way the status poller applies one (`usePollIngredientStatus`): by an effect
 * on the answers, through the caller's LATEST `onStatuses`, so an edit made while the lookup ran is not overwritten
 * by the draft captured when Try again was pressed — and every known answer goes in ONE call, as one transition.
 *
 * The read goes through the status query's own cache entry (`ingredientQueries(...).status`), so a poller the host
 * mounts afterwards for that id (the answer may be `PENDING`) reads this answer, never an older cached one.
 *
 * @pattern Command — one Try again per binding, in flight at most once
 */
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { ingredientQueries } from '@kitchensink/recipe-service-client';
import { useRecipeServiceClient } from '@kitchensink/recipe-service-client/hooks';

import type { LookupRetry, SettledAnswer } from '../form/ingredientStatus.js';

/**
 * Try again for FAILED rows.
 *
 * @param onStatuses - Applies the answers to the host's latest draft as ONE transition (`settleIngredientLines`).
 * @returns The retry command and the ids in flight.
 * @sideEffect Reads `GET /api/v1/ingredients/{id}/status` on demand (no write).
 */
export function useLookupRetry(onStatuses: (answers: readonly SettledAnswer[]) => void): LookupRetry {
    const queryClient = useQueryClient();
    const client = useRecipeServiceClient();
    const [asked, setAsked] = useState<readonly string[]>([]);
    const [retrying, setRetrying] = useState<ReadonlySet<string>>(new Set());
    const [settled, setSettled] = useState<LookupRetry['settled']>(undefined);

    // Observers only (`enabled: false`): they never fetch or poll on their own. Try again's `fetchQuery` fills the
    // same cache entries, and these surface the answer — the poller's own effect-on-data pattern.
    const results = useQueries({
        queries: asked.map((id) => ({ ...ingredientQueries(client).status(id), enabled: false })),
    });
    // The answers' CONTENT, as a dependency: a new answer re-runs the effect, an unchanged one does not.
    const signature = JSON.stringify(
        results.map((result) => [
            result.data?.id,
            result.data?.foodResolutionStatus,
            result.data?.foodId,
            result.dataUpdatedAt,
        ]),
    );

    useEffect(() => {
        // Read back from the typed cache entries (the keys carry their data type), never through a JSON round trip.
        const known: SettledAnswer[] = asked.flatMap((polledId) => {
            const data = queryClient.getQueryData(ingredientQueries(client).status(polledId).queryKey);

            if (data?.foodResolutionStatus === undefined) {
                return [];
            }

            // Its root, and its variant when it has one (curated U9).
            return [
                {
                    polledId,
                    observed: {
                        id: data.id,
                        status: data.foodResolutionStatus,
                        ...(data.foodId === undefined ? {} : { foodId: data.foodId }),
                        ...(data.variant === undefined ? {} : { variant: data.variant }),
                    },
                },
            ];
        });

        // ⛔ ALL answers in ONE call (staff-architect REVIEW F1): a host whose setter takes a value would otherwise
        // build each write from the same snapshot and lose all but the last.
        if (known.length > 0) {
            onStatuses(known);
        }
    }, [signature, asked, client, queryClient, onStatuses]);

    return {
        retrying,
        settled,
        retry: (ingredientId, lineKey) => {
            if (retrying.has(ingredientId)) {
                return;
            }

            setAsked((current) => (current.includes(ingredientId) ? current : [...current, ingredientId]));
            setRetrying((current) => new Set([...current, ingredientId]));
            // Only the announcement clears, as `RefreshNotice`'s does: the same answer twice is the same sentence, and
            // neither a status region nor a native live region speaks a text it already holds.
            setSettled(undefined);
            queryClient
                .fetchQuery({ ...ingredientQueries(client).status(ingredientId), staleTime: 0 })
                .then((ingredient) => {
                    if (ingredient.foodResolutionStatus !== undefined) {
                        // Keyed by the ROW: the answer may have moved the line to another binding (finding #6).
                        setSettled({ lineKey, status: ingredient.foodResolutionStatus });
                    }
                })
                // A failed ask changes nothing: the row stays FAILED, its explanation already says to try again in a
                // moment, and the glyph stops reading busy so the cook can.
                .catch(() => undefined)
                .finally(() => {
                    setRetrying((current) => new Set([...current].filter((id) => id !== ingredientId)));
                });
        },
    };
}
