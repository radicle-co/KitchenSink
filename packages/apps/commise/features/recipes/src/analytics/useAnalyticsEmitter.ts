/**
 * Analytics plan U5 — the dumb transport half of client emission (origin R7's client half, R11).
 *
 * Fire-and-forget by contract: `emit` returns void synchronously, sends one single-event batch through
 * `RecipeServiceClient.emitAnalyticsEvents`, and SWALLOWS every failure — a 4xx (including the
 * designed 423 during an in-flight erasure, KTD9), a 5xx, a rate cap, a dead network. Analytics must
 * never surface an error, spinner, or delay into the picker (origin R7); at-most-once is the accepted
 * delivery semantic and the event id makes any retry the TRANSPORT layer performs collapse at the door.
 *
 * ## The leave-the-screen moment (KTD4b)
 *
 * The client sets `keepalive` on the request, so a WEB flush fired from unmount cleanup survives the
 * navigation that unmounted it (bounded by the 64 KiB aggregate quota the payload bounds are sized
 * under). ⚠️ React Native ignores `keepalive` — in-flight fetches survive navigation natively there,
 * and the loss window is app termination mid-flight, which sits inside origin R11's at-most-once
 * budget. No RN-specific code is needed; the asymmetry is recorded here so nobody adds any.
 */
import { useRecipeServiceClient } from '@kitchensink/recipe-service-client/hooks';
import type { QueryOutcomeEvent } from '@kitchensink/recipe-core/analytics/event-payload';
import { useCallback } from 'react';

/**
 * The emitter: a stable `emit(event)` that never throws, never blocks, never reports.
 *
 * @returns A callback the resolver fires at each session outcome.
 */
export function useAnalyticsEmitter(): (event: QueryOutcomeEvent) => void {
    const client = useRecipeServiceClient();

    return useCallback(
        (event: QueryOutcomeEvent): void => {
            void client.emitAnalyticsEvents({ events: [event] }).catch(() => {
                // Swallowed by design: an analytics failure is invisible (origin R7/SC4). The server
                // side owns observability (drop counters, dedup rate); the client stays silent.
            });
        },
        [client],
    );
}
