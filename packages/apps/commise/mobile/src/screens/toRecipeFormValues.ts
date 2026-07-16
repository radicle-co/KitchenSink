/**
 * Pure projection from a loaded {@link RecipeDetail} into the editor's {@link RecipeFormValues} (mobile edit
 * flow, T067). The recipe-service returns a rich read model; the shared `RecipeForm` building block edits the
 * leaner form shape, so the edit screen maps one to the other before seeding form state. Kept pure and
 * co-located with the screens that consume it (no `helpers/` bucket, per the coding standards).
 *
 * Existing ingredient lines already carry a catalog `ingredientId`, so each is marked `RESOLVED` — the form's
 * validation treats an unresolved line as un-submittable, and a saved recipe's lines are, by definition,
 * resolved. Optional fields (`unit`, `notes`, `timerSeconds`) are OMITTED rather than set to `undefined` so
 * the result satisfies `exactOptionalPropertyTypes`.
 */
import type { RecipeFormValues } from '@commise/features-recipes';
import type { RecipeDetail } from '@kitchensink/recipe-core';

/**
 * Map a loaded recipe detail to the create/edit form's value shape.
 *
 * @param detail - The recipe detail returned by `useRecipe`.
 * @returns The seed {@link RecipeFormValues} for the editor.
 */
export const toRecipeFormValues = (detail: RecipeDetail): RecipeFormValues => ({
    title: detail.title,
    description: detail.description,
    cuisine: detail.cuisine ?? '',
    // Seed the current difficulty so the edit form shows it; absence stays "not stated" (FR-001b).
    ...(detail.difficulty === undefined ? {} : { difficulty: detail.difficulty }),
    tags: [...detail.tags],
    dietaryFlags: [...detail.dietaryFlags],
    servings: detail.servings,
    prepTimeMinutes: detail.prepTimeMinutes,
    cookTimeMinutes: detail.cookTimeMinutes,
    visibility: detail.visibility,
    ingredients: detail.ingredients.map((line) => ({
        ingredientId: line.ingredientId,
        name: line.name,
        quantity: line.quantity,
        resolutionStatus: 'RESOLVED',
        ...(line.unit === undefined ? {} : { unit: line.unit }),
        ...(line.notes === undefined ? {} : { notes: line.notes }),
    })),
    steps: detail.steps.map((step) => ({
        instruction: step.instruction,
        ...(step.timerSeconds === undefined ? {} : { timerSeconds: step.timerSeconds }),
    })),
});
