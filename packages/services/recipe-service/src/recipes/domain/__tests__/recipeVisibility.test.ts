/**
 * Unit tests for the pure recipe-viewability predicate {@link isRecipeViewableBy} — the read-side
 * authorization rule reused by `getById` and both collection read paths.
 *
 * The full truth table is pinned so a mutation to any clause (drop the owner check → owners lose their own
 * private/draft recipes; drop the public check → nobody sees public recipes; flip `||`→`&&` → public
 * recipes become invisible to non-owners; drop the status check → drafts LEAK to non-owners) is caught.
 */
import { describe, it, expect } from 'vitest';

import { isRecipeViewableBy } from '../recipeVisibility.js';

const OWNER = 'owner-1';
const OTHER = 'other-2';

describe('isRecipeViewableBy', () => {
    it('owner sees their own private recipe', () => {
        expect(isRecipeViewableBy({ ownerId: OWNER, visibility: 'private', status: 'published' }, OWNER)).toBe(true);
    });

    it('owner sees their own public recipe', () => {
        expect(isRecipeViewableBy({ ownerId: OWNER, visibility: 'public', status: 'published' }, OWNER)).toBe(true);
    });

    it('a non-owner sees a public published recipe', () => {
        expect(isRecipeViewableBy({ ownerId: OWNER, visibility: 'public', status: 'published' }, OTHER)).toBe(true);
    });

    it("a non-owner does NOT see another user's private recipe", () => {
        expect(isRecipeViewableBy({ ownerId: OWNER, visibility: 'private', status: 'published' }, OTHER)).toBe(false);
    });

    it('owner sees their own DRAFT (draft is owner-visible regardless of visibility) — W8-a.3', () => {
        expect(isRecipeViewableBy({ ownerId: OWNER, visibility: 'public', status: 'draft' }, OWNER)).toBe(true);
        expect(isRecipeViewableBy({ ownerId: OWNER, visibility: 'private', status: 'draft' }, OWNER)).toBe(true);
    });

    it('a non-owner does NOT see a PUBLIC DRAFT — the leak the status term closes (W8-a.3)', () => {
        // A free-tier draft carries visibility='public'; the visibility clause alone would wrongly admit it.
        expect(isRecipeViewableBy({ ownerId: OWNER, visibility: 'public', status: 'draft' }, OTHER)).toBe(false);
    });
});
