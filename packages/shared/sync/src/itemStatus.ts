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

/** Statuses the server returns having NOT processed the request, so a replay cannot duplicate anything. */
const TRANSIENT: ReadonlySet<number> = new Set([429, 502, 503, 504]);

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

    if (TRANSIENT.has(failure.status)) {
        return 'transient';
    }

    return 'terminal';
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
