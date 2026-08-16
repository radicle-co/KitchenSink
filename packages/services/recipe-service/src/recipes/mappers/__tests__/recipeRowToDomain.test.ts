/**
 * S-R4-test — unit tests for the canonical {@link recipeRowToDomain} Data Mapper: every field rule the
 * three former call sites (`collections.service#toRecipe`, `recipes.service#toRecipeResponse`,
 * `search.dal#rowToRecipe`) independently re-encoded before this collapse. Mutation lens: a wrong
 * coercion/omit/derivation in the mapper must fail one of these.
 */
import { describe, it, expect } from 'vitest';

import { recipeRowToDomain, type RecipeRowInput } from '../recipeRowToDomain.js';
import { makeRecipeRow } from '../../../__fixtures__/index.js';

/**
 * The nutrition figures the mapper no longer reads from the row (plan U10). This suite covers the ROW
 * mapping, so it passes the honest "not accounted on this path" value that list/search use.
 */
const DERIVED = { hasPartialNutrition: true } as const;

/** A fully-populated {@link RecipeRowInput} (via the Drizzle `RecipeRow` fixture) with overrides. */
function row(overrides: Partial<RecipeRowInput> = {}): RecipeRowInput {
    return { ...makeRecipeRow(), ...overrides };
}

describe('recipeRowToDomain', () => {
    it('maps the required scalar fields straight through', () => {
        const recipe = recipeRowToDomain(
            row({ id: 'r-1', ownerId: 'owner-1', title: 'Pasta', servings: 4, currentVersion: 3, ratingCount: 7 }),
            DERIVED,
        );

        expect(recipe).toMatchObject({
            id: 'r-1',
            ownerId: 'owner-1',
            title: 'Pasta',
            servings: 4,
            currentVersion: 3,
            ratingCount: 7,
        });
    });

    it("defaults description to '' when NULL (Recipe.description is required)", () => {
        expect(recipeRowToDomain(row({ description: null }), DERIVED).description).toBe('');
    });

    it('passes a stated description through unchanged', () => {
        expect(recipeRowToDomain(row({ description: 'Tasty' }), DERIVED).description).toBe('Tasty');
    });

    it('defaults prepTimeMinutes/cookTimeMinutes/totalTimeMinutes to 0 when NULL', () => {
        const recipe = recipeRowToDomain(
            row({ prepTimeMinutes: null, cookTimeMinutes: null, totalTimeMinutes: null }),
            DERIVED,
        );

        expect(recipe.prepTimeMinutes).toBe(0);
        expect(recipe.cookTimeMinutes).toBe(0);
        expect(recipe.totalTimeMinutes).toBe(0);
    });

    it('passes stated time values through unchanged', () => {
        const recipe = recipeRowToDomain(
            row({ prepTimeMinutes: 10, cookTimeMinutes: 20, totalTimeMinutes: 30 }),
            DERIVED,
        );

        expect(recipe.prepTimeMinutes).toBe(10);
        expect(recipe.cookTimeMinutes).toBe(20);
        expect(recipe.totalTimeMinutes).toBe(30);
    });

    it('maps difficulty when stated and OMITS it (not null) when unstated', () => {
        expect(recipeRowToDomain(row({ difficulty: 'hard' }), DERIVED).difficulty).toBe('hard');
        expect(recipeRowToDomain(row({ difficulty: null }), DERIVED)).not.toHaveProperty('difficulty');
    });

    it('coerces the trigger-maintained averageRating (numeric string) to a number when rated', () => {
        expect(recipeRowToDomain(row({ averageRating: '4.50', ratingCount: 12 }), DERIVED).averageRating).toBe(4.5);
    });

    it('OMITS averageRating (never 0) when unrated', () => {
        expect(recipeRowToDomain(row({ averageRating: null, ratingCount: 0 }), DERIVED)).not.toHaveProperty(
            'averageRating',
        );
    });

    it('takes leadCaloriesPerServing from the DERIVED figure, not from a stored column (U10)', () => {
        expect(
            recipeRowToDomain(row(), { hasPartialNutrition: false, leadCaloriesPerServing: 350.5 })
                .leadCaloriesPerServing,
        ).toBe(350.5);
    });

    it('OMITS leadCaloriesPerServing (never 0) when the caller computed none', () => {
        // Absent, not zero — a `0` reads as a genuine zero-calorie recipe rather than "not accounted".
        expect(recipeRowToDomain(row(), DERIVED)).not.toHaveProperty('leadCaloriesPerServing');
    });

    it('reports hasPartialNutrition from the DERIVED verdict, so no path can assert completeness by omission', () => {
        expect(recipeRowToDomain(row(), { hasPartialNutrition: false }).hasPartialNutrition).toBe(false);
        expect(recipeRowToDomain(row(), DERIVED).hasPartialNutrition).toBe(true);
    });

    it('maps authorHandle when present and OMITS it when NULL', () => {
        expect(recipeRowToDomain(row({ authorHandle: '@chef' }), DERIVED).authorHandle).toBe('@chef');
        expect(recipeRowToDomain(row({ authorHandle: null }), DERIVED)).not.toHaveProperty('authorHandle');
    });

    it('OMITS sourceUrl / sourceAttribution / clonedFromId / cuisine when NULL', () => {
        const recipe = recipeRowToDomain(
            row({ sourceUrl: null, sourceAttribution: null, clonedFromId: null, cuisine: null }),
            DERIVED,
        );

        expect(recipe).not.toHaveProperty('sourceUrl');
        expect(recipe).not.toHaveProperty('sourceAttribution');
        expect(recipe).not.toHaveProperty('clonedFromId');
        expect(recipe).not.toHaveProperty('cuisine');
    });

    it('includes sourceUrl / sourceAttribution / clonedFromId / cuisine when present', () => {
        const recipe = recipeRowToDomain(
            row({
                sourceUrl: 'https://example.com/r',
                sourceAttribution: 'Some Chef',
                clonedFromId: 'src-1',
                cuisine: 'italian',
            }),
            DERIVED,
        );

        expect(recipe.sourceUrl).toBe('https://example.com/r');
        expect(recipe.sourceAttribution).toBe('Some Chef');
        expect(recipe.clonedFromId).toBe('src-1');
        expect(recipe.cuisine).toBe('italian');
    });

    it('derives usesPremiumCapability from visibility + sourceType via the ONE recipe-core rule', () => {
        // Chosen-private → PRO.
        expect(
            recipeRowToDomain(row({ visibility: 'private', sourceType: 'user_created' }), DERIVED)
                .usesPremiumCapability,
        ).toBe(true);
        // Forced-private import → NOT PRO (the `visibility === 'private'` trap must not be re-derived here).
        expect(
            recipeRowToDomain(row({ visibility: 'private', sourceType: 'imported_physical' }), DERIVED)
                .usesPremiumCapability,
        ).toBe(false);
        // Public → never PRO.
        expect(
            recipeRowToDomain(row({ visibility: 'public', sourceType: 'user_created' }), DERIVED).usesPremiumCapability,
        ).toBe(false);
    });

    it('normalizes a Date createdAt/updatedAt to an ISO-8601 string', () => {
        const recipe = recipeRowToDomain(
            row({ createdAt: new Date('2026-07-01T12:00:00.000Z'), updatedAt: new Date('2026-07-02T00:00:00.000Z') }),
            DERIVED,
        );

        expect(recipe.createdAt).toBe('2026-07-01T12:00:00.000Z');
        expect(recipe.updatedAt).toBe('2026-07-02T00:00:00.000Z');
    });

    it('normalizes a string createdAt (raw-row adapter input) to an ISO-8601 string', () => {
        const recipe = recipeRowToDomain(row({ createdAt: '2026-07-01T00:00:00.000Z' }), DERIVED);

        expect(recipe.createdAt).toBe('2026-07-01T00:00:00.000Z');
    });

    it('OMITS deletedAt (never null) when the recipe is active', () => {
        expect(recipeRowToDomain(row({ deletedAt: null }), DERIVED)).not.toHaveProperty('deletedAt');
    });

    it('maps deletedAt to an ISO string when tombstoned (Date or string input)', () => {
        expect(recipeRowToDomain(row({ deletedAt: new Date('2026-06-01T00:00:00.000Z') }), DERIVED).deletedAt).toBe(
            '2026-06-01T00:00:00.000Z',
        );
        expect(recipeRowToDomain(row({ deletedAt: '2026-06-02T00:00:00.000Z' }), DERIVED).deletedAt).toBe(
            '2026-06-02T00:00:00.000Z',
        );
    });

    it('passes dietaryFlags / tags arrays through unchanged', () => {
        const recipe = recipeRowToDomain(row({ dietaryFlags: ['vegan'], tags: ['dinner', 'quick'] }), DERIVED);

        expect(recipe.dietaryFlags).toEqual(['vegan']);
        expect(recipe.tags).toEqual(['dinner', 'quick']);
    });

    it('passes hasSubstantiveEdit / hasPartialNutrition / status / sourceType / visibility straight through', () => {
        const recipe = recipeRowToDomain(
            row({
                hasSubstantiveEdit: true,
                status: 'draft',
                sourceType: 'imported_paid',
                visibility: 'private',
            }),
            DERIVED,
        );

        expect(recipe.hasSubstantiveEdit).toBe(true);
        expect(recipe.hasPartialNutrition).toBe(true);
        expect(recipe.status).toBe('draft');
        expect(recipe.sourceType).toBe('imported_paid');
        expect(recipe.visibility).toBe('private');
    });

    it('never emits a coverPhotoUrl (resolved by the caller, not this mapper)', () => {
        expect(recipeRowToDomain(row(), DERIVED)).not.toHaveProperty('coverPhotoUrl');
    });
});
