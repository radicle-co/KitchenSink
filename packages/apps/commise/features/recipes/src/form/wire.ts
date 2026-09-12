/**
 * @module @commise/features-recipes/form — mapping the draft to and from the recipe service's PUBLISHED request contract.
 *
 * ⚠️ THE MAPPERS TARGET `@kitchensink/schema-recipe`, NOT A LOCAL TWIN (§15 rule 4 / ADR-0014). They used to
 * be annotated with `recipe-core`'s `CreateRecipeInput` / `UpdateRecipeInput` — hand-written interfaces that
 * mirrored `createRecipeRequestSchema` / `updateRecipeRequestSchema` field for field with nothing comparing
 * them, which is the silent-drift shape §15.1 measures. Now the editor's output type IS the request type the
 * service authors, so a backend field change fails this package's `typecheck` instead of an emulator run.
 *
 * The swap also surfaced a real defect it had been hiding: `toUpdateRecipeInput` shipped `visibility` on the
 * `PATCH` body, because it spreads the create projection. `UpdateRecipeRequest` has no such key — visibility
 * moves through `PATCH /api/v1/recipes/{id}/visibility`, where the C-004 policy evaluator gates it — and the
 * service silently STRIPPED it. A spread is exempt from excess-property checking, so annotating with the
 * published type would have compiled while still sending the field; it is dropped explicitly below instead.
 *
 * ⚠️ BOTH DIRECTIONS LIVE HERE ON PURPOSE. The `quantityHigh` round-trip and the U26/U27 omit-vs-`''` rule
 * are each stated on both sides and must agree; splitting the seed adapter out would put the two halves of
 * one invariant in two files.
 *
 * Pure and platform-agnostic: shared unchanged by the web (`*.tsx`) and native (`*.native.tsx`) form
 * leaves and by the app container, so the two renders can never drift. No React, no platform APIs.
 */
import { quantityLowerBound, type RecipeDetail, type RecipeStatus } from '@kitchensink/recipe-core';
import type { CreateRecipeRequest, UpdateRecipeRequest } from '@kitchensink/schema-recipe';
import { type RecipeFormIngredient, type RecipeFormValues } from './values.js';
import { computeTotalTime } from './totalTime.js';
import { draftQuantity } from './quantity.js';

/**
 * Map form values to the service's published `CreateRecipeRequest` body: computes total time, drops
 * unresolved ingredient lines (no `ingredientId`), omits empty optional strings, and carries a step timer
 * only when set. `status` (w3, draft/publish) is a SUBMISSION-time concern, not part of the form's own values
 * — it is threaded as a separate argument and OMITTED when not given, so the plain (non-wizard) save path
 * never touches publication state as a side effect. Pure. (Validate BEFORE submitting — this does not throw
 * on an incomplete form.)
 *
 * @param values - The editor's form values.
 * @param status - The publication status to persist (`draft`/`published`); omit to leave it untouched.
 * @returns The `POST /api/v1/recipes` body.
 */
export const toCreateRecipeInput = (values: RecipeFormValues, status?: RecipeStatus): CreateRecipeRequest => ({
    title: values.title.trim(),
    ...(values.description.trim() === '' ? {} : { description: values.description.trim() }),
    ...(values.cuisine.trim() === '' ? {} : { cuisine: values.cuisine.trim() }),
    // Difficulty is optional on create with NO clear sentinel: carry it only when stated, omit otherwise.
    ...(values.difficulty === undefined ? {} : { difficulty: values.difficulty }),
    // Meal type follows the SAME create rule, for the same reason: there is nothing to clear on a recipe
    // that does not exist yet, so an unstated meal type is a true omit and never an explicit `null`.
    ...(values.mealType === undefined ? {} : { mealType: values.mealType }),
    ingredients: values.ingredients
        .filter((line): line is RecipeFormIngredient & { ingredientId: string } => line.ingredientId !== null)
        .map((line) => ({
            ingredientId: line.ingredientId,
            name: line.name,
            quantity: draftQuantity(line),
            ...(line.unit === undefined || line.unit === '' ? {} : { unit: line.unit }),
            ...(line.notes === undefined || line.notes === '' ? {} : { notes: line.notes }),
            // U26/U27 — TRIMMED here, then omitted when nothing is left. The wire trims too
            // (`recipeIngredientGroupLabelSchema`), but a draft holding `'  '` would otherwise be SENT and
            // `400` the whole save over a field the cook thinks is empty. `''` is never sent: absence has
            // exactly one spelling on this wire, and it is the missing key.
            ...(line.preparation === undefined || line.preparation.trim() === ''
                ? {}
                : { preparation: line.preparation.trim() }),
            ...(line.groupLabel === undefined || line.groupLabel.trim() === ''
                ? {}
                : { groupLabel: line.groupLabel.trim() }),
        })),
    steps: values.steps.map((step) => ({
        instruction: step.instruction,
        ...(step.timerSeconds === undefined ? {} : { timerSeconds: step.timerSeconds }),
    })),
    servings: values.servings,
    prepTimeMinutes: values.prepTimeMinutes,
    cookTimeMinutes: values.cookTimeMinutes,
    totalTimeMinutes: computeTotalTime(values.prepTimeMinutes, values.cookTimeMinutes),
    dietaryFlags: [...values.dietaryFlags],
    tags: [...values.tags],
    visibility: values.visibility,
    ...(status === undefined ? {} : { status }),
});

/**
 * Map form values to the service's published `UpdateRecipeRequest` body, minus the `expectedVersion`
 * optimistic-concurrency token the caller adds. Identical to {@link toCreateRecipeInput} for every field
 * EXCEPT two, and both exceptions are the contract's, not this function's.
 *
 * `difficulty` is three-state on update (omit = unchanged, value = set, `null` = clear). The edit form is
 * seeded from the recipe's current difficulty, so the field's presence encodes the user's INTENT: a present
 * value means "set/keep this difficulty", and an ABSENT value means the user chose "not stated" and wants it
 * CLEARED. This maps absent → explicit `null` (not omit): omit would leave a previously set difficulty
 * unchanged, making "not stated" unreachable once set (FR-001b). Sending the current value again, or `null` on
 * an already-unstated recipe, is idempotent — consistent with the form's full-state replacement of every other
 * field on update.
 *
 * ⚠️ `visibility` IS DROPPED, and that is a fix rather than a restriction. `PATCH /api/v1/recipes/{id}` does
 * not accept it — `updateRecipeRequestSchema` omits the key, because visibility transitions go through
 * `PATCH /api/v1/recipes/{id}/visibility` where the C-004 policy evaluator decides whether the transition is
 * allowed at all. This function nevertheless SENT it for as long as it existed, inheriting it from the create
 * projection it spreads, and the service silently stripped it: a field the client believed it was setting and
 * the server discarded. Deleting it here means the body this produces is one the published contract describes.
 * Pure. (Validate BEFORE submitting.)
 *
 * @param values - The editor's form values.
 * @param status - The publication status to persist (`draft`/`published`); omit to leave it untouched.
 * @returns The `PATCH /api/v1/recipes/{id}` body, without `expectedVersion`.
 */
export const toUpdateRecipeInput = (
    values: RecipeFormValues,
    status?: RecipeStatus,
): Omit<UpdateRecipeRequest, 'expectedVersion'> => {
    // Destructured out, not `delete`d: the key must be ABSENT from the returned object, and a spread of the
    // create projection would otherwise reintroduce it past the type system's excess-property check.
    const { visibility: _visibility, ...rest } = toCreateRecipeInput(values, status);

    return {
        ...rest,
        // Present → set that value; absent → explicit null CLEAR (the crux: omit could never clear a set value).
        difficulty: values.difficulty ?? null,
        // Identical three-state rule for meal type (U34) — see `difficulty` directly above.
        mealType: values.mealType ?? null,
    };
};

/**
 * Project a loaded {@link RecipeDetail} onto the editor's {@link RecipeFormValues} seed shape (T067, unified
 * B2 — the ONE seed adapter both platforms and the `useRecipeEditor` headless hook use; a web-local and a
 * mobile-local copy of this exact mapping existed before this change and have been collapsed into this
 * single, package-level export). Persisted ingredient lines already reference a catalog id, so each carries
 * whatever resolution status the detail read published for it, defaulting to `RESOLVED` when it published
 * none — a saved recipe's lines are, by definition, resolved, and marking them explicitly (rather than
 * leaving `resolutionStatus` absent) lets the form's "Resolved" badge render for them exactly as it does for
 * a freshly-resolved line, instead of showing no badge at all. The inline note at that line records why it
 * is read from the detail rather than assumed. Optional fields (`unit`, `notes`, `timerSeconds`,
 * `difficulty`) are OMITTED rather than set to `undefined`, so the result stays valid under
 * the omit-never-undefined convention (`CODING_STANDARDS §6`). Pure.
 *
 * @param detail - The loaded recipe detail (from `useRecipe`).
 * @returns The seeded form values.
 */
export const toRecipeFormValues = (detail: RecipeDetail): RecipeFormValues => ({
    title: detail.title,
    description: detail.description,
    cuisine: detail.cuisine ?? '',
    // Seed the current difficulty so the edit form shows it; absence stays "not stated" (FR-001b).
    ...(detail.difficulty === undefined ? {} : { difficulty: detail.difficulty }),
    // Same for meal type (U34): seed what the recipe states, and leave the field ABSENT when it states none,
    // so the discard guard does not report a freshly-seeded form as edited and "not stated" stays reachable.
    ...(detail.mealType === undefined ? {} : { mealType: detail.mealType }),
    tags: [...detail.tags],
    dietaryFlags: [...detail.dietaryFlags],
    servings: detail.servings,
    prepTimeMinutes: detail.prepTimeMinutes,
    cookTimeMinutes: detail.cookTimeMinutes,
    visibility: detail.visibility,
    ingredients: detail.ingredients.map((line) => ({
        ingredientId: line.ingredientId,
        name: line.name,
        // ⚠️ BOTH bounds, always. `NaN` for an absent quantity is what an emptied numeric input holds, so
        // the draft says "no amount stated" rather than fabricating a `0` the source never gave (R40) —
        // and the high bound is carried because dropping it here is what would silently narrow `2–3 cups`
        // to `2 cups` on the next save. Both are now editable (U9), and `validateRecipeForm` accepts the
        // absent case, so a recipe seeded this way can be opened, changed and saved with its bound intact.
        quantity: quantityLowerBound(line.quantity) ?? Number.NaN,
        ...(line.quantity.kind === 'range' ? { quantityHigh: line.quantity.high } : {}),
        // ⛔ THE LINE'S OWN STATUS, falling back to `RESOLVED` (U14). This used to be hard-coded, on the
        // reasoning that "a saved recipe's lines are, by definition, resolved" — true while the status only
        // mirrored food-service's lifecycle, and FALSE the moment the detail read began publishing the
        // verification gate's verdict: a contradicted line would open in the editor badged "Resolved", the
        // opposite of what the recipe screen had just told the cook, on the one surface where they can
        // re-pick the food. The fallback keeps the original behaviour for a line the server said nothing
        // about: it still shows a badge rather than none.
        resolutionStatus: line.resolutionStatus ?? 'RESOLVED',
        ...(line.unit === undefined ? {} : { unit: line.unit }),
        ...(line.notes === undefined ? {} : { notes: line.notes }),
        // U26/U27 — OMITTED rather than seeded as `''`, so the draft distinguishes "this line states no
        // preparation" from "the cook cleared it", and so the round trip is byte-identical: a recipe opened
        // and saved unchanged must not acquire two keys it never had.
        ...(line.preparation === undefined ? {} : { preparation: line.preparation }),
        ...(line.groupLabel === undefined ? {} : { groupLabel: line.groupLabel }),
    })),
    steps: detail.steps.map((step) => ({
        instruction: step.instruction,
        ...(step.timerSeconds === undefined ? {} : { timerSeconds: step.timerSeconds }),
    })),
    // EMPTY, not `detail.photos` (U33). The draft's `photos` are PENDING PICKS — see `RecipeFormPhoto` — and
    // a loaded recipe has none by definition; its persisted gallery stays owned by `useRecipePhotos`. Seeding
    // them here would make the discard guard report a freshly-seeded, untouched edit form as dirty the moment
    // a photo's URL differed by a signature, and would hand the flush effect rows it must never re-upload.
    photos: [],
});
