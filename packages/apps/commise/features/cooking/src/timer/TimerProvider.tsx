'use client';

/**
 * @module TimerProvider — makes the session's one timer store and ends it with the cook (S3a.U3, ADR-0094).
 *
 * Mounted once, high in the app (web `RecipeProviders`, mobile `RecipeServiceGate`), fed Clerk's raw `userId`, so a
 * timer outlives every screen and every route and ends only with the cook who started it: a change from a cook to
 * nobody or to another cook clears it, and Clerk's loading `undefined` changes nothing.
 *
 * It renders only its children. What it constructs is the point: the store, its connection to the clock and the app
 * focus, and the rule that ends it.
 *
 * @pattern Composition root (Facade) over the timer store, which a hook reads through context
 * @pattern Observer — the store is read with `useSyncExternalStore` in `useCookingTimers`
 */
import { useEffect, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';

import { TimerStoreContext } from './timerContext.js';
import { createTimerStore } from './timerStore.js';

/** What the provider is given. */
export interface TimerProviderProps {
    /** Clerk's `userId`: a cook, `null` when signed out, `undefined` while it loads. */
    readonly subject: string | null | undefined;
    readonly children: ReactNode;
}

/**
 * Provide the timer store to the subtree. Orchestration: it constructs the store and decides when it ends, and draws
 * only its children.
 *
 * @param props - The cook and the subtree.
 * @returns The subtree under the store.
 * @sideEffect Connects the store to the clock and the app focus while mounted, and tells it who is signed in.
 */
export function TimerProvider({ subject, children }: TimerProviderProps): ReactElement {
    const [store] = useState(createTimerStore);

    useEffect(() => store.connect(), [store]);
    useEffect(() => {
        store.observeCook(subject);
    }, [store, subject]);

    return <TimerStoreContext value={store}>{children}</TimerStoreContext>;
}
