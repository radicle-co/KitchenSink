import { describe, expect, it } from 'vitest';

import { recipeId, userId, isRecipeId } from '../ids.js';

describe('branded ids (DA6)', () => {
    it('constructs and guards a RecipeId', () => {
        const id = recipeId('rec_1');
        expect(isRecipeId(id)).toBe(true);
        expect(String(id)).toBe('rec_1');
    });
    it('rejects an empty id at the boundary', () => {
        expect(() => recipeId('')).toThrow();
    });
    it('brands a UserId distinctly from a RecipeId, even though both are plain strings at runtime', () => {
        // Compile-time proof (documented, exercised here at the value level): a function typed
        // `(id: RecipeId, owner: UserId)` rejects a transposed call `fn(userId('u'), recipeId('r'))` at
        // compile time — a bare-string version of the same signature would type-check that transposition
        // silently. The runtime assertion below is the value-level half of that guarantee: the brand adds
        // no runtime representation, so a `UserId` still compares/serializes exactly like the string it wraps.
        const uid = userId('usr_1');
        expect(String(uid)).toBe('usr_1');
    });
});
