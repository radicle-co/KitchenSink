/**
 * Unit tests for the pure recipe-viewability predicate {@link isRecipeViewableBy} — the read-side
 * authorization rule reused by `getById` and both collection read paths.
 *
 * The full truth table is pinned so a mutation to either clause (drop the owner check → owners lose
 * their own private recipes; drop the public check → nobody sees public recipes; flip `||`→`&&` →
 * public recipes become invisible to non-owners) is caught.
 */
import { describe, it, expect } from 'vitest';

import { isRecipeViewableBy } from '../recipe-visibility.js';

const OWNER = 'owner-1';
const OTHER = 'other-2';

describe('isRecipeViewableBy', () => {
    it('owner sees their own private recipe', () => {
        expect(isRecipeViewableBy({ ownerId: OWNER, visibility: 'private' }, OWNER)).toBe(true);
    });

    it('owner sees their own public recipe', () => {
        expect(isRecipeViewableBy({ ownerId: OWNER, visibility: 'public' }, OWNER)).toBe(true);
    });

    it('a non-owner sees a public recipe', () => {
        expect(isRecipeViewableBy({ ownerId: OWNER, visibility: 'public' }, OTHER)).toBe(true);
    });

    it("a non-owner does NOT see another user's private recipe", () => {
        expect(isRecipeViewableBy({ ownerId: OWNER, visibility: 'private' }, OTHER)).toBe(false);
    });
});
