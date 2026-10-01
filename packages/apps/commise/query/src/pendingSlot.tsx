/**
 * @module @commise/query — the owner of `fetchStatus: 'paused'`.
 *
 * ⛔ THE DEFECT: a read with NO CACHED DATA, while offline, never reaches an error state. TanStack parks it
 * at `paused` with `isPending: true` (`retryer.js:100` — `canContinue() ? void 0 : pause()`), so the surface
 * renders its loading state indefinitely. Worst under `useSuspenseQuery`, where the component has no
 * render-time branch of its own and simply suspends forever.
 *
 * ⛔ IT IS PENDING, NOT FAILED — `docs/CODING_STANDARDS.md` §11.0, an owner directive: "Suspense owns pending,
 * the boundary owns failed." So this decorates the Suspense FALLBACK rather than adding a fourth outcome to
 * `QueryBoundary`'s three-way render.
 *
 * ⚠️ AND THE READ RECOVERS BY ITSELF, which is why nothing here offers a Retry. A paused query resumes on
 * reconnect through `retryer.continue()` irrespective of observers, whereas an ERRORED suspense read has no
 * mounted observer left and keeps `retryOnMount` off until the reset boundary resets. Treating offline as a
 * failure would have cost exactly that automatic recovery at every suspense site in both apps.
 *
 * @pattern Decorator over the pending node — it wraps what the boundary was already going to render, and
 *     knows nothing about which query is pending.
 */
import { QueryClientContext } from '@tanstack/react-query';
import { useContext, useSyncExternalStore, type FC, type ReactNode } from 'react';

import { useIsOffline } from './useIsOffline.js';
import { useRenderOffline } from './offlineReadNotice.js';

/** Props for {@link PendingSlot}. */
export interface PendingSlotProps {
    /** The pending node the boundary supplied — rendered unchanged unless a read is parked offline. */
    readonly children: ReactNode;
}

/**
 * Render the pending node, upgraded to the app's offline copy when a read is parked AND we are offline.
 *
 * ⛔ THE CONJUNCTION IS LOAD-BEARING — `paused` alone does NOT mean offline. `canContinue` also requires
 * `focusManager.isFocused()`, and mobile drives that from `AppState`, so a BACKGROUNDED app parks its queries
 * while perfectly online and self-heals the moment it returns to the foreground. Showing that viewer an
 * offline notice would be a lie they cannot act on.
 *
 * ⚠️ The paused count is cache-wide rather than scoped to the suspended read, because a Suspense fallback
 * holds no query handle. That is sound for the decision being made: the question is "is this surface waiting
 * on a network this device does not have", and both halves of the conjunction are already app-wide facts.
 */
export const PendingSlot: FC<PendingSlotProps> = ({ children }) => {
    // ⛔ THE CONTEXT DIRECTLY, NOT `useQueryClient()` — which THROWS when no provider is mounted. This slot
    // decorates the boundary's FALLBACK, and `QueryBoundary` never required a query client to render one
    // before; making it throw would turn a tree that legitimately has no client (a leaf test, a storybook
    // render) from "works" into "crashes in its loading state". Absent client ⇒ nothing can be parked ⇒
    // render the children, which is the same Null Object posture as the missing copy provider.
    const client = useContext(QueryClientContext);
    // ⛔ NOT `useIsFetching({ fetchStatus: 'paused' })` — THAT CANNOT WORK, and it fails silently. Its
    // implementation spreads the caller's filters and THEN overwrites the field:
    // `findAll({ ...filters, fetchStatus: 'fetching' })` (`query-core/queryClient.js:49-53`). So a `paused`
    // filter is discarded and the hook counts FETCHING queries — always zero in exactly the state this slot
    // exists for. Subscribing to the cache is the only reading that sees a parked query.
    //
    // ⚠️ The snapshot returns a BOOLEAN, not the array or its length, because `useSyncExternalStore` compares
    // snapshots by identity and `findAll` builds a fresh array on every call — returning it would re-render
    // without end.
    const parked = useSyncExternalStore(
        (notify) => (client === undefined ? () => undefined : client.getQueryCache().subscribe(notify)),
        () => client !== undefined && client.getQueryCache().findAll({ fetchStatus: 'paused' }).length > 0,
        () => false,
    );
    const offline = useIsOffline();
    const renderOffline = useRenderOffline();

    return <>{parked && offline ? renderOffline(children) : children}</>;
};
