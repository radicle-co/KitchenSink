/**
 * @module @commise/query — the ONE connectivity reader for both apps.
 *
 * A React snapshot of TanStack's `onlineManager` singleton, which both platforms already feed: web from
 * `navigator.onLine` by TanStack's own default, mobile from NetInfo via `installOnlineManager`
 * (`mobile/src/query/connectivity.ts`). Nothing else in the tree may read connectivity directly — a second
 * reader is a second answer.
 *
 * ⛔ DO NOT BUILD A CONNECTIVITY EVENT BUS. `onlineManager.subscribe` already returns an unsubscribe, which
 * is the whole Observer contract; wrapping it in a bespoke emitter adds a second source of truth and a
 * second place for a leak.
 *
 * @pattern Adapter over TanStack's `onlineManager` singleton — an Observer subscription expressed as a React
 *     snapshot via `useSyncExternalStore`.
 */
import { onlineManager } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';

/**
 * Subscribe to connectivity.
 *
 * ⛔ THE THIRD ARGUMENT IS NOT OPTIONAL IN PRACTICE. `useSyncExternalStore` THROWS during a server render
 * when `getServerSnapshot` is absent, and this hook does render on the server: `ClientQueryBoundary` bypasses
 * `QueryBoundary` only while a route is un-prefetched, so a fully prefetched route renders the boundary — and
 * anything suspending beneath it renders this — during SSR. `onlineManager` initialises its backing field to
 * `true` and installs listeners only where `window` exists, so the server answer is always "online", which is
 * also the answer that renders nothing.
 *
 * @returns Whether the app currently believes it is offline. Reactive.
 */
export function useIsOffline(): boolean {
    return !useSyncExternalStore(
        (notify) => onlineManager.subscribe(notify),
        () => onlineManager.isOnline(),
        () => true,
    );
}
