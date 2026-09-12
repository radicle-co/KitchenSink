/**
 * @module @commise/features-recipes/__fixtures__ — typed `make*` factories for the recipe feature's
 * tests. `makeRecipe`/`makeRecipeDetail` are the shared, invariant-deriving Object Mother from
 * `@kitchensink/recipe-core/testing` (T1) — re-exported here so consuming tests keep importing from this
 * local module. The feature-specific factories below (card/form view-models) stay local to this package
 * so its tests never depend on a service/client package's fixtures.
 */
import { makeRecipe, makeRecipeDetail } from '@kitchensink/recipe-core/testing';
import {
    RecipeCollectionAddedVia,
    RecipeVisibility,
    type RecipeIngredientView,
    type RecipeDetailNutrition,
    type RecipePhoto,
    type RecipeStepView,
} from '@kitchensink/recipe-core';

import { toRecipeCardModel } from '../card/model.js';
import type { CollectionMemberRecipe } from '../collections/model.js';
import { seedLineKey } from '../form/lineKey.js';
import type { LookupRetry } from '../form/ingredientStatus.js';
import type { IngredientNutrition } from '../form/nutritionLookup.js';
import { defaultRecipeFormValues, type RecipeFormIngredient, type RecipeFormValues } from '../form/values.js';
import type { RecipePhotoQueueItem } from '../hooks/useRecipePhotoUploadQueue.js';
import type { RecipeListItem } from '../list/model.js';
import type { RetryControl } from '../refresh/model.js';

export { makeRecipe, makeRecipeDetail };

/**
 * Build a {@link RecipeListItem} card view-model with sensible defaults, overridable per field. Since the
 * list item is now the SHARED card model, this is simply the card projection of {@link makeRecipe} with the
 * overrides applied — so it inherits the same invariant-safe defaults (rated PRO recipe with a stated
 * difficulty and a cover) and its `Partial` overrides accept every card field.
 *
 * @param overrides - Fields to override on the default item.
 * @returns A complete `RecipeListItem`.
 */
export function makeRecipeListItem(overrides: Partial<RecipeListItem> = {}): RecipeListItem {
    return { ...toRecipeCardModel(makeRecipe()), ...overrides };
}

/**
 * Build a {@link CollectionMemberRecipe} (a {@link makeRecipe} recipe plus its collection-membership
 * provenance, W5 Task 9 / C3) with sensible defaults, overridable per field. Defaults to `manual` (the
 * owner-added/protected source-indicator state) — pass `{ addedVia: RecipeCollectionAddedVia.CLONE_SEED }`
 * or `.PULL` for the from-source/will-sync state.
 *
 * @param overrides - Fields to override on the default member recipe.
 * @returns A complete `CollectionMemberRecipe`.
 */
export function makeCollectionMemberRecipe(overrides: Partial<CollectionMemberRecipe> = {}): CollectionMemberRecipe {
    return { ...makeRecipe(), addedVia: RecipeCollectionAddedVia.MANUAL, ...overrides };
}

/**
 * Build a {@link RecipeIngredientView} with sensible defaults, overridable per field.
 *
 * @param overrides - Fields to override on the default ingredient view.
 * @returns A complete `RecipeIngredientView`.
 */
export function makeIngredientView(overrides: Partial<RecipeIngredientView> = {}): RecipeIngredientView {
    return {
        ingredientId: '00000000-0000-4000-8000-000000000001',
        name: 'Olive oil',
        quantity: { kind: 'exact', value: 2 },
        unit: 'tbsp',
        isUserEntered: false,
        ...overrides,
    };
}

/**
 * Build a {@link RecipeStepView} with sensible defaults, overridable per field.
 *
 * @param overrides - Fields to override on the default step view.
 * @returns A complete `RecipeStepView`.
 */
export function makeStepView(overrides: Partial<RecipeStepView> = {}): RecipeStepView {
    return {
        stepNumber: 1,
        instruction: 'Combine the ingredients.',
        ...overrides,
    };
}

/**
 * Build the {@link RecipeDetailNutrition} a detail read serves, with sensible defaults, overridable per field.
 * Defaults to `freshness: 'fresh'` — the ordinary read, where food answered.
 *
 * @param overrides - Fields to override on the default nutrition.
 * @returns A complete `RecipeDetailNutrition`.
 */
export function makeNutrition(overrides: Partial<RecipeDetailNutrition> = {}): RecipeDetailNutrition {
    return {
        calories: 520,
        proteinG: 32,
        carbsG: 18,
        fatG: 34,
        isComplete: true,
        freshness: 'fresh',
        ...overrides,
    };
}

/**
 * Build a {@link RecipePhoto} with sensible defaults, overridable per field.
 *
 * @param overrides - Fields to override on the default photo.
 * @returns A complete `RecipePhoto`.
 */
export function makePhoto(overrides: Partial<RecipePhoto> = {}): RecipePhoto {
    return {
        id: 'pho_1',
        recipeId: 'rec_1',
        key: 'recipes/rec_1/pho_1.jpg',
        url: 'https://cdn.commise.app/recipes/rec_1/pho_1.jpg',
        contentType: 'image/jpeg',
        order: 1,
        createdAt: '2026-04-19T09:30:00.000Z',
        ...overrides,
    };
}

/**
 * Build a {@link RecipePhotoQueueItem} with sensible defaults, overridable per field (w3/e4 photo grid).
 *
 * @param overrides - Fields to override on the default queue item.
 * @returns A complete `RecipePhotoQueueItem`.
 */
export function makeQueueItem(overrides: Partial<RecipePhotoQueueItem> = {}): RecipePhotoQueueItem {
    return {
        fileId: 1,
        fileName: 'dinner.png',
        status: 'queued',
        // Matches the hook: nothing is retryable until a TRANSPORT attempt has actually failed. A test that
        // wants the Retry affordance must say so (`retryable: true`) — the default never hands it out.
        retryable: false,
        ...overrides,
    };
}

/**
 * Build an editable {@link RecipeFormValues} draft with sensible defaults, overridable per field. Mirrors
 * the shape `defaultRecipeFormValues` produces (title/times/servings/visibility plus one resolved ingredient
 * and one step), so conflict-merge and form tests exercise a submittable draft, not an empty one.
 *
 * @param overrides - Fields to override on the default draft.
 * @returns A complete `RecipeFormValues`.
 */
export function makeRecipeFormValues(overrides: Partial<RecipeFormValues> = {}): RecipeFormValues {
    return {
        title: 'Weeknight Pasta',
        description: 'A fast, comforting weeknight dinner.',
        cuisine: 'Italian',
        tags: ['dinner'],
        dietaryFlags: ['vegetarian'],
        servings: 4,
        prepTimeMinutes: 10,
        cookTimeMinutes: 20,
        visibility: RecipeVisibility.PRIVATE,
        ingredients: [
            {
                key: seedLineKey(1, 0),
                isUserEntered: false,
                ingredientId: '00000000-0000-4000-8000-000000000001',
                name: 'Olive oil',
                quantity: 2,
                unit: 'tbsp',
            },
        ],
        steps: [{ instruction: 'Combine the ingredients.' }],
        // No pending photo picks by default (U33): the common draft is one that has nothing waiting to
        // upload, and a test that wants the flush path must say so explicitly.
        photos: [],
        ...overrides,
    };
}

/**
 * A MINIMALLY VALID draft — `defaultRecipeFormValues()` plus exactly the fields `validateRecipeForm`
 * requires, and nothing more.
 *
 * ⚠️ Distinct from {@link makeRecipeFormValues} on purpose, and NOT interchangeable with it: this one builds
 * on the real defaults (so it inherits `visibility`) and states a different title, ingredient and step.
 * Suites assert those literals, so collapsing the two would mean editing assertions to make a fixture fit —
 * which is the one thing a refactor may not do. It was declared inside `form/__tests__/model.test.ts` until
 * that suite was split into one file per module; five of the nine share it, so it lives here rather than in
 * five copies.
 *
 * @param over - Fields to override on the minimally valid draft.
 * @returns A complete `RecipeFormValues` that passes validation.
 */
export const makeFilledRecipeFormValues = (over: Partial<RecipeFormValues> = {}): RecipeFormValues => ({
    ...defaultRecipeFormValues(),
    title: 'Herb Risotto',
    servings: 4,
    prepTimeMinutes: 10,
    cookTimeMinutes: 25,
    ingredients: [
        {
            key: seedLineKey(1, 0),
            isUserEntered: false,
            ingredientId: '00000000-0000-4000-8000-000000000001',
            name: 'Arborio rice',
            quantity: 300,
            unit: 'g',
        },
    ],
    steps: [{ instruction: 'Toast the rice.' }],
    ...over,
});

/**
 * A retry for the recipe detail's notice about lines food could not name, that does nothing and has recovered
 * nothing — for a test about something else. A test about that notice builds its own.
 */
export const idleUnreachableRetry: RetryControl = { refreshing: false, recoveries: 0, onRetry: () => undefined };

/** A draft ingredient line as a test states it: everything except the identity the draft gives it. */
export type UnkeyedFormIngredient = Omit<RecipeFormIngredient, 'key'>;

/**
 * Give each line the key a seed of version 1 would give it (plan 002 V1). Keys are distinct within the list, and
 * deterministic, so two calls over the same list compare equal.
 *
 * @param lines - The lines, in draft order.
 * @returns The same lines, keyed.
 */
export const withLineKeys = (lines: readonly UnkeyedFormIngredient[]): RecipeFormIngredient[] =>
    lines.map((line, index) => ({ ...line, key: seedLineKey(1, index) }));

/**
 * Give one line the key a seed of version 1 would give it at `index`.
 *
 * @param line - The line.
 * @param index - Its position, when a test builds a list one line at a time.
 * @returns The line, keyed.
 */
export const withLineKey = (line: UnkeyedFormIngredient, index = 0): RecipeFormIngredient => ({
    ...line,
    key: seedLineKey(1, index),
});

/**
 * The editor's nutrition as a leaf receives it (plan 002 V1 B5). Defaults to a READY read that answered nothing
 * readable for any ref, so a test that does not care about nutrition sees no loading state and no figures.
 *
 * @param over - Fields to override (`lookup`, `read`, `retry`).
 * @returns The editor's nutrition.
 */
export const makeIngredientNutrition = (over: Partial<IngredientNutrition> = {}): IngredientNutrition => ({
    lookup: () => ({ state: 'absent' }),
    read: 'ready',
    retry: () => undefined,
    ...over,
});

/**
 * A FAILED row's Try again as a leaf receives it: nothing in flight, and a retry that does nothing.
 *
 * @param over - Fields to override (`retry`, `retrying`).
 * @returns The Try again command.
 */
export const makeLookupRetry = (over: Partial<LookupRetry> = {}): LookupRetry => ({
    retry: () => undefined,
    retrying: new Set(),
    settled: undefined,
    ...over,
});
