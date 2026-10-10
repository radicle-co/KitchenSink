'use client';

/**
 * @module @commise/features-recipes/session — what a device keeps for one cook, and its end with their session (ADR-0057,
 * ADR-0054, owner D7 and D18), for both apps: the cook's editor drafts and outbox journal, each with its quarantine, and
 * the tab's cook marks. Each app hands over its ONE key/value store (AsyncStorage on mobile, the tab's `sessionStorage`
 * on web); the drafts and the journal are reached through their stores' own writers (`draftStoreFor`,
 * `outboxMutatorFor`), so the clear is queued behind every change asked for before it and cannot be written back.
 *
 * The end runs on two triggers:
 *
 * - **Our own sign-out** (`signOutAndVerify`, ADR-0009): once the session is proven ended, before the app leaves.
 * - **Any other end the app observes** ({@link useDeviceSessionScope}): a sign-out in another tab, a Clerk expiry or
 *   revocation, the UserButton, or a switch to another cook. Clerk reports `undefined` while it loads and `null` only
 *   when it holds no user (`@clerk/shared`'s `deriveFromClientSideState`), so only a change from a cook to `null` or to
 *   another cook ends a session.
 *
 * @pattern Observer — {@link useDeviceSessionScope} reacts to a change of the signed-in cook by ending their session
 */
import { outboxMutatorFor, type OutboxStore } from '@kitchensink/sync';
import { useEffect } from 'react';

import { clearStoredCookMarks } from '../detail/cookMarksBackend.js';
import { draftStoreFor } from '../editor/draftStore.js';

/**
 * Remove what the device kept for a cook: every cook mark in the tab (D18, whoever made them; a no-op on native, which
 * keeps marks in memory), and the cook's drafts and outbox with both quarantines.
 *
 * @param store - The app's one key/value store, the same object its draft store and `SyncProvider` use.
 * @param subject - The cook who was signed in (Clerk `userId`), or `undefined` when nobody was.
 * @sideEffect Removes keys from the store and from `sessionStorage`.
 */
export async function endDeviceSession(store: OutboxStore, subject: string | undefined): Promise<void> {
    clearStoredCookMarks();

    if (subject === undefined) {
        return;
    }

    // Both are queued now, synchronously, behind every change already asked of either store.
    await Promise.all([draftStoreFor(store, subject).clear(), outboxMutatorFor(store, subject).clear()]);
}

/**
 * The cook each store last held, as the scope saw it: recorded against the store rather than in React, because the
 * decision needs no render, and an effect cleanup cannot make it (StrictMode runs every cleanup once at mount).
 */
const heldCooks = new WeakMap<OutboxStore, string>();

/**
 * End the previous cook's device session whenever the signed-in cook changes from a cook to nobody or to another cook.
 *
 * @param store - The app's one key/value store.
 * @param subject - Clerk's `userId`: a cook, `null` when signed out, `undefined` while loading (ignored).
 * @sideEffect Removes the previous cook's stored drafts, outbox and the tab's cook marks.
 */
export function useDeviceSessionScope(store: OutboxStore, subject: string | null | undefined): void {
    useEffect(() => {
        if (subject === undefined) {
            return;
        }

        const held = heldCooks.get(store);

        if (held !== undefined && held !== subject) {
            // A failed clear leaves the keys namespaced to that cook, unreachable by anyone else signed in.
            void endDeviceSession(store, held).catch(() => undefined);
        }

        if (subject === null) {
            heldCooks.delete(store);
        } else {
            heldCooks.set(store, subject);
        }
    }, [store, subject]);
}
