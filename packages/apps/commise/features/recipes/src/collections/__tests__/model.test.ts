/**
 * CONTRACT-PARITY tests for the collections model's two converged wire aliases (§15 / ADR-0014).
 *
 * `CollectionMemberRecipe` and `CollectionWithRecipes` are no longer declared here — they are the published
 * `collectionMemberRecipeSchema` / `collectionWithRecipesResponseSchema` shapes. `typecheck` proves the ALIAS
 * cannot drift; these tests prove the two things a type alias alone cannot:
 *
 *  1. the values this package's fixtures and views actually build are accepted by the contract's own parser
 *     (so a fixture cannot satisfy the type while failing the runtime validation every client response goes
 *     through), and
 *  2. `recipes` is REQUIRED — the drift this convergence settled. A body with the key omitted must be
 *     REJECTED, so re-loosening it to optional anywhere fails here instead of in an emulator run.
 *
 * Mutation lens: each case fails if the corresponding rule is weakened — dropping `recipes`, widening
 * `addedVia`, or omitting one of the three response-only provenance fields from the alias.
 */
import { describe, expect, it } from 'vitest';
import { RecipeCollectionAddedVia } from '@kitchensink/recipe-core';
import { collectionMemberRecipeSchema, collectionWithRecipesResponseSchema } from '@kitchensink/schema-recipe';

import { makeCollectionMemberRecipe } from '../../__fixtures__/index.js';
import type { CollectionMemberRecipe, CollectionWithRecipes } from '../model.js';

/** A member recipe carrying its provenance, typed as the model's alias so a drift fails the typecheck too. */
const member: CollectionMemberRecipe = makeCollectionMemberRecipe({ id: 'rec_1', title: 'Weeknight Pasta' });

/** A fully-populated collection-with-recipes body, including the three response-only provenance fields. */
const clonedCollection: CollectionWithRecipes = {
    id: 'col_1',
    ownerId: 'usr_1',
    name: 'Weeknight Dinners',
    description: 'Fast weeknight cooking.',
    visibility: 'private',
    sourceCollectionId: 'col_src',
    sourceOwnerHandle: 'alexk',
    sourceCollectionName: 'Alex — weeknights',
    lastPulledAt: '2026-04-18T09:00:00.000Z',
    createdAt: '2026-04-01T09:00:00.000Z',
    updatedAt: '2026-04-19T09:30:00.000Z',
    recipes: [member],
};

describe('CollectionMemberRecipe — contract parity', () => {
    it('accepts the feature fixture as a valid wire member', () => {
        const parsed = collectionMemberRecipeSchema.parse(member);

        expect(parsed.id).toBe('rec_1');
        expect(parsed.addedVia).toBe(RecipeCollectionAddedVia.MANUAL);
    });

    it('rejects a member whose provenance is not one of the contract values', () => {
        expect(() => collectionMemberRecipeSchema.parse({ ...member, addedVia: 'imported' })).toThrow();
    });

    it('rejects a member with no provenance at all', () => {
        const { addedVia: _addedVia, ...withoutProvenance } = member;

        expect(() => collectionMemberRecipeSchema.parse(withoutProvenance)).toThrow();
    });
});

describe('CollectionWithRecipes — contract parity', () => {
    it('accepts a fully-populated body, preserving the three response-only provenance fields', () => {
        const parsed = collectionWithRecipesResponseSchema.parse(clonedCollection);

        expect(parsed.sourceOwnerHandle).toBe('alexk');
        expect(parsed.sourceCollectionName).toBe('Alex — weeknights');
        expect(parsed.lastPulledAt).toBe('2026-04-18T09:00:00.000Z');
        expect(parsed.recipes).toHaveLength(1);
    });

    it('accepts an EMPTY member list — "nothing you can see" is a real, fully-represented state', () => {
        const parsed = collectionWithRecipesResponseSchema.parse({ ...clonedCollection, recipes: [] });

        expect(parsed.recipes).toEqual([]);
    });

    it('REJECTS a body with recipes omitted — the key is required, not optional (settled drift)', () => {
        const { recipes: _recipes, ...withoutRecipes } = clonedCollection;

        expect(() => collectionWithRecipesResponseSchema.parse(withoutRecipes)).toThrow();
    });

    it('accepts a never-cloned collection — all three provenance fields are optional', () => {
        const {
            sourceCollectionId: _sourceCollectionId,
            sourceOwnerHandle: _sourceOwnerHandle,
            sourceCollectionName: _sourceCollectionName,
            lastPulledAt: _lastPulledAt,
            ...ownCollection
        } = clonedCollection;
        const parsed = collectionWithRecipesResponseSchema.parse(ownCollection);

        expect(parsed.sourceOwnerHandle).toBeUndefined();
        expect(parsed.lastPulledAt).toBeUndefined();
    });
});
