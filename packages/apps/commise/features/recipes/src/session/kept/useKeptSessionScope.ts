'use client';

import { useEffect } from 'react';

import type { KeptSessionStore } from './keptSessionStore.js';

/**
 * Keeps the kept store on Clerk's cook: `undefined` while loading, `null` signed out, a string the cook (KTD4, R7b). An
 * effect is right here: it syncs React with an external store, and it runs after commit, so an exit write queued in the
 * same commit lands first.
 *
 * @param kept - The app's kept store.
 * @param subject - Clerk's raw `userId`.
 * @sideEffect Calls `kept.scope(subject)` when `subject` changes. The store reports its own failures, so a rejection is
 * only kept from going unhandled.
 */
export function useKeptSessionScope(kept: KeptSessionStore, subject: string | null | undefined): void {
    useEffect(() => {
        void kept.scope(subject).catch(() => undefined);
    }, [kept, subject]);
}
