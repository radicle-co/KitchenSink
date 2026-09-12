'use client';

/**
 * @module useIsHydrated — whether the web tree has hydrated, for surfaces that must not do browser-only work in the
 * server render or diverge from its markup during hydration.
 */
import { useSyncExternalStore } from 'react';

/**
 * A store that never emits, whose snapshot is `true` on the client and `false` on the server. Subscribing is a
 * no-op because the value it reports — "React has hydrated this tree" — transitions exactly once, and React
 * itself performs that transition by re-reading the client snapshot after hydration.
 *
 * @returns The unsubscribe callback. Pure.
 */
const subscribeToNothing = (): (() => void) => () => undefined;

/** The client snapshot: reached only once this tree is running in the browser. */
const onClient = (): boolean => true;

/** The server snapshot: also what React reads during the hydration pass, so the two passes agree. */
const onServer = (): boolean => false;

/**
 * Whether this tree has hydrated — i.e. whether a browser-only reading (the viewer's clock, a client-side fetch)
 * is meaningful yet.
 *
 * `useSyncExternalStore` with a server snapshot is chosen over `useState` + `useEffect` on purpose: React uses
 * `getServerSnapshot` for the server render AND the hydration render (so hydration matches byte-for-byte, with
 * no suppression), while a client-side navigation — which performs no hydration — reads the CLIENT snapshot on its
 * very first render, so the surface paints its real content immediately, with no placeholder frame at all.
 *
 * @returns `false` on the server and during hydration; `true` thereafter.
 */
export function useIsHydrated(): boolean {
    return useSyncExternalStore(subscribeToNothing, onClient, onServer);
}
