import { describe, expect, it } from 'vitest';
import { RecipeErrorCode } from '@kitchensink/recipe-core';

import { sourceConflictRefused, statementRequiredRefused } from '../recipe.error.js';

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
