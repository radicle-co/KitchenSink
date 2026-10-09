'use client';

/**
 * @module @commise/web — where the web editor keeps its device draft: the tab's `sessionStorage` (owner decision D7,
 * ADR-0057). It survives a reload in the same tab and ends when the tab closes. This is the one narrow exception to
 * the owner's ruling of 2026-09-17 that the browser keeps no durable app data; it covers the editor draft and nothing
 * else (the web outbox stays in memory).
 *
 * ⛔ ONE adapter for the whole app. `draftStoreFor` memoizes a store per adapter and cook, so the editor and the
 * outbox observer share one serial queue over the key only while they share this one object.
 *
 * The storage is read lazily, at each call, so importing this module during a server render touches nothing.
 */
import { draftStoreFor, type DraftStore } from '@commise/features-recipes';
import { createWebStorageStore } from '@kitchensink/sync';

/** The tab's session storage, as the draft store's port. */
export const editorDraftStorage = createWebStorageStore(() => window.sessionStorage);

/**
 * The signed-in cook's draft store, or `undefined` while nobody is signed in.
 *
 * @param subject - The IdP subject (Clerk `userId`).
 * @returns The memoized store. @sideEffect Records it for the next caller.
 */
export function editorDraftsFor(subject: string | undefined): DraftStore | undefined {
    return subject === undefined ? undefined : draftStoreFor(editorDraftStorage, subject);
}
