import { describe, expect, it } from 'vitest';
import { RecipeErrorCode } from '@kitchensink/recipe-core';

import { recipeApiErrorSchema } from '../../common/apiError.schema.js';
import {
    fromPersonPrivateOnly,
    publicConfirmationRequired,
    sourceConflictRefused,
    statementRequiredRefused,
} from '../recipe.error.js';

/**
 * The two refusals the evidence-derived rules answer with are ONE published code (`INVALID_VISIBILITY`, a 400) told apart by
 * `details.reason`, so a client branches on a stable key and the contract gains no code. They must not share a key: a client
 * that opens the statement sheet for a source conflict (or the reverse) tells the cook the wrong thing.
 */
describe('statementRequiredRefused', () => {
    it('is INVALID_VISIBILITY with details.reason STATEMENT_REQUIRED, carrying the attempted visibility', () => {
        const error = statementRequiredRefused('Say where this recipe is from.', { visibility: 'public' });

        expect(error.code).toBe(RecipeErrorCode.INVALID_VISIBILITY);
        expect(error.message).toBe('Say where this recipe is from.');
        expect(error.details).toEqual({ visibility: 'public', reason: 'STATEMENT_REQUIRED' });
    });

    it('does not answer with the evidence rule’s key', () => {
        expect(statementRequiredRefused('x').details).not.toEqual(sourceConflictRefused('x').details);
        expect(sourceConflictRefused('x').details).toEqual({ reason: 'SOURCE_CONFLICT' });
    });
});

/**
 * Each refusal names its OWN published reason, spelled out here as the literal a client branches on, so a reordered or
 * renamed reason list cannot make one refusal answer with another's key. The details also pass the published schema.
 */
describe('every INVALID_VISIBILITY refusal sends its own published reason', () => {
    it.each([
        ['sourceConflictRefused', () => sourceConflictRefused('x'), 'SOURCE_CONFLICT'],
        ['statementRequiredRefused', () => statementRequiredRefused('x'), 'STATEMENT_REQUIRED'],
        ['publicConfirmationRequired', () => publicConfirmationRequired(), 'PUBLIC_CONFIRMATION_REQUIRED'],
        ['fromPersonPrivateOnly', () => fromPersonPrivateOnly('x'), 'FROM_PERSON_PRIVATE_ONLY'],
    ])('%s', (_name, make, reason) => {
        const error = make();

        expect(error.code).toBe(RecipeErrorCode.INVALID_VISIBILITY);
        expect(error.details).toMatchObject({ reason });
        expect(
            recipeApiErrorSchema.safeParse({ code: error.code, message: error.message, details: error.details })
                .success,
        ).toBe(true);
    });
});
