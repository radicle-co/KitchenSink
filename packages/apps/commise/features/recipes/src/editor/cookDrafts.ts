/**
 * @module @commise/features-recipes/editor — which device-draft store belongs to the signed-in cook. Each app hands over
 * its ONE key/value store (`webDeviceStore`, `nativeDeviceStore`, ADR-0057) and Clerk's `userId`; the answer is the
 * memoized store for that cook, so the editor, the outbox observer and the session end share one serial queue.
 */
import type { OutboxStore } from '@kitchensink/sync';

import { draftStoreFor, type DraftStore } from './draftStore.js';

/** The signed-in cook and their draft store. */
export interface CookDrafts {
    /** The IdP subject (Clerk `userId`). */
    readonly subject: string;
    /** The cook's memoized draft store on the device store. */
    readonly drafts: DraftStore;
}

/**
 * The signed-in cook's draft store, or `undefined` while nobody is signed in.
 *
 * ⛔ Never a placeholder subject: a store keyed by a constant is one shared draft for every signed-out visitor.
 *
 * @param store - The app's one key/value store, the same object its `SyncProvider` and session end use.
 * @param subject - The IdP subject (Clerk `userId`).
 * @returns The memoized store. @sideEffect Records it for the next caller.
 */
export function editorDraftsFor(store: OutboxStore, subject: string | undefined): DraftStore | undefined {
    return subject === undefined ? undefined : draftStoreFor(store, subject);
}

/**
 * The signed-in cook with their draft store, or `undefined` while Clerk is loading or nobody is signed in.
 *
 * @param store - The app's one key/value store.
 * @param userId - Clerk's `userId`: `undefined` while loading, `null` signed out.
 * @returns The cook and their store, or `undefined`. @sideEffect Records the store for the next caller.
 */
export function cookDraftsOf(store: OutboxStore, userId: string | null | undefined): CookDrafts | undefined {
    const drafts = editorDraftsFor(store, userId ?? undefined);

    return userId === null || userId === undefined || drafts === undefined ? undefined : { subject: userId, drafts };
}
