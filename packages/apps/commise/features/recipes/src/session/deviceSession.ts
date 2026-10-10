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
 *   another cook ends a session. The cook is recorded in the store ({@link HELD_COOK_KEY}), so a reload is no gap.
 *
 * @pattern Observer — {@link useDeviceSessionScope} reacts to a change of the signed-in cook by ending their session
 */
import { createSerialQueue, outboxMutatorFor, type OutboxStore, type SerialQueue } from '@kitchensink/sync';
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
 * Where the store records the cook its data was last kept for: an IdP subject and nothing else.
 *
 * ⛔ IN THE STORE, BESIDE THE DATA IT GUARDS, NOT IN MEMORY. On web the data lives in the tab's `sessionStorage` and
 * survives a reload, so the cook it belongs to must survive it too: a scope that remembered the cook in memory saw nobody
 * after a reload, and a first value of `null` (an expiry) or of another cook then cleared nothing (D7, D18 cover keeping
 * this id in the tab).
 */
const HELD_COOK_KEY = 'deviceSession.heldCook.v1';

/**
 * One queue per store for the scope's read-compare-clear-write: a fast cook → nobody → cook sequence must decide each
 * change against what the one before it recorded. Recorded against the store rather than in React, because the decision
 * needs no render, and an effect cleanup cannot make it (StrictMode runs every cleanup once at mount).
 */
const scopeQueues = new WeakMap<OutboxStore, SerialQueue>();

/** The scope's queue for `store`. @sideEffect Records it for the next caller. */
function scopeQueueFor(store: OutboxStore): SerialQueue {
    const existing = scopeQueues.get(store);

    if (existing !== undefined) {
        return existing;
    }

    const created = createSerialQueue();
    scopeQueues.set(store, created);

    return created;
}

/**
 * Record that `subject` is the signed-in cook now, ending the device session of the cook recorded before when it was
 * another one.
 *
 * @sideEffect Reads and writes {@link HELD_COOK_KEY}; may remove the previous cook's stored data.
 */
async function observeCook(store: OutboxStore, subject: string | null): Promise<void> {
    // An unreadable record is treated as none: there is nothing to compare, and the namespacing still keeps another
    // cook's keys unreachable.
    const held = await store.getItem(HELD_COOK_KEY).catch(() => null);

    if (held !== null && held !== subject) {
        // A failed clear leaves the keys namespaced to that cook, unreachable by anyone else signed in.
        await endDeviceSession(store, held).catch(() => undefined);
    }

    if (held === subject) {
        return;
    }

    await (subject === null ? store.removeItem(HELD_COOK_KEY) : store.setItem(HELD_COOK_KEY, subject));
}

/**
 * End the previous cook's device session whenever the signed-in cook changes from a cook to nobody or to another cook —
 * in this document or across a reload of it.
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

        // ⛔ Queued now, synchronously: an editor's exit checkpoint in the same commit (its cleanup runs first) has
        // already queued its writes on the stores' own writers, so a clear this decides is queued behind them.
        void scopeQueueFor(store)(() => observeCook(store, subject)).catch(() => undefined);
    }, [store, subject]);
}
