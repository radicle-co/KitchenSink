/**
 * CR-001 / FR-013 — unit tests for {@link RatingsService}, the authorization crux of the rating write.
 *
 * The service owns the rules the DAL deliberately does not, and the ORDER they run in is load-bearing:
 *
 *   1. Recipe missing / tombstoned            → 404 RECIPE_NOT_FOUND
 *   2. Recipe not visible to the caller (IDOR) → 404 RECIPE_NOT_FOUND  (NOT 403 — a 403 would confirm
 *      a private recipe the caller may not know exists)
 *   3. Caller OWNS the recipe                  → 403 CANNOT_RATE_OWN_RECIPE  (safe: the owner already
 *      knows it exists, so revealing that leaks nothing)
 *   4. Otherwise                               → upsert, then return the trigger-refreshed RecipeDetail
 *
 * Every branch is pinned, and the two mutation-critical asymmetries (unseeable → 404-not-403, own → 403)
 * have dedicated tests: flip either and a test flips with it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { RatingsService } from '../ratings.service.js';
import type { RatingsDal } from '../dal/ratings.dal.js';
import type { RecipesDal, RecipeAggregate } from '../../recipes/dal/recipes.dal.js';
import type { RecipesService } from '../../recipes/recipes.service.js';
import type { RecipeResponse } from '../../recipes/dto/recipe-response.dto.js';
import { isRecipeDomainError } from '../../recipes/recipe.error.js';
import { RecipeErrorCode } from '@kitchensink/recipe-core';
import { makeRecipeRow } from '../../__fixtures__/index.js';

const RATER = '01JRATER00000000000000000A';
const OWNER = '01JOWNER00000000000000000B';
const RECIPE_ID = '00000000-0000-4000-8000-00000000a001';

/** A recipe aggregate with a controllable owner + visibility (steps/ingredients irrelevant to authz). */
function aggregate(overrides: Partial<{ ownerId: string; visibility: string }> = {}): RecipeAggregate {
    return {
        recipe: makeRecipeRow({
            id: RECIPE_ID,
            ownerId: overrides.ownerId ?? OWNER,
            visibility: overrides.visibility ?? 'public',
        }),
        steps: [],
        ingredients: [],
    };
}

interface Harness {
    service: RatingsService;
    recipesDal: { findById: ReturnType<typeof vi.fn> };
    ratingsDal: { upsert: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };
    recipesService: { getById: ReturnType<typeof vi.fn> };
    detail: RecipeResponse;
}

function makeHarness(found: RecipeAggregate | undefined): Harness {
    const detail = { id: RECIPE_ID, ratingCount: 1, averageRating: 4 } as unknown as RecipeResponse;
    const recipesDal = { findById: vi.fn().mockResolvedValue(found) };
    const ratingsDal = { upsert: vi.fn().mockResolvedValue(undefined), delete: vi.fn().mockResolvedValue(true) };
    const recipesService = { getById: vi.fn().mockResolvedValue(detail) };
    const service = new RatingsService(
        ratingsDal as unknown as RatingsDal,
        recipesDal as unknown as RecipesDal,
        recipesService as unknown as RecipesService,
    );

    return { service, recipesDal, ratingsDal, recipesService, detail };
}

/** Assert a thrown value is the expected domain error code. */
async function expectDomainError(promise: Promise<unknown>, code: RecipeErrorCode): Promise<void> {
    await expect(promise).rejects.toSatisfy((err: unknown) => isRecipeDomainError(err) && err.code === code);
}

describe('RatingsService.setRating', () => {
    let h: Harness;

    beforeEach(() => {
        h = makeHarness(aggregate());
    });

    it('rates a visible recipe owned by someone else, then returns the trigger-refreshed detail', async () => {
        const result = await h.service.setRating(RATER, RECIPE_ID, { stars: 4 });

        expect(h.ratingsDal.upsert).toHaveBeenCalledWith({ recipeId: RECIPE_ID, userId: RATER, stars: 4 });
        // The rater comes from the token arg, never the body — the DAL is called with the verified RATER.
        expect(h.recipesService.getById).toHaveBeenCalledWith(RATER, RECIPE_ID);
        expect(result).toBe(h.detail);
    });

    it('re-rating upserts (never a second row) and re-reads the aggregate', async () => {
        await h.service.setRating(RATER, RECIPE_ID, { stars: 2 });
        await h.service.setRating(RATER, RECIPE_ID, { stars: 5 });

        expect(h.ratingsDal.upsert).toHaveBeenNthCalledWith(1, { recipeId: RECIPE_ID, userId: RATER, stars: 2 });
        expect(h.ratingsDal.upsert).toHaveBeenNthCalledWith(2, { recipeId: RECIPE_ID, userId: RATER, stars: 5 });
    });

    it('404s (RECIPE_NOT_FOUND) for a missing/tombstoned recipe, and never writes a rating', async () => {
        const missing = makeHarness(undefined);

        await expectDomainError(
            missing.service.setRating(RATER, RECIPE_ID, { stars: 3 }),
            RecipeErrorCode.RECIPE_NOT_FOUND,
        );
        expect(missing.ratingsDal.upsert).not.toHaveBeenCalled();
    });

    it('404s (RECIPE_NOT_FOUND) — NOT 403 — for a private recipe the caller cannot see (IDOR boundary)', async () => {
        // The mutation lens: if the service returned CANNOT_RATE_OWN_RECIPE (403) or NOT_OWNER (403) here,
        // it would confirm the private recipe exists to someone not allowed to know. It MUST be the SAME
        // 404 a missing recipe gives. This test fails the instant the code leaks a 403.
        const privateNotMine = makeHarness(aggregate({ ownerId: OWNER, visibility: 'private' }));

        await expectDomainError(
            privateNotMine.service.setRating(RATER, RECIPE_ID, { stars: 3 }),
            RecipeErrorCode.RECIPE_NOT_FOUND,
        );
        expect(privateNotMine.ratingsDal.upsert).not.toHaveBeenCalled();
    });

    it('403s (CANNOT_RATE_OWN_RECIPE) when the caller owns the recipe, and never writes a rating', async () => {
        // A recipe the caller can see AND owns: existence is already known to the owner, so an explicit
        // 403 leaks nothing. Dropping this check (letting an owner rate) makes this test fail.
        const own = makeHarness(aggregate({ ownerId: RATER, visibility: 'public' }));

        await expectDomainError(
            own.service.setRating(RATER, RECIPE_ID, { stars: 5 }),
            RecipeErrorCode.CANNOT_RATE_OWN_RECIPE,
        );
        expect(own.ratingsDal.upsert).not.toHaveBeenCalled();
    });

    it("403s (CANNOT_RATE_OWN_RECIPE) even for the caller's OWN PRIVATE recipe (own-check precedes nothing hides it)", async () => {
        // Owner + private: viewable (owner sees own private), so the own-check — not the visibility check —
        // decides. Confirms the precedence: for a recipe the caller CAN see, ownership is the deciding rule.
        const ownPrivate = makeHarness(aggregate({ ownerId: RATER, visibility: 'private' }));

        await expectDomainError(
            ownPrivate.service.setRating(RATER, RECIPE_ID, { stars: 5 }),
            RecipeErrorCode.CANNOT_RATE_OWN_RECIPE,
        );
    });
});

describe('RatingsService.deleteRating', () => {
    it("removes the caller's rating on a visible recipe (idempotent — returns void regardless)", async () => {
        const h = makeHarness(aggregate());

        await expect(h.service.deleteRating(RATER, RECIPE_ID)).resolves.toBeUndefined();
        expect(h.ratingsDal.delete).toHaveBeenCalledWith(RECIPE_ID, RATER);
    });

    it('is a clean 204 no-op when the caller had no rating (delete reports false)', async () => {
        const h = makeHarness(aggregate());
        h.ratingsDal.delete.mockResolvedValue(false);

        await expect(h.service.deleteRating(RATER, RECIPE_ID)).resolves.toBeUndefined();
    });

    it('404s for a missing recipe, and never issues a delete', async () => {
        const missing = makeHarness(undefined);

        await expectDomainError(missing.service.deleteRating(RATER, RECIPE_ID), RecipeErrorCode.RECIPE_NOT_FOUND);
        expect(missing.ratingsDal.delete).not.toHaveBeenCalled();
    });

    it('404s (NOT 403) for a private recipe the caller cannot see — same non-leaking boundary as PUT', async () => {
        const privateNotMine = makeHarness(aggregate({ ownerId: OWNER, visibility: 'private' }));

        await expectDomainError(
            privateNotMine.service.deleteRating(RATER, RECIPE_ID),
            RecipeErrorCode.RECIPE_NOT_FOUND,
        );
        expect(privateNotMine.ratingsDal.delete).not.toHaveBeenCalled();
    });

    it('does NOT 403 when the caller owns the recipe — DELETE carries no own-recipe rejection (contract)', async () => {
        // The DELETE contract lists 204/401/404 only. An owner can never have a rating on their own recipe
        // (PUT blocks it), so deleting is a clean no-op 204 — no CANNOT_RATE_OWN_RECIPE here.
        const own = makeHarness(aggregate({ ownerId: RATER, visibility: 'public' }));

        await expect(own.service.deleteRating(RATER, RECIPE_ID)).resolves.toBeUndefined();
        expect(own.ratingsDal.delete).toHaveBeenCalledWith(RECIPE_ID, RATER);
    });
});
