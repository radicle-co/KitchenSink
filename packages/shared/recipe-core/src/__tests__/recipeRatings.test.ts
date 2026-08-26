import { describe, it, expect } from 'vitest';

import {
    RecipeDifficulty,
    RecipeStatus,
    recipeDetailSchema,
    recipeDifficultySchema,
    recipeSchema,
    recipeStatusSchema,
    recipeVersionSchema,
    RecipeSearchSortBy,
    recipeSearchSortBySchema,
    RecipeErrorCode,
    recipeRatingSchema,
    recipeRatingStarsSchema,
    usesPremiumCapability,
    RecipeVisibility,
    RecipeSourceType,
} from '../index.js';
import type { Recipe, RecipeDetail, RecipeRating } from '../index.js';

/** A fully-populated, schema-valid `Recipe` the individual cases mutate one field at a time. */
function makeRecipe(overrides: Partial<Recipe> = {}): Recipe {
    return {
        id: 'rec-1',
        ownerId: '01JOWNER0000000000000000AA',
        title: 'Test',
        description: '',
        prepTimeMinutes: 5,
        cookTimeMinutes: 10,
        totalTimeMinutes: 15,
        servings: 2,
        visibility: RecipeVisibility.PUBLIC,
        status: RecipeStatus.PUBLISHED,
        sourceType: RecipeSourceType.USER_CREATED,
        hasSubstantiveEdit: false,
        dietaryFlags: [],
        tags: [],
        currentVersion: 1,
        ratingCount: 0,
        usesPremiumCapability: false,
        createdAt: '2026-07-16T00:00:00.000Z',
        updatedAt: '2026-07-16T00:00:00.000Z',
        ...overrides,
    };
}

/** A schema-valid `RecipeDetail` the `recipeDetailSchema` cases mutate one field at a time. */
function makeDetail(overrides: Partial<RecipeDetail> = {}): RecipeDetail {
    return {
        ...makeRecipe(),
        ingredients: [],
        steps: [],
        photos: [],
        nutrition: { calories: 0, proteinG: 0, carbsG: 0, fatG: 0, isComplete: true },
        ...overrides,
    };
}

describe('recipeDetailSchema — viewerRating (FR-013, the viewer’s own rating vs the community score)', () => {
    it('accepts and PRESERVES a present, valid viewerRating (1..5) — the field is not stripped', () => {
        // Regression: the detail schema is non-strict, so a missing `viewerRating` key would SILENTLY strip
        // the value the recipe-service returns, breaking pre-select. This asserts it survives the parse.
        const parsed = recipeDetailSchema.parse(makeDetail({ viewerRating: 4 }));
        expect(parsed.viewerRating).toBe(4);
    });

    it('accepts the boundary values 1 and 5', () => {
        expect(recipeDetailSchema.parse(makeDetail({ viewerRating: 1 })).viewerRating).toBe(1);
        expect(recipeDetailSchema.parse(makeDetail({ viewerRating: 5 })).viewerRating).toBe(5);
    });

    it('accepts an ABSENT viewerRating (the viewer has not rated, or it is their own recipe)', () => {
        const parsed = recipeDetailSchema.parse(makeDetail());
        expect(parsed.viewerRating).toBeUndefined();
        expect('viewerRating' in parsed).toBe(false);
    });

    it('rejects a viewerRating outside 1..5, including 0 (never a fabricated zero-star rating)', () => {
        expect(recipeDetailSchema.safeParse(makeDetail({ viewerRating: 0 })).success).toBe(false);
        expect(recipeDetailSchema.safeParse(makeDetail({ viewerRating: 6 })).success).toBe(false);
    });

    it('rejects a non-integer viewerRating (whole stars only)', () => {
        expect(recipeDetailSchema.safeParse(makeDetail({ viewerRating: 3.5 })).success).toBe(false);
    });

    it('keeps viewerRating (per-viewer) independent of averageRating (community) on the same detail', () => {
        // The two are DIFFERENT knowledge — the viewer rated 2, the community mean is 4.5 — and both must
        // round-trip untouched; conflating them would collapse one into the other.
        const parsed = recipeDetailSchema.parse(makeDetail({ viewerRating: 2, averageRating: 4.5, ratingCount: 8 }));
        expect(parsed.viewerRating).toBe(2);
        expect(parsed.averageRating).toBe(4.5);
    });
});

describe('RecipeDifficulty', () => {
    it('exposes exactly easy | medium | hard', () => {
        expect(Object.values(RecipeDifficulty).sort()).toEqual(['easy', 'hard', 'medium']);
    });

    it('accepts each valid difficulty and rejects anything else', () => {
        for (const value of Object.values(RecipeDifficulty)) {
            expect(recipeDifficultySchema.parse(value)).toBe(value);
        }

        expect(recipeDifficultySchema.safeParse('trivial').success).toBe(false);
        expect(recipeDifficultySchema.safeParse('EASY').success).toBe(false);
    });
});

describe('usesPremiumCapability (the derived PRO rule)', () => {
    it('is true ONLY for a chosen-private recipe (user_created / imported_public + private)', () => {
        expect(
            usesPremiumCapability({ visibility: RecipeVisibility.PRIVATE, sourceType: RecipeSourceType.USER_CREATED }),
        ).toBe(true);
        expect(
            usesPremiumCapability({
                visibility: RecipeVisibility.PRIVATE,
                sourceType: RecipeSourceType.IMPORTED_PUBLIC,
            }),
        ).toBe(true);
    });

    it('is false for FORCED-private imports (imported_physical / imported_paid) — not premium capability', () => {
        // The trap the naive `visibility === 'private'` falls into: these are private for EVERY tier.
        expect(
            usesPremiumCapability({
                visibility: RecipeVisibility.PRIVATE,
                sourceType: RecipeSourceType.IMPORTED_PHYSICAL,
            }),
        ).toBe(false);
        expect(
            usesPremiumCapability({
                visibility: RecipeVisibility.PRIVATE,
                sourceType: RecipeSourceType.IMPORTED_PAID,
            }),
        ).toBe(false);
    });

    it('is false for every public recipe regardless of source type', () => {
        for (const sourceType of Object.values(RecipeSourceType)) {
            expect(usesPremiumCapability({ visibility: RecipeVisibility.PUBLIC, sourceType })).toBe(false);
        }
    });
});

describe('recipeSchema — CR-001 rating aggregate + derived fields', () => {
    it('accepts a rated recipe with a 1..5 average and a positive count', () => {
        const parsed = recipeSchema.parse(makeRecipe({ averageRating: 4.5, ratingCount: 12 }));
        expect(parsed.averageRating).toBe(4.5);
        expect(parsed.ratingCount).toBe(12);
    });

    it('accepts an unrated recipe: absent average + zero count', () => {
        const parsed = recipeSchema.parse(makeRecipe({ ratingCount: 0 }));
        expect(parsed.averageRating).toBeUndefined();
        expect(parsed.ratingCount).toBe(0);
    });

    it('rejects an average outside 1..5 (a 0 would render as a real zero-star score)', () => {
        expect(recipeSchema.safeParse(makeRecipe({ averageRating: 0, ratingCount: 1 })).success).toBe(false);
        expect(recipeSchema.safeParse(makeRecipe({ averageRating: 5.5, ratingCount: 1 })).success).toBe(false);
    });

    it('accepts an optional difficulty and a cover photo URL, and tolerates their absence', () => {
        expect(recipeSchema.parse(makeRecipe({ difficulty: RecipeDifficulty.HARD })).difficulty).toBe('hard');
        expect(
            recipeSchema.parse(makeRecipe({ coverPhotoUrl: 'https://cdn.commise.app/recipes/o/r/photos/x.jpg' }))
                .coverPhotoUrl,
        ).toContain('https://');
        const bare = recipeSchema.parse(makeRecipe());
        expect(bare.difficulty).toBeUndefined();
        expect(bare.coverPhotoUrl).toBeUndefined();
    });

    it('requires usesPremiumCapability and ratingCount (they are never optional on the wire)', () => {
        const withoutPremium = { ...makeRecipe() } as Record<string, unknown>;
        delete withoutPremium['usesPremiumCapability'];
        expect(recipeSchema.safeParse(withoutPremium).success).toBe(false);

        const withoutCount = { ...makeRecipe() } as Record<string, unknown>;
        delete withoutCount['ratingCount'];
        expect(recipeSchema.safeParse(withoutCount).success).toBe(false);
    });

    /**
     * REWRITTEN, not deleted, and it now proves the OPPOSITE of what it used to.
     *
     * The two tests here were "accepts the denormalized `leadCaloriesPerServing` (W8-a.1)" and "rejects a
     * negative one". Both described a field that has left the wire (ADR-0021's "Follow-up owed"): the
     * `recipes.lead_calories_per_serving` column it denormalized was dropped by migration 0019, and the
     * only surface still emitting it — the DETAIL read — was emitting `nutrition.calories` a second time
     * under a second name. Keeping the field would have left two representations of one number with no rule
     * for which wins.
     *
     * Where the coverage went: the per-serving figure's arithmetic is `computeRecipeNutrition`
     * (`nutrition.test.ts`); the never-a-misleading-`0` rule those tests guarded is now the
     * `known` / `unaccounted` split in the recipe service's `toRecipeNutritionState`
     * (`src/recipes/domain/__tests__/nutritionState.test.ts` + `recipeNutritionState.test.ts`), which is
     * strictly stronger — it distinguishes a MEASURED zero from an unaccounted recipe, which an optional
     * `number | undefined` structurally could not.
     */
    it('⛔ carries NO leadCaloriesPerServing — one number, one representation', () => {
        // Zod strips unknown keys, so a stale producer's field is dropped rather than passed through.
        const parsed = recipeSchema.parse({ ...makeRecipe(), leadCaloriesPerServing: 320 });

        expect(parsed).not.toHaveProperty('leadCaloriesPerServing');
        // And the calorie figure is not silently renamed either — no recipe-level calorie key survives.
        expect(Object.keys(parsed).filter((key) => key.toLowerCase().includes('calor'))).toStrictEqual([]);
    });

    it('accepts the denormalized authorHandle (W8-a.2) and tolerates its absence', () => {
        expect(recipeSchema.parse(makeRecipe({ authorHandle: 'Ada Lovelace' })).authorHandle).toBe('Ada Lovelace');
        expect(recipeSchema.parse(makeRecipe()).authorHandle).toBeUndefined();
    });

    it('requires a valid status (W8-a.3) — draft|published only, never absent', () => {
        expect(recipeSchema.parse(makeRecipe({ status: RecipeStatus.DRAFT })).status).toBe('draft');
        expect(recipeSchema.parse(makeRecipe({ status: RecipeStatus.PUBLISHED })).status).toBe('published');
        // status is NOT optional — a recipe always has one (the projection maps a NOT NULL column).
        const withoutStatus = { ...makeRecipe() } as Record<string, unknown>;
        delete withoutStatus['status'];
        expect(recipeSchema.safeParse(withoutStatus).success).toBe(false);
        expect(recipeStatusSchema.safeParse('archived').success).toBe(false);
    });
});

/**
 * REWRITTEN for the 2026-08-26 owner ruling that deleted device attribution. Two cases here used to pin
 * `deviceLabel`'s acceptance and its 80-char bound; the field is gone from `RecipeVersion`, so what is
 * asserted instead is that the response schema DROPS it — `recipeVersionSchema` is a non-strict
 * `z.object`, so a stale server still emitting the key must not smuggle it back onto the parsed value.
 */
describe('recipeVersionSchema — editor attribution (W8-a.2)', () => {
    /** A minimal, schema-valid `RecipeVersion` the cases layer overrides onto. */
    function makeVersion(overrides: Record<string, unknown> = {}): Record<string, unknown> {
        return {
            id: 'ver-1',
            recipeId: 'rec-1',
            versionNumber: 1,
            snapshot: {
                version: 1,
                title: 'Snapshot',
                description: '',
                steps: [],
                ingredients: [],
                servings: 1,
                prepTimeMinutes: 0,
                cookTimeMinutes: 0,
            },
            createdBy: '01JOWNER0000000000000000AA',
            createdAt: '2026-07-16T00:00:00.000Z',
            ...overrides,
        };
    }

    it('strips a deviceLabel a stale server still sends — the 2026-08-26 ruling removed it from the contract', () => {
        const parsed = recipeVersionSchema.parse(makeVersion({ deviceLabel: "Brandon's iPhone" }));

        expect(parsed).not.toHaveProperty('deviceLabel');
        // Asserted alongside, so the case cannot pass by the schema rejecting the whole object instead.
        expect(parsed.versionNumber).toBe(1);
    });

    it('accepts the denormalized editorHandle (W8-a.2) and tolerates its absence', () => {
        expect(recipeVersionSchema.parse(makeVersion({ editorHandle: 'Ada Lovelace' })).editorHandle).toBe(
            'Ada Lovelace',
        );
        expect(recipeVersionSchema.parse(makeVersion()).editorHandle).toBeUndefined();
    });
});

describe('recipeSearchSortBySchema (W8-a.9 — most-cloned + quickest added)', () => {
    it('exposes exactly the five supported search sorts', () => {
        expect(Object.values(RecipeSearchSortBy).sort()).toEqual(
            ['most-cloned', 'quickest', 'recent', 'relevance', 'title'].sort(),
        );
    });

    it('accepts every enum value and rejects an unknown sort', () => {
        for (const value of Object.values(RecipeSearchSortBy)) {
            expect(recipeSearchSortBySchema.parse(value)).toBe(value);
        }

        expect(recipeSearchSortBySchema.safeParse('popular').success).toBe(false);
    });
});

describe('RecipeRating + the stars Value Object', () => {
    it('validates a well-formed rating row', () => {
        const rating: RecipeRating = {
            id: 'rat-1',
            recipeId: 'rec-1',
            userId: '01JRATER00000000000000000A',
            stars: 5,
            createdAt: '2026-07-16T00:00:00.000Z',
            updatedAt: '2026-07-16T00:00:00.000Z',
        };
        expect(recipeRatingSchema.parse(rating).stars).toBe(5);
    });

    it('rejects a rating outside 1..5 or non-integer', () => {
        expect(recipeRatingSchema.safeParse({ id: 'r', recipeId: 'x', userId: 'u', stars: 0 }).success).toBe(false);
        expect(recipeRatingSchema.safeParse({ id: 'r', recipeId: 'x', userId: 'u', stars: 6 }).success).toBe(false);
        expect(recipeRatingSchema.safeParse({ id: 'r', recipeId: 'x', userId: 'u', stars: 3.5 }).success).toBe(false);
    });

    /**
     * ⚠️ THIS SUITE USED TO TEST THE PUT BODY, AND IT IS NOT THIS PACKAGE'S ANY MORE.
     *
     * `SetRecipeRatingInput` / `setRecipeRatingInputSchema` were a whole request ENVELOPE authored here — the one
     * thing `recipeRequestBounds.ts`'s header forbids — so they are gone (ADR-0014 / §15 rule 4). The envelope is
     * `setRatingRequestSchema` in the recipe service, which is now `z.strictObject` (GR-017 §17-c), and its
     * behaviour is asserted there (`src/ratings/__tests__/ratings.schema.test.ts`) — including that a spoofed
     * `userId` is REFUSED rather than stripped, which is the assertion this one used to make the other way.
     *
     * What stays here is the VALUE rule, which genuinely is the domain's and which both apps' inputs compose.
     */
    it('bounds a star rating to whole numbers 1..5, and that rule lives ONCE', () => {
        expect(recipeRatingStarsSchema.parse(4)).toBe(4);
        expect(recipeRatingStarsSchema.parse(1)).toBe(1);
        expect(recipeRatingStarsSchema.parse(5)).toBe(5);

        for (const invalid of [0, 6, 3.5, -1, '4', null]) {
            expect(recipeRatingStarsSchema.safeParse(invalid).success, String(invalid)).toBe(false);
        }
    });

    // The rating ROW's own bound must agree with it — they are the same rule seen from storage and from the wire,
    // and a divergence would let a row exist that no request could have created.
    it('agrees with the persisted row schema, so the two cannot drift', () => {
        for (const stars of [0, 6, 3.5]) {
            expect(recipeRatingStarsSchema.safeParse(stars).success).toBe(false);
            expect(recipeRatingSchema.safeParse({ id: 'r', recipeId: 'x', userId: 'u', stars }).success).toBe(false);
        }
    });
});

describe('RecipeErrorCode', () => {
    it('includes CANNOT_RATE_OWN_RECIPE', () => {
        expect(RecipeErrorCode.CANNOT_RATE_OWN_RECIPE).toBe('CANNOT_RATE_OWN_RECIPE');
    });
});
