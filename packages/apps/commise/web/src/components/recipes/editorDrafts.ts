'use client';

/**
 * @module @commise/web — where the web editor keeps its device draft: the tab's `sessionStorage` (owner decision D7,
 * ADR-0057). It survives a reload in the same tab and ends when the tab closes. This is the narrow exception to the
 * owner's ruling of 2026-09-17 that the browser keeps no durable app data; it covers the editor's draft and the
 * editor's pending writes in the outbox journal (`deviceSession.ts`), which hold the same ids and form values.
 *
 * ⛔ ONE store for the whole app (`webDeviceStore`): `draftStoreFor` memoizes a store per adapter and cook, so the editor,
 * the outbox observer and the session end share one serial queue over the key only while they share that one object.
 */
import { draftStoreFor, type DraftStore } from '@commise/features-recipes';

import { webDeviceStore } from '@/components/recipes/deviceSession';

/**
 * The signed-in cook's draft store, or `undefined` while nobody is signed in.
 *
 * @param subject - The IdP subject (Clerk `userId`).
 * @returns The memoized store. @sideEffect Records it for the next caller.
 */
export function editorDraftsFor(subject: string | undefined): DraftStore | undefined {
    return subject === undefined ? undefined : draftStoreFor(webDeviceStore, subject);
}
