/**
 * A `404` is "the item is not there" only when the SERVICE said so. The shared ALB answers a host or path with no
 * rule using its own `404` with no service body (ADR-0003), and that is an outage, so it maps to
 * `ServiceUnreachableError`, which the retry policy treats as transient. Owner ruling 2026-11-26.
 */
import { describe, expect, it } from 'vitest';

import {
    isNotFoundError,
    isServiceUnreachableError,
    isSourceUnavailableError,
    NotFoundError,
    RecipeServiceClient,
    UnexpectedResponseError,
} from '../index.js';
import { stubFetch } from './utils/fetchDouble.js';

const BASE = 'https://recipes.example.test';

/** A `fetch` that answers every call with the response `respond` builds. */
const fetchOf =
    (respond: () => Response): typeof fetch =>
    () =>
        Promise.resolve(respond());

async function rejectionOf(fetchMock: typeof fetch): Promise<unknown> {
    return new RecipeServiceClient({ baseUrl: BASE, token: 'tok', fetch: fetchMock })
        .deleteRecipe('rec_1')
        .catch((caught: unknown) => caught);
}

describe('a 404 whose body is not JSON', () => {
    it.each([
        ['an empty body', () => new Response(null, { status: 404 })],
        [
            'a text/plain page',
            () => new Response('Not Found', { status: 404, headers: { 'content-type': 'text/plain' } }),
        ],
        [
            'an HTML page',
            () => new Response('<html>404</html>', { status: 404, headers: { 'content-type': 'text/html' } }),
        ],
    ])('is service-unreachable, not not-found: %s', async (_name, respond) => {
        const error = await rejectionOf(fetchOf(respond));

        expect(isServiceUnreachableError(error)).toBe(true);
        expect(isSourceUnavailableError(error)).toBe(false);
        expect(isNotFoundError(error)).toBe(false);
    });
});

describe('a 404 the service answered', () => {
    it("stays not-found for Nest's default body, which has no code, because only the service sends JSON", async () => {
        const error = await rejectionOf(
            stubFetch(404, { statusCode: 404, message: 'Collection not found', error: 'Not Found' }),
        );

        expect(error).toBeInstanceOf(NotFoundError);
    });

    it('stays not-found for a known code', async () => {
        const error = await rejectionOf(
            stubFetch(404, { code: 'RECIPE_NOT_FOUND', message: 'Recipe rec_1 not found.' }),
        );

        expect(error).toBeInstanceOf(NotFoundError);
    });

    it('stays not-found for a code this build does not know, because the envelope is the service', async () => {
        const error = await rejectionOf(stubFetch(404, { code: 'SOMETHING_NEWER', message: 'newer service' }));

        expect(error).toBeInstanceOf(NotFoundError);
        expect(error).toMatchObject({ code: 'SOMETHING_NEWER' });
    });
});

describe('other statuses with no service body are unchanged', () => {
    it.each([
        [400, 'BadRequestError'],
        [403, 'ForbiddenError'],
        [410, 'GoneError'],
    ])('%i keeps its own typed error', async (status, name) => {
        const error = await rejectionOf(fetchOf(() => new Response('x', { status })));

        expect(error).toMatchObject({ name });
    });

    it('a 500 stays an unexpected response', async () => {
        const error = await rejectionOf(fetchOf(() => new Response('x', { status: 500 })));

        expect(error).toBeInstanceOf(UnexpectedResponseError);
    });
});
