'use client';

/**
 * @module ClientQueryBoundary — the web form of `QueryBoundary`, for a surface whose reads must not fetch during the
 * server render.
 *
 * A `'use client'` component still renders on the Next server, and a `useSuspenseQuery` read with no data fetches
 * DURING that render — with a browser token source that has no session there. So until the tree has hydrated this
 * renders only `loading`, the same markup the hydration pass then agrees with, and from then on it is exactly
 * `QueryBoundary`. A client-side navigation performs no hydration, so it reads on its first render.
 *
 * ⛔ EXCEPT WHERE THE SERVER ALREADY HOLDS THE DATA. A server-prefetched route passes the keys its page prefetched as
 * `prefetchedKeys`; when every one of them is already in the cache — which on the server IS the dehydrated prefetch —
 * the gate opens on the server too, the read finds its data and neither suspends nor fetches, and the prefetched HTML
 * ships. When any key missed (a failed prefetch dehydrates nothing, B19) both passes render `loading` and the browser
 * fetches after hydration. The gate never lets React's server-error recovery carry that degradation: Next reports
 * every client-rendered Suspense boundary as a recoverable error, so the ungated alternative would file one phantom
 * error per failed prefetch.
 *
 * The cache read is deliberately unsubscribed: it is consulted only before hydration, and the gate is open for good
 * once hydrated.
 *
 * @pattern Decorator over `QueryBoundary` — a hydration gate that is a Null Object on the server.
 * @pattern Specification — "every prefetched key holds data" decides whether the server pass may read.
 */
import { QueryBoundary, type QueryBoundaryProps } from '@commise/query/boundary';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { useIsHydrated } from '@/hooks/useIsHydrated';

/** Props for {@link ClientQueryBoundary}. */
export interface ClientQueryBoundaryProps extends QueryBoundaryProps {
    /** The keys this route's page prefetched on the server; the gate opens before hydration only if all hold data. */
    readonly prefetchedKeys?: readonly QueryKey[];
}

/** The suspense read boundary, closed until hydration unless the server already holds its data — orchestration. */
export function ClientQueryBoundary({
    loading,
    prefetchedKeys = [],
    ...boundary
}: ClientQueryBoundaryProps): ReactNode {
    const hydrated = useIsHydrated();
    const queryClient = useQueryClient();
    const prefetched =
        prefetchedKeys.length > 0 && prefetchedKeys.every((key) => queryClient.getQueryData(key) !== undefined);

    if (!hydrated && !prefetched) {
        return loading;
    }

    return <QueryBoundary loading={loading} {...boundary} />;
}
