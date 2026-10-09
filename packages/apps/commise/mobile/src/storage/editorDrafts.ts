/**
 * @module mobile/storage — where the native editor keeps its device draft: AsyncStorage, on disk (ADR-0057), so it
 * survives a relaunch.
 *
 * ⛔ ONE adapter for the whole app. `draftStoreFor` memoizes a store per adapter and cook, so the editor and the
 * outbox observer share one serial queue over the key only while they share this one object.
 */
import { draftStoreFor, type DraftStore } from '@commise/features-recipes';

import { createNativeOutboxStore } from './outboxStore.js';

/** AsyncStorage, as the draft store's port. */
export const editorDraftStorage = createNativeOutboxStore();

/**
 * The signed-in cook's draft store, or `undefined` while nobody is signed in.
 *
 * @param subject - The IdP subject (Clerk `userId`).
 * @returns The memoized store. @sideEffect Records it for the next caller.
 */
export function editorDraftsFor(subject: string | undefined): DraftStore | undefined {
    return subject === undefined ? undefined : draftStoreFor(editorDraftStorage, subject);
}
