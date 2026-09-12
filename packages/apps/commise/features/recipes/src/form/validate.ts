/**
 * @module @commise/features-recipes/form — the draft's SUBMITTABILITY rules, and the error vocabulary they speak.
 *
 * ⛔ It returns CODES, never copy, so this module stays pure and locale-free — the leaf owns the wording.
 * The field validators ARE the published wire schemas, imported from `recipe-core` by reference identity
 * rather than copied or reached into via `.shape`; that is what makes "the editor and the server cannot
 * drift" a fact rather than an intention.
 *
 * Pure and platform-agnostic: shared unchanged by the web (`*.tsx`) and native (`*.native.tsx`) form
 * leaves and by the app container, so the two renders can never drift. No React, no platform APIs.
 */
import { recipeStepInstructionSchema, recipeTitleSchema } from '@kitchensink/recipe-core';
import { type RecipeFormValues } from './values.js';
import { draftQuantityVerdict } from './quantity.js';

/**
 * A validation-error CODE (not user copy) — the discriminant a leaf resolves to localized text via
 * `recipeFormMessages.errors` (B20). Returning codes keeps `validateRecipeForm` pure and locale-free; the
 * form components own the copy, mirroring the rating model's discriminant pattern.
 */
export type RecipeFormErrorCode =
    | 'titleRequired'
    | 'ingredientsEmpty'
    | 'ingredientsUnresolved'
    | 'ingredientsQuantityInvalid'
    | 'stepsRequired'
    | 'servingsPositive'
    | 'timesNonNegative';

/** Field-level validation errors (an error CODE per invalid field; absent when valid). */
export interface RecipeFormErrors {
    title?: RecipeFormErrorCode;
    ingredients?: RecipeFormErrorCode;
    steps?: RecipeFormErrorCode;
    servings?: RecipeFormErrorCode;
    times?: RecipeFormErrorCode;
}

// Field-level validators COMPOSED from `@kitchensink/recipe-core`'s bound Value Objects (parse-don't-validate,
// DA5) — the single authoritative source for the rules the form and the create contract genuinely SHARE, so
// the form can never hand-restate (and drift from) what the wire already encodes:
//   - `recipeTitleSchema`: a non-empty, ≤200-character title.
//   - `recipeStepInstructionSchema`: a non-empty step instruction.
//   - `ingredientQuantitySchema` (via `draftQuantityVerdict`): the wire's `exact | range | absent`
//     union, which applies the 0.001 .. 1 000 000 storage window to EVERY numeric member. U9 moved the
//     quantity rule from the bare scalar to the union for exactly that reason — the scalar could not see an
//     upper bound at all.
//
// ⚠️ THESE ARE THE SAME OBJECTS THE SERVER VALIDATES WITH — not copies, and not the same rule written twice.
// Per the owner's ruling the recipe bounds live in `recipe-core`, and `recipe-service`'s
// `recipes.schema.ts` composes these very exports into `CreateRecipeRequest` (asserted by reference identity
// in that service's `recipes.schema.test.ts`). So the editor inherits a server-side bound change with no
// second edit here, in EITHER direction — which is the whole point of moving them, and is what makes the
// "stricter, never looser" invariant below checkable rather than aspirational.
//
// Importing them from `recipe-core` rather than reaching into `@kitchensink/schema-recipe`'s `.shape` is also
// what stops a wire-envelope reshape (renaming a field, making one optional) from silently breaking a
// field-level rule the form depends on: a named Value Object survives that, `shape.title` does not.
const titleSchema = recipeTitleSchema;

const instructionSchema = recipeStepInstructionSchema;

/**
 * Whether an ingredient line has been RESOLVED to a catalog row.
 *
 * ⚠️ Deliberately NOT `recipeIngredientInputSchema.shape.ingredientId`, even though the wire field is a
 * `z.uuid()` and composing it would look more DRY. The two are different questions, and merging them makes the
 * editor lie: the form's `ingredientsUnresolved` code means "you have not picked this ingredient yet", which is
 * the `null` sentinel (`RecipeFormIngredient.ingredientId: string | null`) — a malformed-but-present id is a
 * different failure that deserves different copy, and reporting it as "unresolved" would send the user back to
 * a picker that is already showing a selection. The FORMAT rule is the wire's, is enforced server-side, and is
 * unreachable from this surface anyway: every id here comes from the catalog API, which returns real UUIDs.
 *
 * ⚠️ EXPORTED since U28, because it is now read in two places that must not disagree.
 * {@link validateRecipeForm} decides whether the wizard may advance; `unresolvedLineNote` (`props.ts`)
 * tells a cook WHICH row is incomplete and what to do about it. A leaf marking a different set of rows
 * from the set blocking the wizard is exactly the drift one shared predicate prevents.
 *
 * @param ingredientId - The line's raw id, or `null` while unresolved.
 * @returns True when the line references a catalog row. Pure.
 */
export const isResolvedIngredientId = (ingredientId: string | null): boolean =>
    ingredientId !== null && ingredientId.length > 0;

/**
 * Validate the form for submission: title present, ≥1 ingredient with EVERY line resolved to a catalog id
 * and a COHERENT quantity, ≥1 step with a non-empty instruction, positive servings, non-negative times.
 * Pure and locale-free — returns error CODES (the leaf resolves copy). Empty object when submittable.
 *
 * ⛔ "Coherent" is NOT "positive", and the difference is the point of U9. A line that states no amount at
 * all is valid (R40 — "butter the size of an egg" states none), while `0`, a negative, an upper bound below
 * its lower, and an upper bound with no lower are all refused. {@link draftQuantityVerdict} owns that
 * judgement; this validator only decides which field the failure belongs to.
 *
 * COMPOSES the published `createRecipeRequestSchema`'s field bounds (DA5, parse-don't-validate) for the
 * rules it and the form
 * genuinely share — title, ingredient id/quantity, step instruction — via the field schemas above, each
 * `.safeParse`d against the (trimmed, for strings) form value and mapped to the SAME `RecipeFormErrorCode`s
 * this validator has always returned. Two kinds of rule stay hand-written rather than schema-derived:
 *   - `ingredientsEmpty` / the empty-`steps`-array half of `stepsRequired` state the same rule the wire now
 *     carries (`ingredients`/`steps` are `min(1)` on the request), kept as explicit comparisons so the form can
 *     attribute the failure to a FIELD and return its own error code rather than a parse failure of the whole
 *     body. Line-level resolution is {@link isResolvedIngredientId}, which is the form's own question.
 *   - `servingsPositive` / `timesNonNegative` are deliberately NOT parsed through the wire's
 *     `servings`/`prepTimeMinutes`/`cookTimeMinutes` fields, which additionally require an INTEGER
 *     (`positiveIntSchema`/`nonNegativeIntSchema`). The form has never enforced integer-ness (its numeric
 *     inputs parse via `parseNumericInput`, which accepts fractional text), so composing those fields would
 *     newly reject a fractional-but-positive value — a validation-behavior drift the DA5 acceptance bar
 *     (identical codes for every case) forbids. Only the genuinely shared "positive"/"non-negative" rule is
 *     kept, as an explicit comparison.
 *
 * @param values - The editor's form values.
 * @returns The {@link RecipeFormErrors} (empty object when the form is submittable).
 */
export const validateRecipeForm = (values: RecipeFormValues): RecipeFormErrors => {
    const errors: RecipeFormErrors = {};

    if (!titleSchema.safeParse(values.title.trim()).success) {
        errors.title = 'titleRequired';
    }

    if (values.ingredients.length === 0) {
        // Caught HERE so the user gets a field-level message instead of a 400: `createRecipeRequestSchema`
        // also rejects an empty `ingredients` array (`.min(1)`), so this is the same rule stated where it can
        // be shown, not a form-only extra. (It said "the wire schema allows an empty array" until the
        // published contract gained the bound; keeping that claim would have invited deleting the check.)
        errors.ingredients = 'ingredientsEmpty';
    } else if (values.ingredients.some((line) => !isResolvedIngredientId(line.ingredientId))) {
        errors.ingredients = 'ingredientsUnresolved';
    } else if (values.ingredients.some((line) => draftQuantityVerdict(line) === 'invalid')) {
        // SPLIT FROM `ingredientsUnresolved` BY U9, not merely renamed. The two failures were reported under
        // one code and one sentence ("...a resolved item AND a quantity greater than zero"), and that
        // sentence stopped being true the moment an absent quantity became legal (R40) — a line stating no
        // amount is now valid, while a half-typed range is not. One field carries one code, so resolution is
        // reported FIRST: a line with no catalog id cannot be submitted whatever its quantity says, and
        // sending the user to a quantity field would be sending them to the wrong control.
        errors.ingredients = 'ingredientsQuantityInvalid';
    }

    if (
        // Same as `ingredients` above: `createRecipeRequestSchema.steps` carries `.min(1)`, so this surfaces
        // the contract's own bound as a field message rather than adding a form-only rule.
        values.steps.length === 0 ||
        values.steps.some((step) => !instructionSchema.safeParse(step.instruction.trim()).success)
    ) {
        errors.steps = 'stepsRequired';
    }

    if (values.servings <= 0) {
        errors.servings = 'servingsPositive';
    }

    if (values.prepTimeMinutes < 0 || values.cookTimeMinutes < 0) {
        errors.times = 'timesNonNegative';
    }

    return errors;
};
