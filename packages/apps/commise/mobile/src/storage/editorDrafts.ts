/**
 * @module mobile/storage — where the native editor keeps its device draft: AsyncStorage, on disk (ADR-0057), so it
 * survives a relaunch.
 *
 * ⛔ ONE store for the whole app (`nativeDeviceStore`): `draftStoreFor` memoizes a store per adapter and cook, so the
 * editor, the outbox observer and the session end share one serial queue over the key only while they share that object.
 */
import { draftStoreFor, type DraftStore } from '@commise/features-recipes';

import { nativeDeviceStore } from './deviceSession.js';

/**
 * The signed-in cook's draft store, or `undefined` while nobody is signed in.
 *
 * @param subject - The IdP subject (Clerk `userId`).
 * @returns The memoized store. @sideEffect Records it for the next caller.
 */
export function editorDraftsFor(subject: string | undefined): DraftStore | undefined {
    return subject === undefined ? undefined : draftStoreFor(nativeDeviceStore, subject);
}
