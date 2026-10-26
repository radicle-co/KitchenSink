/**
 * The typed form of `403 PRIVATE_SLOTS_FULL` (ADR-0073): a free cook has no private slot left, and NOTHING was written.
 *
 * Written before the class existed. The cases are the ones a surface depends on:
 *  - it is its OWN type, carrying `used` and `limit` as the server counted them, so the refusal can say "all 50 in use"
 *    (and "60 of 50" for a downgraded cook) without parsing a message;
 *  - it is NOT a version conflict. The status is 403 precisely so that an installed client that predates this code reads
 *    a plain refusal rather than opening the conflict view, and a 409 here would have been exactly that failure;
 *  - it is TERMINAL for the retry policy: repeating the same write meets the same full slots, and a retry loop or the
 *    editor's outbox that re-sent it would hammer the server for nothing.
 */
import { describe, expect, it } from 'vitest';
import { RecipeVisibility } from '@kitchensink/recipe-core';

import { RecipeServiceClient } from '../client.js';
import {
    ForbiddenError,
    PrivateSlotsFullError,
    RecipeServiceClientError,
    UnexpectedResponseError,
    VersionConflictError,
    isPrivateSlotsFullError,
} from '../errors.js';
import { shouldRetryRecipeServiceFailure } from '../retryPolicy.js';
import { stubFetch } from './utils/fetchDouble.js';

async function failureOf(status: number, body: unknown): Promise<unknown> {
    return new RecipeServiceClient({
        baseUrl: 'https://recipes.example.test',
        token: 'tok',
        fetch: stubFetch(status, body),
    })
        .setRecipeVisibility('3f2504e0-4f89-41d3-9a0c-0305e82c3301', RecipeVisibility.PRIVATE)
        .catch((thrown: unknown) => thrown);
}

describe('PrivateSlotsFullError', () => {
    it('carries the status, the code and the count the server saw', () => {
        const error = new PrivateSlotsFullError(60, 50);

        expect(error).toBeInstanceOf(RecipeServiceClientError);
        expect(error).toMatchObject({ status: 403, code: 'PRIVATE_SLOTS_FULL', used: 60, limit: 50 });
        expect(Object.getPrototypeOf(error)).toBe(PrivateSlotsFullError.prototype);
    });

    it('is mapped from the wire off the code, with used and limit', async () => {
        const error = await failureOf(403, {
            code: 'PRIVATE_SLOTS_FULL',
            message: 'All of your private slots are in use.',
            details: { used: 50, limit: 50 },
        });

        expect(error).toBeInstanceOf(PrivateSlotsFullError);
        expect(error).toMatchObject({ status: 403, used: 50, limit: 50 });
    });

    it('is not a ForbiddenError (a scope gate) and not a version conflict', async () => {
        const error = await failureOf(403, {
            code: 'PRIVATE_SLOTS_FULL',
            message: 'full',
            details: { used: 50, limit: 50 },
        });

        expect(error).not.toBeInstanceOf(ForbiddenError);
        expect(error).not.toBeInstanceOf(VersionConflictError);
    });

    it('is TERMINAL: the retry policy never re-sends it', async () => {
        const error = await failureOf(403, {
            code: 'PRIVATE_SLOTS_FULL',
            message: 'full',
            details: { used: 50, limit: 50 },
        });

        expect(shouldRetryRecipeServiceFailure(error)).toBe(false);
    });

    it('its guard is true for the class only', () => {
        expect(isPrivateSlotsFullError(new PrivateSlotsFullError(50, 50))).toBe(true);
        expect(isPrivateSlotsFullError(new ForbiddenError('x', 'FORBIDDEN'))).toBe(false);
        expect(isPrivateSlotsFullError(new UnexpectedResponseError(403, 'x', 'PRIVATE_SLOTS_FULL'))).toBe(false);
    });
});
