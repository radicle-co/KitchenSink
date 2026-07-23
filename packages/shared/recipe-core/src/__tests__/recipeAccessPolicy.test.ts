import { describe, expect, it } from 'vitest';

import { RecipeVisibility } from '../index.js';
import { makeViewer } from '../viewer.js';
import { isOwner, canClone, canRate, canGoPrivate } from '../recipeAccessPolicy.js';

const recipe = { ownerId: 'usr_owner', visibility: RecipeVisibility.PUBLIC } as const;

describe('recipeAccessPolicy (P4)', () => {
    it('is not owner when the viewer id is absent (fail-safe, never masquerade)', () => {
        expect(isOwner(recipe, makeViewer({}))).toBe(false);
    });
    it('is owner only on an exact id match', () => {
        expect(isOwner(recipe, makeViewer({ id: 'usr_owner' }))).toBe(true);
        expect(isOwner(recipe, makeViewer({ id: 'usr_other' }))).toBe(false);
    });
    it('lets a non-owner clone a public recipe but never the owner (fixes D7 web/mobile disagreement)', () => {
        expect(canClone(recipe, makeViewer({ id: 'usr_other' }))).toBe(true);
        expect(canClone(recipe, makeViewer({ id: 'usr_owner' }))).toBe(false);
        expect(canClone({ ...recipe, visibility: RecipeVisibility.PRIVATE }, makeViewer({ id: 'usr_x' }))).toBe(false);
    });
    it('rates iff the viewer can see it and does not own it', () => {
        expect(canRate(recipe, makeViewer({ id: 'usr_other' }))).toBe(true);
        expect(canRate(recipe, makeViewer({ id: 'usr_owner' }))).toBe(false);
        expect(canRate(recipe, makeViewer({}))).toBe(false);
    });
    it('gates private-visibility on the premium tier, failing closed when tier is unknown', () => {
        expect(canGoPrivate(makeViewer({ id: 'u', subscriptionTier: 'premium' }))).toBe(true);
        expect(canGoPrivate(makeViewer({ id: 'u', subscriptionTier: 'free' }))).toBe(false);
        expect(canGoPrivate(makeViewer({ id: 'u' }))).toBe(false);
    });
});
