import { useQuery } from '@tanstack/react-query';

import { foodQueries } from '../queries.js';
import { useFoodServiceClient } from './foodServiceProvider.js';

/**
 * `GET /api/v1/foods/authored/{id}/publication-request`: the NEWEST request for the food whatever its status, with the
 * decline reason and the version it points at. A food never asked for answers `PublicationRequestNotFoundError`.
 *
 * @param id - The authored food's id; an empty id asks nothing.
 * @param options - `enabled: false` holds the read.
 * @returns The query.
 */
export function usePublicationRequest(id: string, options: { readonly enabled?: boolean } = {}) {
    const client = useFoodServiceClient();

    return useQuery({ ...foodQueries(client).publicationRequest(id), enabled: options.enabled ?? true });
}
