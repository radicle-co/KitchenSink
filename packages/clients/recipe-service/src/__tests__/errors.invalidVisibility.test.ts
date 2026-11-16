/**
 * The typed form of `400 INVALID_VISIBILITY` (ADR-0092): the refusal names WHY in `details.reason`, and a surface answers each
 * reason differently (a statement is owed, a held source, a client bug). Written before the class existed.
 *
 *  - it is still a `BadRequestError`, so every caller that knows only that class (the outbox's terminal 400, the retry policy)
 *    behaves as before;
 *  - it carries the reason the server named, and a reason this client does not know reads as a plain `BadRequestError`, so a
 *    new server reason never throws.
 */
import { describe, expect, it } from 'vitest';
import { RecipeVisibility } from '@kitchensink/recipe-core';

import { RecipeServiceClient } from '../client.js';
import { BadRequestError, InvalidVisibilityError, isInvalidVisibilityError } from '../errors.js';
import { shouldRetryRecipeServiceFailure } from '../retryPolicy.js';
import { stubFetch } from './utils/fetchDouble.js';

async function failureOf(body: unknown): Promise<unknown> {
    return new RecipeServiceClient({
        baseUrl: 'https://recipes.example.test',
        token: 'tok',
        fetch: stubFetch(400, body),
    })
        .setRecipeVisibility('3f2504e0-4f89-41d3-9a0c-0305e82c3301', RecipeVisibility.PUBLIC)
        .catch((thrown: unknown) => thrown);
}

describe('InvalidVisibilityError', () => {
    it.each([
        'SOURCE_CONFLICT',
        'STATEMENT_REQUIRED',
        'PUBLIC_CONFIRMATION_REQUIRED',
        'FROM_PERSON_PRIVATE_ONLY',
    ] as const)('is mapped from the wire with the reason %s', async (reason) => {
        const error = await failureOf({ code: 'INVALID_VISIBILITY', message: 'no', details: { reason } });

        expect(error).toBeInstanceOf(InvalidVisibilityError);
        expect(error).toMatchObject({ status: 400, code: 'INVALID_VISIBILITY', reason });
    });

    it.each([undefined, {}])('carries no reason when the server named none (%j)', async (details) => {
        const error = await failureOf({ code: 'INVALID_VISIBILITY', message: 'no', details });

        expect(error).toBeInstanceOf(InvalidVisibilityError);
        expect((error as InvalidVisibilityError).reason).toBeUndefined();
    });

    it('reads a reason this client does not know as a plain refusal, and never throws', async () => {
        const error = await failureOf({ code: 'INVALID_VISIBILITY', message: 'no', details: { reason: 'NEW_REASON' } });

        expect(error).toBeInstanceOf(BadRequestError);
        expect(error).toMatchObject({ status: 400, code: 'INVALID_VISIBILITY' });
    });

    it('is still a BadRequestError and still terminal for the retry policy', async () => {
        const error = await failureOf({
            code: 'INVALID_VISIBILITY',
            message: 'no',
            details: { reason: 'STATEMENT_REQUIRED' },
        });

        expect(error).toBeInstanceOf(BadRequestError);
        expect(shouldRetryRecipeServiceFailure(error)).toBe(false);
    });

    it('its guard is true for the class only', () => {
        expect(isInvalidVisibilityError(new InvalidVisibilityError('x', 'STATEMENT_REQUIRED'))).toBe(true);
        expect(isInvalidVisibilityError(new BadRequestError('x', 'INVALID_VISIBILITY'))).toBe(false);
    });
});
