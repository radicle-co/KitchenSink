/**
 * @module @kitchensink/sync — failure classification: what kind, where shown, what the cook can do.
 *
 * ⛔ AN ERROR IS RENDERED NEXT TO THE THING THAT FAILED (owner requirement). A failing ingredient is an
 * ITEM-scoped error on that row, because a page banner cannot tell a cook WHICH of twelve lines to fix. A
 * failure of the whole write has no single row to blame and belongs to the entity's surface.
 *
 * ⛔ AND THE REMEDY IS NOT ALWAYS "RETRY". The shipped `useRecipePhotoUploadQueue` already rules this and is
 * the model being generalised: only a settled TRANSPORT failure is retryable; a validation rejection offers
 * a different action and nothing else. Offering Retry on a 422 invites the cook to press a button that can
 * never succeed.
 *
 * @pattern Specification — pure predicates over a failure, with no I/O and no clock, so every branch is
 *     testable without a network.
 */
import { NOT_PROCESSED_STATUSES } from '@kitchensink/retry-after';

import type { IntentKind, SyncEntity } from './record.js';

/** A failed send, as the drainer reports it. */
export interface SyncFailure {
    readonly entity: SyncEntity;
    readonly intentKind: IntentKind;
    readonly localId: string;
    /** The HTTP status, or `undefined` when the outcome never came back at all. */
    readonly status?: number;
}

/** What kind of failure this is, which decides whether anything may be replayed automatically. */
export type FailureClass = 'transient' | 'conflict' | 'terminal' | 'unknown';

/** Where the error is rendered: on the item itself, or on the entity's surface. */
export type FailureScope =
    | { readonly kind: 'item'; readonly entity: SyncEntity; readonly localId: string }
    | { readonly kind: 'entity'; readonly entity: SyncEntity; readonly localId: string };

/** What the cook is offered. */
export type Remedy = 'retry' | 'edit' | 'resolve' | 'confirm';

/** A gateway's answers that say nothing about whether the service processed the request. */
const GATEWAY_UNKNOWN: ReadonlySet<number> = new Set([502, 504]);

/**
 * Classify a failure.
 *
 * ⛔ AN ABSENT STATUS IS `unknown`, NOT `transient`. A timeout or a dropped socket may have been processed
 * server-side, so replaying it could write twice. Making it the cook's decision is what removes the need for
 * every endpoint to be idempotent — the alternative was a client-supplied id and an upsert on every route.
 *
 * @param failure - The failed send.
 * @returns Its class. Pure.
 */
export function classifyFailure(failure: SyncFailure): FailureClass {
    if (failure.status === undefined) {
        return 'unknown';
    }

    if (failure.status === 409) {
        return 'conflict';
    }

    if (NOT_PROCESSED_STATUSES.has(failure.status)) {
        return 'transient';
    }

    if (GATEWAY_UNKNOWN.has(failure.status)) {
        return 'unknown';
    }

    return 'terminal';
}

/**
 * Whether the drain sends a PARKED record again by itself, with no word from the cook.
 *
 * ⛔ ONLY WHEN THAT CANNOT WRITE TWICE: a transient refusal (the server did not process it), `401` (the sender refused
 * before sending, because its cook was signed out), or a DELETE of any outcome but a stated refusal (its second copy
 * meets the service's own 404). An unknown outcome of anything else, a conflict and a terminal refusal wait for the
 * cook — re-sending an unknown outcome on the next reconnect is the blind retry this module's rule forbids, one trigger
 * later.
 *
 * Exported because a Discard's confirm reads it too: a parked write this answers `true` for may be claimed and land at
 * any moment, so the confirm may not promise it will not (`discardPlanOf`).
 *
 * @param failure - The parked record, as the outbox reports it.
 * @returns Whether a drain re-sends it. Pure.
 */
export function resendsWhenParked(failure: SyncFailure): boolean {
    if (failure.status === 401) {
        return true;
    }

    // ⛔ A DELETE CANNOT WRITE TWICE, so an unknown outcome (no status, or a gateway's 502/504) may be sent again: if the first copy landed, the second meets
    // the service's own "no such recipe" 404, which the sender reads as done. This depends on there being no route that
    // undeletes a recipe (ADR-0057).
    if (failure.intentKind === 'delete' && classifyFailure(failure) === 'unknown') {
        return true;
    }

    return classifyFailure(failure) === 'transient';
}

/**
 * Where this error belongs on screen.
 *
 * A write that IS the entity (creating or updating a recipe) scopes to that entity's surface; a write that is
 * one PART of it (an ingredient, a photo) scopes to that part.
 *
 * @param failure - The failed send.
 * @returns The scope. Pure.
 */
export function scopeOf(failure: SyncFailure): FailureScope {
    const kind = failure.entity === 'recipe' || failure.entity === 'collection' ? 'entity' : 'item';

    return { kind, entity: failure.entity, localId: failure.localId };
}

/**
 * What the cook is offered for this failure.
 *
 * @param failure - The failed send.
 * @returns The remedy. Pure.
 */
export function remedyFor(failure: SyncFailure): Remedy {
    switch (classifyFailure(failure)) {
        case 'transient':
            return 'retry';
        case 'conflict':
            return 'resolve';
        case 'unknown':
            return 'confirm';
        case 'terminal':
            return 'edit';
    }
}
