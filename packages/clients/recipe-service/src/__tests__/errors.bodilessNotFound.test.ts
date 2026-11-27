/**
 * A `404` is "the item is not there" only when the SERVICE said so. The shared ALB answers a host or path with no
 * rule using its own `404` with no service body (ADR-0003), and that is an outage, so it maps to
 * `SourceUnavailableError`, which the retry policy treats as transient. Owner ruling 2026-11-26.
 */
import { describe, expect, it } from 'vitest';

import {
    isNotFoundError,
    isSourceUnavailableError,
    NotFoundError,
    RecipeServiceClient,
    UnexpectedResponseError,
} from '../index.js';
import { stubFetch } from './utils/fetchDouble.js';

const BASE = 'https://recipes.example.test';

async function rejectionOf(fetchMock: typeof fetch): Promise<unknown> {
    return new RecipeServiceClient({ baseUrl: BASE, token: 'tok', fetch: fetchMock })
        .deleteRecipe('rec_1')
        .catch((caught: unknown) => caught);
}

describe('a 404 with no service body', () => {
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
        [
            'JSON that is not the service envelope',
            () => new Response('{"detail":"nope"}', { status: 404, headers: { 'content-type': 'application/json' } }),
        ],
    ])('is service-unavailable, not not-found: %s', async (_name, respond) => {
        const error = await rejectionOf((async () => respond()) as typeof fetch);

        expect(isSourceUnavailableError(error)).toBe(true);
        expect(isNotFoundError(error)).toBe(false);
    });
});

describe('a 404 the service answered', () => {
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
        const error = await rejectionOf((async () => new Response('x', { status })) as typeof fetch);

        expect(error).toMatchObject({ name });
    });

    it('a 500 stays an unexpected response', async () => {
        const error = await rejectionOf((async () => new Response('x', { status: 500 })) as typeof fetch);

        expect(error).toBeInstanceOf(UnexpectedResponseError);
    });
});
