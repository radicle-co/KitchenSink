import { useQuery } from '@tanstack/react-query';

import { foodQueries } from '../queries.js';
import { useFoodServiceClient } from './foodServiceProvider.js';

/**
 * `GET /api/v1/foods/sources`: the sources a stored nutrition value cites, for the Data sources page (curated U25).
 *
 * @returns The query.
 */
export function useDataSources() {
    const client = useFoodServiceClient();

    return useQuery(foodQueries(client).dataSources());
}
