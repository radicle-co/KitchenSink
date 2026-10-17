import { useQuery } from '@tanstack/react-query';

import { foodQueries } from '../queries.js';
import { useFoodServiceClient } from './foodServiceProvider.js';

/**
 * `GET /api/v1/foods/{id}`: one food, read directly from food-service (plan 002 S5).
 *
 * @param id - The food id; an empty id asks nothing.
 * @param options - `enabled: false` holds the read.
 * @returns The query.
 */
export function useFood(id: string, options: { readonly enabled?: boolean } = {}) {
    const client = useFoodServiceClient();

    return useQuery({ ...foodQueries(client).food(id), enabled: options.enabled ?? true });
}
