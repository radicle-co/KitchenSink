/**
 * A cached answer is keyed by the adapter's revision (ADR-0055 point 2), and the cache keeps a found answer for 7
 * days. If the shared USDA search statement changed under the same revision, cached answers would come from the old
 * statement while food-service's add-by-name asked USDA with the new one, and the two paths would see different
 * candidates. So each USDA revision is pinned to the request it was cut with, as it crosses the wire: the method, the
 * path, the query and the body, the key aside. A change to any of them fails here until
 * `REMOTE_SEARCH_ADAPTER_REVISIONS.usda` moves and a pin for the new revision is recorded beside the old ones.
 *
 * A change to the hit mapping fails the adapter's mapping table, which carries the same obligation.
 */
import { describe, expect, it } from 'vitest';

import { REMOTE_SEARCH_ADAPTER_REVISIONS } from '../../../search/remoteSearch.schema.js';
import { createUsdaSearchAdapter } from '../usdaSearchAdapter.js';

/** What one search sends USDA, with the key taken out of the query. */
interface WireSearch {
    readonly method: string;
    readonly path: string;
    readonly query: Readonly<Record<string, string>>;
    readonly body: unknown;
}

/** The base URL the pin is recorded against; only the path after it is pinned. */
const BASE_URL = 'https://usda.test/fdc/v1';

/** The term every pin is recorded with. */
const TERM = 'egg';

/** The request each USDA adapter revision was cut with, for {@link TERM}. */
const REQUEST_OF_REVISION: Readonly<Record<number, WireSearch>> = {
    1: {
        method: 'GET',
        path: '/foods/search',
        query: { query: TERM, pageSize: '20', dataType: 'Foundation,SR Legacy,Survey (FNDDS),Branded' },
        body: undefined,
    },
    2: {
        method: 'POST',
        path: '/foods/search',
        query: {},
        body: { query: TERM, pageSize: 20, dataType: ['Foundation', 'SR Legacy', 'Survey (FNDDS)', 'Branded'] },
    },
};

/**
 * The request the adapter sends USDA for {@link TERM}.
 *
 * @returns It, with the key taken out of the query.
 */
async function sentSearch(): Promise<WireSearch | undefined> {
    let sent: WireSearch | undefined;

    const fetchFn: typeof fetch = (input, init) => {
        const url = new URL(input instanceof Request ? input.url : input.toString());
        const body = typeof init?.body === 'string' ? init.body : undefined;

        url.searchParams.delete('api_key');
        sent = {
            method: init?.method ?? 'GET',
            path: url.pathname.slice(new URL(BASE_URL).pathname.length),
            query: Object.fromEntries(url.searchParams),
            body: body === undefined ? undefined : JSON.parse(body),
        };

        return Promise.resolve(Response.json({ totalHits: 0, foods: [] }));
    };

    await createUsdaSearchAdapter(
        { USDA_API_KEY_SECRET_ID: 'kitchensink/test/food/usda-api-key', USDA_API_BASE_URL: BASE_URL },
        { fetchFn, readSecret: () => Promise.resolve('revision-pin-key') },
    ).search(TERM);

    return sent;
}

describe('the USDA adapter revision', () => {
    it('was cut with the request the adapter sends', async () => {
        expect(await sentSearch()).toStrictEqual(REQUEST_OF_REVISION[REMOTE_SEARCH_ADAPTER_REVISIONS.usda]);
    });
});
