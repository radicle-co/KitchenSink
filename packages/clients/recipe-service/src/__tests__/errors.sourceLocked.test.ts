/**
 * The typed form of the lock refusal, `403 FORBIDDEN` with `details.reason: 'SOURCE_LOCKED'`. Written before the class existed.
 *
 *  - it is still a `ForbiddenError` and still a 403, so every caller that knows only that class (the outbox's terminal 403, the
 *    retry policy) behaves as before: the write is parked, never dropped;
 *  - a 403 with no reason, or one this client does not know, is a plain `ForbiddenError`, so a new server reason never throws.
 */
import { describe, expect, it } from 'vitest';

import { RecipeServiceClient } from '../client.js';
import { ForbiddenError, SourceLockedError, isSourceLockedError } from '../errors.js';
import { shouldRetryRecipeServiceFailure } from '../retryPolicy.js';
import { stubFetch } from './utils/fetchDouble.js';

async function failureOf(body: unknown): Promise<unknown> {
    return new RecipeServiceClient({
        baseUrl: 'https://recipes.example.test',
        token: 'tok',
        fetch: stubFetch(403, body),
    })
        .deleteRecipe('3f2504e0-4f89-41d3-9a0c-0305e82c3301')
        .catch((thrown: unknown) => thrown);
}

describe('SourceLockedError', () => {
    it('is mapped from FORBIDDEN with the reason SOURCE_LOCKED', async () => {
        const error = await failureOf({ code: 'FORBIDDEN', message: 'no', details: { reason: 'SOURCE_LOCKED' } });

        expect(error).toBeInstanceOf(SourceLockedError);
        expect(error).toMatchObject({ status: 403, code: 'FORBIDDEN' });
    });

    it.each([undefined, {}, { reason: 'NEW_REASON' }, { requiredScope: 'recipes:source:correct' }])(
        'is a plain ForbiddenError when the reason is absent or unknown (%j)',
        async (details) => {
            const error = await failureOf({ code: 'FORBIDDEN', message: 'no', details });

            expect(error).toBeInstanceOf(ForbiddenError);
            expect(error).not.toBeInstanceOf(SourceLockedError);
        },
    );

    it('is still a ForbiddenError and still terminal for the retry policy', async () => {
        const error = await failureOf({ code: 'FORBIDDEN', message: 'no', details: { reason: 'SOURCE_LOCKED' } });

        expect(error).toBeInstanceOf(ForbiddenError);
        expect(shouldRetryRecipeServiceFailure(error)).toBe(false);
    });

    it('its guard is true for the class only', () => {
        expect(isSourceLockedError(new SourceLockedError('x'))).toBe(true);
        expect(isSourceLockedError(new ForbiddenError('x', 'FORBIDDEN'))).toBe(false);
    });
});
