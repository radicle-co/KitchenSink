/**
 * `isRecipeNotFoundError` — whether a refusal is the recipe service itself saying no active recipe has that id.
 *
 * ⛔ A 404 ALONE IS NOT THAT. The shared ALB answers a host with no listener rule (`recipe-pr-{N}` torn down) with a
 * code-less `text/plain` 404 (ADR-0003), and the service answers a path it does not route with `NOT_FOUND`. Both
 * become a `NotFoundError`, and neither says anything about the recipe. A caller that read them as "already deleted"
 * reported a Discard as done while the recipe still existed, and settled away every parked write of it.
 */
import { describe, expect, it } from 'vitest';

import { ForbiddenError, isRecipeNotFoundError, NotFoundError, RecipeServiceClient } from '../index.js';
import { stubFetch } from './utils/fetchDouble.js';

const BASE = 'https://recipes.example.test';

describe('isRecipeNotFoundError', () => {
    it.each([
        ['a NotFoundError carrying RECIPE_NOT_FOUND', new NotFoundError('gone', 'RECIPE_NOT_FOUND'), true],
        ['a NotFoundError carrying the route-level NOT_FOUND', new NotFoundError('no route', 'NOT_FOUND'), false],
        ['a NotFoundError with no code', new NotFoundError('gone'), false],
        ['another error carrying RECIPE_NOT_FOUND', new ForbiddenError('no', 'RECIPE_NOT_FOUND'), false],
        ['a non-error', { code: 'RECIPE_NOT_FOUND', status: 404 }, false],
    ])('%s → %s', (_name, error, expected) => {
        expect(isRecipeNotFoundError(error)).toBe(expected);
    });

    it("is true for the service's own 404 answer, read through the client", async () => {
        const fetchMock = stubFetch(404, { code: 'RECIPE_NOT_FOUND', message: 'Recipe rec_1 not found.' });
        const error: unknown = await new RecipeServiceClient({ baseUrl: BASE, token: 'tok', fetch: fetchMock })
            .deleteRecipe('rec_1')
            .catch((caught: unknown) => caught);

        expect(isRecipeNotFoundError(error)).toBe(true);
    });

    it("⛔ is false for the ALB's code-less text/plain 404, read through the client", async () => {
        const fetchMock = (async () =>
            new Response('Not Found', { status: 404, headers: { 'content-type': 'text/plain' } })) as typeof fetch;
        const error: unknown = await new RecipeServiceClient({ baseUrl: BASE, token: 'tok', fetch: fetchMock })
            .deleteRecipe('rec_1')
            .catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(NotFoundError);
        expect(isRecipeNotFoundError(error)).toBe(false);
    });
});
