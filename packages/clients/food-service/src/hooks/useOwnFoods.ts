import { useInfiniteQuery } from '@tanstack/react-query';

import { foodQueries } from '../queries.js';
import { useFoodServiceClient } from './foodServiceProvider.js';
import { useFoodServiceSubject } from './useFoodServiceSubject.js';

/**
 * `GET /api/v1/foods/authored`: the cook's own foods, a page at a time, newest edit first, with the count of staff
 * decisions the cook has not yet opened (the dot on Profile's "Your foods").
 *
 * @returns The infinite query; every page carries `unseenDecisions`.
 */
export function useOwnFoods() {
    const client = useFoodServiceClient();
    const subject = useFoodServiceSubject();

    return useInfiniteQuery(foodQueries(client).ownFoods(subject));
}
