import { useQuery } from '@tanstack/react-query';

import { foodQueries } from '../queries.js';
import { useFoodServiceClient } from './foodServiceProvider.js';
import { useFoodServiceSubject } from './useFoodServiceSubject.js';

/**
 * `GET /api/v1/foods/search/progressive`: the signed-in cook's progressive answer for `query` (ADR-0055 points 5 and 9),
 * growing frame by frame while `fetchStatus` is `fetching`. With no one signed in it asks nothing. Its policy (no retry,
 * offline parking, an incomplete answer never kept) is `foodQueries`'s.
 *
 * @param query - The search text.
 * @param options - `enabled: false` holds the read.
 * @returns The query; `data` is the answer so far.
 */
export function useProgressiveFoodSearch(query: string, options: { readonly enabled?: boolean } = {}) {
    const client = useFoodServiceClient();
    const subject = useFoodServiceSubject();

    return useQuery({ ...foodQueries(client).progressiveSearch(subject, query), enabled: options.enabled ?? true });
}
