/**
 * Unit tests for the recipe create/edit form model (T067) — the pure layer both platform form leaves and
 * the app container share: default values, auto total-time, mapping form values → the CreateRecipeInput
 * wire contract, and validation (title, ≥1 fully-resolved ingredient, ≥1 step, positive servings).
 */
import { describe, expect, it } from 'vitest';

import {
    computeRecipeNutrition,
    recipeDescriptionSchema,
    recipeIngredientQuantitySchema,
    recipeTitleSchema,
    RecipeDifficulty,
    RecipeStatus,
    RecipeVisibility,
    MAX_RECIPE_DESCRIPTION_LENGTH,
    MAX_RECIPE_TITLE_LENGTH,
    type RecipeDetail,
    type RecipeIngredientView,
} from '@kitchensink/recipe-core';
import { createRecipeRequestSchema, updateRecipeRequestSchema } from '@kitchensink/schema-recipe';

import { makeIngredientView, makeRecipeDetail, makeStepView } from '../../__fixtures__/index.js';
import { updateIngredientAt } from '../props.js';

import {
    canAdvanceFromStep,
    computeTotalTime,
    defaultRecipeFormValues,
    draftQuantity,
    draftQuantityVerdict,
    DESCRIPTION_MAX_LENGTH,
    TITLE_MAX_LENGTH,
    lineCalories,
    pendingIngredientIds,
    recipeNutritionTotal,
    setIngredientStatusById,
    stepErrorsFor,
    toCreateRecipeInput,
    toNutritionLine,
    toRecipeFormValues,
    toUpdateRecipeInput,
    validateRecipeForm,
    type RecipeFormIngredient,
    type RecipeFormValues,
} from '../model.js';

/**
 * U8 — the ONE parse from the loose form draft to the wire's `exact | range | absent` value object.
 *
 * The draft is deliberately loose (a half-typed numeric input is a real state); the value object is what a
 * coherent draft PARSES to at the wire boundary. Everything a caller could get wrong lives in this one
 * function, so these cases are the whole story for four call sites.
 */
describe('draftQuantity', () => {
    const line = (over: Partial<RecipeFormIngredient>): RecipeFormIngredient => ({
        ingredientId: '00000000-0000-4000-8000-0000000000aa',
        name: 'Flour',
        quantity: 2,
        ...over,
    });

    it('parses a stated amount with no upper bound as `exact`', () => {
        expect(draftQuantity(line({ quantity: 2 }))).toEqual({ kind: 'exact', value: 2 });
    });

    it('parses a stated pair as a `range`, preserving BOTH bounds (R36)', () => {
        expect(draftQuantity(line({ quantity: 2, quantityHigh: 3 }))).toEqual({ kind: 'range', low: 2, high: 3 });
    });

    // ⛔ R40. An emptied numeric input parses to `NaN`; the honest reading is that the line states no
    // amount, NOT that it states zero and not that it states one.
    it('parses an emptied field as `absent`, never as a zero or a fabricated one', () => {
        expect(draftQuantity(line({ quantity: Number.NaN }))).toEqual({ kind: 'absent' });
        expect(draftQuantity(line({ quantity: 0 }))).toEqual({ kind: 'absent' });
    });

    // An incoherent draft is a REAL intermediate state (the user is mid-edit) that the inline validator
    // reports; this parse reports it as "no amount stated" rather than inventing one, and submission is
    // blocked separately by `validateRecipeForm`.
    it('parses an incoherent pair as `absent` rather than guessing which bound was meant', () => {
        expect(draftQuantity(line({ quantity: 3, quantityHigh: 2 }))).toEqual({ kind: 'absent' });
        expect(draftQuantity(line({ quantity: Number.NaN, quantityHigh: 3 }))).toEqual({ kind: 'absent' });
    });

    it('collapses coincident bounds to `exact`, so one amount has one representation', () => {
        expect(draftQuantity(line({ quantity: 2, quantityHigh: 2 }))).toEqual({ kind: 'exact', value: 2 });
    });
});

const filledValues = (over: Partial<RecipeFormValues> = {}): RecipeFormValues => ({
    ...defaultRecipeFormValues(),
    title: 'Herb Risotto',
    servings: 4,
    prepTimeMinutes: 10,
    cookTimeMinutes: 25,
    ingredients: [
        { ingredientId: '00000000-0000-4000-8000-000000000001', name: 'Arborio rice', quantity: 300, unit: 'g' },
    ],
    steps: [{ instruction: 'Toast the rice.' }],
    ...over,
});

describe('computeTotalTime', () => {
    it('sums prep + cook', () => {
        expect(computeTotalTime(10, 25)).toBe(35);
        expect(computeTotalTime(0, 0)).toBe(0);
    });
});

describe('defaultRecipeFormValues', () => {
    it('starts empty and public with no ingredients or steps', () => {
        const v = defaultRecipeFormValues();
        expect(v.title).toBe('');
        expect(v.ingredients).toEqual([]);
        expect(v.steps).toEqual([]);
        expect(v.visibility).toBe('public');
    });
});

describe('toCreateRecipeInput', () => {
    it('maps form values to the wire contract with auto total time', () => {
        const input = toCreateRecipeInput(
            filledValues({ description: 'Creamy.', cuisine: 'Italian', tags: ['dinner'] }),
        );
        expect(input.title).toBe('Herb Risotto');
        expect(input.description).toBe('Creamy.');
        expect(input.cuisine).toBe('Italian');
        expect(input.tags).toEqual(['dinner']);
        expect(input.totalTimeMinutes).toBe(35);
        expect(input.ingredients).toEqual([
            {
                ingredientId: '00000000-0000-4000-8000-000000000001',
                name: 'Arborio rice',
                quantity: { kind: 'exact', value: 300 },
                unit: 'g',
            },
        ]);
        expect(input.steps).toEqual([{ instruction: 'Toast the rice.' }]);
    });

    it('omits empty optional strings and drops unresolved ingredient lines (no ingredientId)', () => {
        const input = toCreateRecipeInput(
            filledValues({
                description: '',
                cuisine: '',
                ingredients: [
                    { ingredientId: '00000000-0000-4000-8000-000000000001', name: 'Rice', quantity: 1, unit: 'cup' },
                    { ingredientId: null, name: 'Pending food', quantity: 1 },
                ],
            }),
        );
        expect(input.description).toBeUndefined();
        expect(input.cuisine).toBeUndefined();
        expect(input.ingredients).toHaveLength(1);
        expect(input.ingredients[0]?.ingredientId).toBe('00000000-0000-4000-8000-000000000001');
    });

    it('includes a step timer only when set', () => {
        const input = toCreateRecipeInput(
            filledValues({ steps: [{ instruction: 'Rest.', timerSeconds: 600 }, { instruction: 'Serve.' }] }),
        );
        expect(input.steps[0]).toEqual({ instruction: 'Rest.', timerSeconds: 600 });
        expect(input.steps[1]).toEqual({ instruction: 'Serve.' });
    });

    it('carries a stated difficulty', () => {
        expect(toCreateRecipeInput(filledValues({ difficulty: RecipeDifficulty.HARD })).difficulty).toBe('hard');
        expect(toCreateRecipeInput(filledValues({ difficulty: RecipeDifficulty.EASY })).difficulty).toBe('easy');
    });

    it('OMITS difficulty when not stated — create has no clear sentinel, so it must never send null', () => {
        const input = toCreateRecipeInput(filledValues());

        // Mutation guard: `null` (the update clear) is illegal on create; absence must be a true omit.
        expect(input.difficulty).toBeUndefined();
        expect('difficulty' in input).toBe(false);
    });

    it('OMITS status when not given (the plain non-wizard save path never touches publication state)', () => {
        const input = toCreateRecipeInput(filledValues());

        expect(input.status).toBeUndefined();
        expect('status' in input).toBe(false);
    });

    it('carries a given status verbatim (draft or published)', () => {
        expect(toCreateRecipeInput(filledValues(), RecipeStatus.DRAFT).status).toBe('draft');
        expect(toCreateRecipeInput(filledValues(), RecipeStatus.PUBLISHED).status).toBe('published');
    });
});

describe('toUpdateRecipeInput (three-state difficulty)', () => {
    it('carries a stated difficulty (set on an update)', () => {
        expect(toUpdateRecipeInput(filledValues({ difficulty: RecipeDifficulty.MEDIUM })).difficulty).toBe('medium');
    });

    it('carries the NEW value when an edit changes difficulty', () => {
        // Form seeded from medium, user picks hard → the update asserts the new value.
        expect(toUpdateRecipeInput(filledValues({ difficulty: RecipeDifficulty.HARD })).difficulty).toBe('hard');
    });

    it('sends explicit null to CLEAR when an edit removes a previously-set difficulty', () => {
        // The edit form loaded a difficulty, the user chose "not stated" → the field is absent. This is the
        // crux: it MUST become an explicit `null` clear, NOT an omit (omit = unchanged = cannot clear).
        const input = toUpdateRecipeInput(filledValues());

        expect(input.difficulty).toBeNull();
        expect('difficulty' in input).toBe(true);
    });

    // U34 widened the exception list by exactly one: `mealType` is the SECOND three-state field, so it
    // differs between the two bodies for the same reason `difficulty` does (create omits, update clears with
    // an explicit null). Everything else must still mirror, which is what makes this a drift detector rather
    // than a restatement of the mapper.
    it('mirrors create for every field except the three-state pair AND visibility', () => {
        const values = filledValues({
            description: 'Creamy.',
            cuisine: 'Italian',
            difficulty: RecipeDifficulty.EASY,
            mealType: 'dinner',
        });
        const {
            difficulty: _updateDifficulty,
            mealType: _updateMealType,
            ...updateRest
        } = toUpdateRecipeInput(values);
        const {
            difficulty: _createDifficulty,
            mealType: _createMealType,
            visibility: _createVisibility,
            ...createRest
        } = toCreateRecipeInput(values);

        expect(updateRest).toEqual(createRest);
    });

    // ⚠️ THE ASSERTION THIS PAIR REPLACED WAS THE BUG'S ALIBI. It compared the two bodies field-for-field with
    // only `difficulty` excluded, so it actively PINNED `visibility` onto the PATCH body — a key
    // `updateRecipeRequestSchema` does not accept, because visibility moves through
    // `PATCH /api/v1/recipes/{id}/visibility` where the C-004 policy evaluator gates the transition. The service
    // silently stripped it, so nothing failed and the test read as proof the mapper was right.
    it('OMITS visibility — the PATCH contract has no such key, and the service was silently stripping it', () => {
        const input = toUpdateRecipeInput(filledValues({ visibility: RecipeVisibility.PRIVATE }));

        expect('visibility' in input).toBe(false);
    });

    // The other half, so the omission above cannot be "fixed" by dropping visibility from BOTH mappers: create
    // genuinely accepts it (`createRecipeRequestSchema.visibility`), and the editor's privacy control needs it.
    it('but create KEEPS visibility, which its own contract does accept', () => {
        expect(toCreateRecipeInput(filledValues({ visibility: RecipeVisibility.PRIVATE })).visibility).toBe('private');
    });

    it('diverges from create ONLY on the not-stated case: create omits, update clears with null', () => {
        // The one behavioral difference between the two mappers, pinned so neither drifts onto the other.
        expect('difficulty' in toCreateRecipeInput(filledValues())).toBe(false);
        expect(toUpdateRecipeInput(filledValues()).difficulty).toBeNull();
    });

    it('OMITS status when not given — a plain update never flips draft/published as a side effect', () => {
        const input = toUpdateRecipeInput(filledValues());

        expect(input.status).toBeUndefined();
        expect('status' in input).toBe(false);
    });

    it('carries a given status verbatim (draft or published)', () => {
        expect(toUpdateRecipeInput(filledValues(), RecipeStatus.DRAFT).status).toBe('draft');
        expect(toUpdateRecipeInput(filledValues(), RecipeStatus.PUBLISHED).status).toBe('published');
    });
});

/**
 * The projections must satisfy the bodies they claim to produce — PARSED, not compared field-by-field.
 *
 * Every other assertion above checks the mapper's shape against hand-named keys, which is why a body the
 * published contract rejects could pass the whole suite. `RecipeServiceClient` now parses OUTBOUND
 * (`this.request(...)`), so a body that fails here never reaches the network: the client throws
 * `InvalidRequestError` and the editor surfaces a generic save failure with no request in the log. That is a
 * silent, total loss of save — which is what these two assertions exist to make loud.
 */
describe('the form projections satisfy their published request contracts', () => {
    it('toUpdateRecipeInput produces a body updateRecipeRequestSchema accepts', () => {
        const body = { ...toUpdateRecipeInput(filledValues(), RecipeStatus.PUBLISHED), expectedVersion: 1 };
        const parsed = updateRecipeRequestSchema.safeParse(body);

        expect(parsed.error?.issues ?? []).toEqual([]);
        expect(parsed.success).toBe(true);
    });

    it('toCreateRecipeInput produces a body createRecipeRequestSchema accepts', () => {
        const parsed = createRecipeRequestSchema.safeParse(toCreateRecipeInput(filledValues()));

        expect(parsed.error?.issues ?? []).toEqual([]);
        expect(parsed.success).toBe(true);
    });

    /**
     * The wizard's Save-Draft floor is step 1 — title/servings/times, no ingredients and no steps. That body
     * was rejected by a flat `min(1)` on both arrays, so Save Draft could not have worked against the real
     * service at all; the e2e mock validated nothing, so nothing said so. The floor is now conditional on
     * publication, and this is the case that pins it from the app's side.
     */
    it('toCreateRecipeInput accepts the Save-Draft floor: step 1 only, no ingredients or steps', () => {
        const stepOneOnly = { ...defaultRecipeFormValues(), title: 'Weeknight Draft', servings: 4 };
        const parsed = createRecipeRequestSchema.safeParse(toCreateRecipeInput(stepOneOnly, RecipeStatus.DRAFT));

        expect(parsed.error?.issues ?? []).toEqual([]);
        expect(parsed.success).toBe(true);
    });

    it('but the SAME empty body is rejected when it publishes', () => {
        const stepOneOnly = { ...defaultRecipeFormValues(), title: 'Weeknight Draft', servings: 4 };
        const parsed = createRecipeRequestSchema.safeParse(toCreateRecipeInput(stepOneOnly, RecipeStatus.PUBLISHED));

        expect(parsed.success).toBe(false);
        expect(parsed.error?.issues.map((issue) => issue.path.join('.'))).toEqual(['ingredients', 'steps']);
    });
});

describe('validateRecipeForm', () => {
    it('passes a complete form', () => {
        expect(validateRecipeForm(filledValues())).toEqual({});
    });

    it('requires a title (returns the locale-agnostic code, not English copy)', () => {
        expect(validateRecipeForm(filledValues({ title: '   ' })).title).toBe('titleRequired');
    });

    it('requires at least one ingredient and one step', () => {
        expect(validateRecipeForm(filledValues({ ingredients: [] })).ingredients).toBe('ingredientsEmpty');
        expect(validateRecipeForm(filledValues({ steps: [] })).steps).toBe('stepsRequired');
    });

    it('flags an ingredient line that has not resolved to a catalog id', () => {
        const errors = validateRecipeForm(
            filledValues({ ingredients: [{ ingredientId: null, name: 'Kale', quantity: 1 }] }),
        );
        expect(errors.ingredients).toBe('ingredientsUnresolved');
    });

    it('requires positive servings and non-negative times', () => {
        expect(validateRecipeForm(filledValues({ servings: 0 })).servings).toBe('servingsPositive');
        expect(validateRecipeForm(filledValues({ prepTimeMinutes: -1 })).times).toBe('timesNonNegative');
    });

    /**
     * REWRITTEN for U9 (was: "flags ... a non-positive quantity" -> `ingredientsUnresolved`).
     *
     * The old code conflated two different failures under one message, and U9 makes that untenable: an
     * absent quantity is now VALID, so "every ingredient needs a resolved item and a quantity greater than
     * zero" is no longer a true sentence. Resolution and quantity are separate codes with separate copy,
     * and the assertion below proves the quantity failure gets the quantity code.
     */
    it('flags a resolved line whose quantity is a typed zero, as a QUANTITY failure', () => {
        const errors = validateRecipeForm(
            filledValues({
                ingredients: [{ ingredientId: '00000000-0000-4000-8000-000000000001', name: 'Kale', quantity: 0 }],
            }),
        );
        expect(errors.ingredients).toBe('ingredientsQuantityInvalid');
    });

    it('flags an incoherent RANGE — an upper bound below its lower one (R42)', () => {
        const errors = validateRecipeForm(
            filledValues({
                ingredients: [
                    {
                        ingredientId: '00000000-0000-4000-8000-000000000001',
                        name: 'Flour',
                        quantity: 3,
                        quantityHigh: 2,
                    },
                ],
            }),
        );
        expect(errors.ingredients).toBe('ingredientsQuantityInvalid');
    });

    it('flags an upper bound stated with NO lower bound (R42)', () => {
        const errors = validateRecipeForm(
            filledValues({
                ingredients: [
                    {
                        ingredientId: '00000000-0000-4000-8000-000000000001',
                        name: 'Flour',
                        quantity: Number.NaN,
                        quantityHigh: 3,
                    },
                ],
            }),
        );
        expect(errors.ingredients).toBe('ingredientsQuantityInvalid');
    });

    it('ACCEPTS a line that states no quantity at all (R40) — an absent amount is not an error', () => {
        expect(
            validateRecipeForm(
                filledValues({
                    ingredients: [
                        {
                            ingredientId: '00000000-0000-4000-8000-000000000001',
                            name: 'Butter',
                            quantity: Number.NaN,
                            unit: 'the size of an egg',
                        },
                    ],
                }),
            ),
        ).toEqual({});
    });

    it('ACCEPTS a coherent range', () => {
        expect(
            validateRecipeForm(
                filledValues({
                    ingredients: [
                        {
                            ingredientId: '00000000-0000-4000-8000-000000000001',
                            name: 'Flour',
                            quantity: 2,
                            quantityHigh: 3,
                            unit: 'cups',
                        },
                    ],
                }),
            ),
        ).toEqual({});
    });

    it('reports an UNRESOLVED line ahead of a quantity failure, so the user fixes the picker first', () => {
        // One field carries one code. The precedence is stated here rather than left to array order: a line
        // with no catalog id cannot be submitted whatever its quantity says.
        const errors = validateRecipeForm(
            filledValues({
                ingredients: [
                    { ingredientId: null, name: 'Kale', quantity: 1 },
                    { ingredientId: '00000000-0000-4000-8000-000000000001', name: 'Salt', quantity: 0 },
                ],
            }),
        );
        expect(errors.ingredients).toBe('ingredientsUnresolved');
    });

    it('requires a non-blank step instruction (whitespace-only fails, mirroring the title rule)', () => {
        const errors = validateRecipeForm(filledValues({ steps: [{ instruction: '   ' }] }));
        expect(errors.steps).toBe('stepsRequired');
    });

    // DA5 no-drift guard: the composed validator deliberately does NOT parse servings/prep/cook time through
    // the wire schema's `positiveIntSchema`/`nonNegativeIntSchema` (which additionally require an integer) —
    // a fractional-but-positive value must stay VALID, exactly as it always has.
    it('accepts fractional-but-positive servings and times (composing the schema must not newly require an integer)', () => {
        expect(validateRecipeForm(filledValues({ servings: 2.5, prepTimeMinutes: 1.5, cookTimeMinutes: 0.5 }))).toEqual(
            {},
        );
    });
});

describe('stepErrorsFor / canAdvanceFromStep (W3 — the wizard field->step map)', () => {
    // The field->step map (U33 step model): step 1 = Details — title/servings/times (the fields
    // `validateRecipeForm` can flag; description/cuisine/tags/dietary/difficulty/mealType/visibility/PHOTOS
    // have no invalid state to flag, and photos now live on this step); step 2 = Ingredients; step 3 =
    // Instructions; step 4 = REVIEW, which renders the draft read-only and owns no field of its own.

    it('step 1 (Details) surfaces ONLY title/servings/times errors, never ingredients/steps', () => {
        const values = filledValues({ title: '', servings: 0, ingredients: [], steps: [] });

        expect(stepErrorsFor(values, 1)).toEqual({ title: 'titleRequired', servings: 'servingsPositive' });
    });

    it('step 2 surfaces ONLY the ingredients error', () => {
        const values = filledValues({ title: '', ingredients: [] });

        expect(stepErrorsFor(values, 2)).toEqual({ ingredients: 'ingredientsEmpty' });
    });

    it('step 3 surfaces ONLY the steps error', () => {
        const values = filledValues({ title: '', steps: [] });

        expect(stepErrorsFor(values, 3)).toEqual({ steps: 'stepsRequired' });
    });

    // REWRITTEN for the U33 step model: this used to read "step 4 (photos)". Step 4 is now REVIEW, and the
    // reason it carries no errors changed with it — it is not that photos are decoupled from validation, it
    // is that Review owns no field at all. The gate a cook meets on Review is `Publish`'s WHOLE-form
    // `validateRecipeForm`, which is a different question from "may I leave this step".
    it('step 4 (Review) surfaces no errors of its own — it owns no field', () => {
        expect(stepErrorsFor(defaultRecipeFormValues(), 4)).toEqual({});
        expect(stepErrorsFor(filledValues(), 4)).toEqual({});
    });

    it('Review stays reachable and leavable even while an EARLIER step is invalid', () => {
        // Free rail navigation is the wizard's, but the step gate must not invent a blocker on Review: a
        // draft with no ingredients is invalid on step 2 and still says nothing about step 4.
        const values = filledValues({ ingredients: [], steps: [] });

        expect(stepErrorsFor(values, 4)).toEqual({});
        expect(canAdvanceFromStep(values, 4)).toBe(true);
    });

    it('photos are NOT a validation input on any step (U33 — they moved into Details)', () => {
        // A draft carrying photos and one carrying none must validate identically, on every step: photos
        // upload independently of the metadata save and can never block an advance or a publish.
        const withPhotos = filledValues({
            photos: [{ localId: 'local-1', fileName: 'a.png', contentType: 'image/png', fileSize: 10 }],
        });

        for (const step of [1, 2, 3, 4] as const) {
            expect(stepErrorsFor(withPhotos, step)).toEqual(stepErrorsFor(filledValues(), step));
        }

        expect(validateRecipeForm(withPhotos)).toEqual(validateRecipeForm(filledValues()));
    });

    it('a fully valid form has no errors on any step', () => {
        const values = filledValues();

        expect(stepErrorsFor(values, 1)).toEqual({});
        expect(stepErrorsFor(values, 2)).toEqual({});
        expect(stepErrorsFor(values, 3)).toEqual({});
        expect(stepErrorsFor(values, 4)).toEqual({});
    });

    it('canAdvanceFromStep mirrors stepErrorsFor being empty', () => {
        const invalidTitle = filledValues({ title: '' });

        expect(canAdvanceFromStep(invalidTitle, 1)).toBe(false);
        expect(canAdvanceFromStep(filledValues(), 1)).toBe(true);
        expect(canAdvanceFromStep(filledValues({ ingredients: [] }), 2)).toBe(false);
        expect(canAdvanceFromStep(filledValues({ steps: [] }), 3)).toBe(false);
        // Step 4 (Review) is always advanceable — it owns no field to be invalid.
        expect(canAdvanceFromStep(defaultRecipeFormValues(), 4)).toBe(true);
    });
});

describe('pendingIngredientIds (poll-after-add: which lines still resolve)', () => {
    it('returns only the catalog ids of PENDING lines, de-duplicated', () => {
        const values = filledValues({
            ingredients: [
                { ingredientId: 'p1', name: 'Quinoa', quantity: 1, resolutionStatus: 'PENDING' },
                { ingredientId: 'r1', name: 'Rice', quantity: 1, resolutionStatus: 'RESOLVED' },
                { ingredientId: 'p1', name: 'Quinoa again', quantity: 2, resolutionStatus: 'PENDING' },
                { ingredientId: 'u1', name: 'Ambiguous', quantity: 1, resolutionStatus: 'UNRESOLVED' },
            ],
        });

        // Only PENDING ids, and p1 (twice) collapses to one — RESOLVED/UNRESOLVED are NOT polled.
        expect(pendingIngredientIds(values)).toEqual(['p1']);
    });

    it('never polls a line with no catalog id or with no status', () => {
        const values = filledValues({
            ingredients: [
                { ingredientId: null, name: 'Blank', quantity: 1, resolutionStatus: 'PENDING' },
                { ingredientId: 'x', name: 'Freeform', quantity: 1 },
            ],
        });

        expect(pendingIngredientIds(values)).toEqual([]);
    });
});

describe('toNutritionLine (E3 plumbing — form line -> the aggregator NutritionLine)', () => {
    const baseLine = (over: Partial<RecipeFormIngredient> = {}): RecipeFormIngredient => ({
        ingredientId: '00000000-0000-4000-8000-000000000001',
        name: 'Olive oil',
        quantity: 2,
        unit: 'tbsp',
        ...over,
    });

    it('maps the catalog per-100g branch (mass unit) with no user-override fields', () => {
        const line = baseLine({
            quantity: 300,
            unit: 'g',
            caloriesPer100g: 130,
            proteinGPer100g: 2.7,
            carbsGPer100g: 28,
            fatGPer100g: 0.3,
        });

        expect(toNutritionLine(line)).toEqual({
            quantity: { kind: 'exact', value: 300 },
            unit: 'g',
            caloriesPer100g: 130,
            proteinGPer100g: 2.7,
            carbsGPer100g: 28,
            fatGPer100g: 0.3,
        });
        // Round-trip through the real aggregator: 300g @ 130 cal/100g = 390 cal for this one line/serving.
        expect(computeRecipeNutrition([toNutritionLine(line)], 1)).toEqual({
            calories: 390,
            proteinG: 8.1,
            carbsG: 84,
            fatG: 0.9,
            isComplete: true,
        });
    });

    it('carries household portions so a volumetric/count unit converts through the real aggregator', () => {
        const line = baseLine({
            quantity: 2,
            unit: 'tablespoon',
            caloriesPer100g: 884,
            proteinGPer100g: 0,
            carbsGPer100g: 0,
            fatGPer100g: 100,
            portions: [{ unit: 'tablespoon', gramsPerUnit: 13.5 }],
        });

        expect(toNutritionLine(line).portions).toEqual([{ unit: 'tablespoon', gramsPerUnit: 13.5 }]);
        expect(computeRecipeNutrition([toNutritionLine(line)], 1).isComplete).toBe(true);
    });

    it('maps the freeform user-override branch, taking priority over any (absent) catalog data', () => {
        const line = baseLine({
            ingredientId: 'ing_free',
            name: 'Grandma’s spice mix',
            quantity: 1,
            unit: 'batch',
            userCalories: 45,
            userProteinG: 1,
            userCarbsG: 8,
            userFatG: 0.5,
        });

        expect(toNutritionLine(line)).toEqual({
            quantity: { kind: 'exact', value: 1 },
            unit: 'batch',
            userCalories: 45,
            userProteinG: 1,
            userCarbsG: 8,
            userFatG: 0.5,
        });
        expect(computeRecipeNutrition([toNutritionLine(line)], 1)).toEqual({
            calories: 45,
            proteinG: 1,
            carbsG: 8,
            fatG: 0.5,
            isComplete: true,
        });
    });

    it('maps an honestly-incomplete line (no user override, no resolved catalog nutrition) to isComplete: false', () => {
        // A freshly-picked line still PENDING catalog resolution, or a freeform line with no user nutrition yet.
        const line = baseLine({ resolutionStatus: 'PENDING' });

        expect(toNutritionLine(line)).toEqual({ quantity: { kind: 'exact', value: 2 }, unit: 'tbsp' });
        expect(computeRecipeNutrition([toNutritionLine(line)], 1).isComplete).toBe(false);
    });

    it('degrades an absent unit to an empty string rather than guessing — unconvertible, honestly incomplete', () => {
        const line: RecipeFormIngredient = {
            ingredientId: '00000000-0000-4000-8000-000000000002',
            name: 'Eggs',
            quantity: 3,
            caloriesPer100g: 155,
        };

        const nutritionLine = toNutritionLine(line);

        expect(nutritionLine.unit).toBe('');
        expect(computeRecipeNutrition([nutritionLine], 1).isComplete).toBe(false);
    });
});

describe('lineCalories (w3/e3 — per-row calorie figure)', () => {
    const baseLine = (over: Partial<RecipeFormIngredient> = {}): RecipeFormIngredient => ({
        ingredientId: '00000000-0000-4000-8000-000000000001',
        name: 'Olive oil',
        quantity: 2,
        unit: 'tbsp',
        ...over,
    });

    it('returns the resolved catalog line calories — the SAME number the aggregator itself computes', () => {
        const line = baseLine({
            quantity: 300,
            unit: 'g',
            caloriesPer100g: 130,
            proteinGPer100g: 2.7,
            carbsGPer100g: 28,
            fatGPer100g: 0.3,
        });

        expect(lineCalories(line)).toBe(computeRecipeNutrition([toNutritionLine(line)], 1).calories);
        expect(lineCalories(line)).toBe(390);
    });

    it('returns the freeform user-entered calories verbatim, including an honest zero', () => {
        const line = baseLine({ ingredientId: 'ing_free', userCalories: 45, userProteinG: 1 });

        expect(lineCalories(line)).toBe(45);

        const zeroCalorieLine = baseLine({ ingredientId: 'ing_water', name: 'Water', userCalories: 0 });

        expect(lineCalories(zeroCalorieLine)).toBe(0);
    });

    it('returns undefined (never a fake 0) for a line still resolving (no catalog nutrition yet)', () => {
        const line = baseLine({ resolutionStatus: 'PENDING' });

        expect(lineCalories(line)).toBeUndefined();
    });

    it('returns undefined for a catalog line whose unit cannot convert to grams (no portions)', () => {
        const line = baseLine({ quantity: 1, unit: 'clove', caloriesPer100g: 149 });

        expect(lineCalories(line)).toBeUndefined();
    });

    it('returns undefined for a seeded-without-nutrition line (edit-mode gap, RESOLVED but no per-100g)', () => {
        // A line seeded from RecipeIngredientView (an existing recipe's ingredients), which does not carry
        // per-100g nutrition — resolutionStatus is 'RESOLVED' but there is still nothing to compute from.
        const line = baseLine({ resolutionStatus: 'RESOLVED' });

        expect(lineCalories(line)).toBeUndefined();
    });
});

describe('recipeNutritionTotal (w3/e3 — the running per-serving total, one aggregator, no second rule)', () => {
    it('matches computeRecipeNutrition run directly over the same mapped lines', () => {
        const values = filledValues({
            servings: 2,
            ingredients: [
                {
                    ingredientId: '00000000-0000-4000-8000-000000000001',
                    name: 'Arborio rice',
                    quantity: 300,
                    unit: 'g',
                    caloriesPer100g: 130,
                },
                {
                    ingredientId: '00000000-0000-4000-8000-000000000002',
                    name: 'Salt',
                    quantity: 5,
                    unit: 'g',
                    userCalories: 0,
                },
            ],
        });

        expect(recipeNutritionTotal(values)).toEqual(
            computeRecipeNutrition(values.ingredients.map(toNutritionLine), values.servings),
        );
    });

    it('sums complete lines to a definite total and flags isComplete: true when every line is accounted for', () => {
        const values = filledValues({
            servings: 1,
            ingredients: [
                {
                    ingredientId: '00000000-0000-4000-8000-000000000001',
                    name: 'Arborio rice',
                    quantity: 300,
                    unit: 'g',
                    caloriesPer100g: 130,
                    proteinGPer100g: 2.7,
                    carbsGPer100g: 28,
                    fatGPer100g: 0.3,
                },
                {
                    ingredientId: '00000000-0000-4000-8000-000000000002',
                    name: 'Custom spice',
                    quantity: 1,
                    userCalories: 30,
                    userProteinG: 1,
                },
            ],
        });

        expect(recipeNutritionTotal(values)).toEqual({
            calories: 420,
            proteinG: 9.1,
            carbsG: 84,
            fatG: 0.9,
            isComplete: true,
        });
    });

    it('flags isComplete: false and still sums every ACCOUNTABLE line when one line cannot be computed', () => {
        const values = filledValues({
            servings: 1,
            ingredients: [
                {
                    ingredientId: '00000000-0000-4000-8000-000000000001',
                    name: 'Arborio rice',
                    quantity: 300,
                    unit: 'g',
                    caloriesPer100g: 130,
                },
                // Still resolving — no catalog nutrition yet, no user override: excluded, never a fake 0.
                {
                    ingredientId: '00000000-0000-4000-8000-000000000002',
                    name: 'Stock',
                    quantity: 1,
                    unit: 'cup',
                    resolutionStatus: 'PENDING',
                },
            ],
        });

        const total = recipeNutritionTotal(values);

        expect(total.isComplete).toBe(false);
        expect(total.calories).toBe(390); // the rice's contribution alone — the unresolved line is excluded.
    });

    it('returns a zero, complete total for an empty ingredient list (no lines to fail on)', () => {
        expect(recipeNutritionTotal(filledValues({ ingredients: [] }))).toEqual({
            calories: 0,
            proteinG: 0,
            carbsG: 0,
            fatG: 0,
            isComplete: true,
        });
    });
});

describe('setIngredientStatusById (poll-after-add: apply a resolved status)', () => {
    const pendingValues = (): RecipeFormValues =>
        filledValues({
            ingredients: [
                { ingredientId: 'p1', name: 'Quinoa', quantity: 1, resolutionStatus: 'PENDING' },
                { ingredientId: 'p1', name: 'Quinoa', quantity: 2, resolutionStatus: 'PENDING' },
                { ingredientId: 'other', name: 'Rice', quantity: 1, resolutionStatus: 'PENDING' },
            ],
        });

    it('flips EVERY line linked to the id to the new status, leaving other lines untouched', () => {
        const next = setIngredientStatusById(pendingValues(), 'p1', 'RESOLVED');

        expect(next.ingredients.map((l) => l.resolutionStatus)).toEqual(['RESOLVED', 'RESOLVED', 'PENDING']);
    });

    it('returns the SAME reference when the status is unchanged (no render loop)', () => {
        const values = pendingValues();

        // p1 is already PENDING → setting PENDING must be a no-op that preserves referential identity.
        expect(setIngredientStatusById(values, 'p1', 'PENDING')).toBe(values);
    });

    it('returns the SAME reference when no line matches the id', () => {
        const values = pendingValues();

        expect(setIngredientStatusById(values, 'missing', 'RESOLVED')).toBe(values);
    });
});

describe('the editor INHERITS the wire bound rather than restating it (owner ruling)', () => {
    // The bounds live in `@kitchensink/recipe-core`, and `recipe-service`'s `recipes.schema.ts` composes the
    // very same objects into the published request body. These assertions close the loop from THIS side: the
    // number the editor measures itself against is the number the server enforces, so the pair below cannot
    // drift the way an independently-authored client-side limit would.

    it('the wire`s title field IS the recipe-core Value Object the form validates with', () => {
        expect(createRecipeRequestSchema.shape.title).toBe(recipeTitleSchema);
    });

    it('the wire`s description field wraps the recipe-core Value Object', () => {
        expect(createRecipeRequestSchema.shape.description.unwrap()).toBe(recipeDescriptionSchema);
    });

    it('the exported constants are the ones behind those schemas', () => {
        // Mutation-relevant: were `MAX_RECIPE_TITLE_LENGTH` to drift from `recipeTitleSchema`'s actual cap, the
        // "stricter, never looser" comparison below would be measuring against a number nothing enforces.
        expect(recipeTitleSchema.safeParse('a'.repeat(MAX_RECIPE_TITLE_LENGTH)).success).toBe(true);
        expect(recipeTitleSchema.safeParse('a'.repeat(MAX_RECIPE_TITLE_LENGTH + 1)).success).toBe(false);
        expect(recipeDescriptionSchema.safeParse('a'.repeat(MAX_RECIPE_DESCRIPTION_LENGTH)).success).toBe(true);
        expect(recipeDescriptionSchema.safeParse('a'.repeat(MAX_RECIPE_DESCRIPTION_LENGTH + 1)).success).toBe(false);
    });
});

describe('the editor may be STRICTER than the wire, never LOOSER (§15.2)', () => {
    // The editor caps `title` at 64 and `description` at 256 (w3/e6) with a hard `maxLength` on the input and
    // a live "N/64" counter, while the SERVER accepts 200 and 5000. A tighter editor is a legitimate product
    // choice — a title has to fit a card. A LOOSER one is a bug: the user types something the input accepts
    // and the API then rejects on submit, which is the failure mode centralizing the zod exists to end.
    //
    // ⚠️ The 3× / 20× gap between the two numbers is real and was NOT set deliberately — the pair were
    // authored independently. Which number is right for the product is an open question; this test only fixes
    // the DIRECTION, so the question can be answered later without a regression in the meantime.

    it('the title display cap does not exceed the wire cap', () => {
        expect(TITLE_MAX_LENGTH).toBeLessThanOrEqual(MAX_RECIPE_TITLE_LENGTH);
    });

    it('the description display cap does not exceed the wire cap', () => {
        expect(DESCRIPTION_MAX_LENGTH).toBeLessThanOrEqual(MAX_RECIPE_DESCRIPTION_LENGTH);
    });

    it('a title the editor allows is one the wire accepts', () => {
        const atCap = 'a'.repeat(TITLE_MAX_LENGTH);

        expect(createRecipeRequestSchema.shape.title.safeParse(atCap).success).toBe(true);
    });

    it('a description the editor allows is one the wire accepts', () => {
        const atCap = 'a'.repeat(DESCRIPTION_MAX_LENGTH);

        expect(createRecipeRequestSchema.shape.description.safeParse(atCap).success).toBe(true);
    });
});

describe('the form validators ARE the published wire schemas, so the two cannot drift', () => {
    it('composes the create schema`s own title field', () => {
        // Identity, not equivalence: `validateRecipeForm` reads `createRecipeRequestSchema.shape.title`, so a
        // change to the server`s title rule reaches the editor with no second edit.
        expect(validateRecipeForm(filledValues({ title: 'a'.repeat(MAX_RECIPE_TITLE_LENGTH + 1) })).title).toBe(
            'titleRequired',
        );
    });

    it('rejects an ingredient quantity the wire would reject, instead of round-tripping to a 400', () => {
        // 0.0001 rounds to 0.000 in the `numeric(10,3)` column and then violates its `CHECK (quantity > 0)`.
        expect(recipeIngredientQuantitySchema.safeParse(0.0001).success).toBe(false);
        expect(
            validateRecipeForm(
                filledValues({
                    ingredients: [
                        { ingredientId: '00000000-0000-4000-8000-000000000001', name: 'Salt', quantity: 0.0001 },
                    ],
                }),
            ).ingredients,
            // U9: the same rule, now reported under the code that names the field it is about.
        ).toBe('ingredientsQuantityInvalid');
    });

    // ⚠️ THERE IS DELIBERATELY NO TEST HERE FOR A MALFORMED-BUT-PRESENT `ingredientId`, and the asymmetry with
    // the quantity case above is the point. Quantity is USER-ENTERED, so a value the wire would reject is worth
    // catching in the editor rather than round-tripping to a 400. An `ingredientId` is not user-entered: it comes
    // back from the catalog API, which returns real UUIDs, so a malformed one is unreachable from this surface.
    //
    // A test asserting `validateRecipeForm` reports it as `ingredientsUnresolved` was written and then removed,
    // because it pinned the wrong behaviour: that code means "you have not picked this ingredient yet" (the
    // `null` sentinel), and reusing it for a malformed id would send the user back to a picker that is already
    // showing a selection. The FORMAT rule belongs to the wire — `recipeIngredientInputSchema` enforces
    // `z.uuid()` and the server rejects it — and `model.ts` records why the form must not compose that shape.
});

/**
 * U9 — the draft-side VERDICT on a quantity pair, and the half U8 deliberately left open.
 *
 * `draftQuantity` answers "what does this draft state?" and reports every incoherent pair as `absent`,
 * because a value object has no member for "these two numbers disagree". This is the other half: whether
 * that draft may be SUBMITTED. Without it an absent quantity is indistinguishable from a half-typed one,
 * and `validateRecipeForm` has to refuse both — which is exactly why an absent-quantity recipe could be
 * read but not saved.
 */
describe('draftQuantityVerdict (U9)', () => {
    const line = (overrides: Partial<RecipeFormIngredient>): RecipeFormIngredient => ({
        ingredientId: '00000000-0000-4000-8000-000000000001',
        name: 'Butter',
        quantity: 2,
        ...overrides,
    });

    it('accepts a single stated amount', () => {
        expect(draftQuantityVerdict(line({ quantity: 2 }))).toBe('stated');
    });

    it('accepts a coherent range', () => {
        expect(draftQuantityVerdict(line({ quantity: 2, quantityHigh: 3 }))).toBe('stated');
    });

    it('accepts coincident bounds (which collapse to one exact value)', () => {
        expect(draftQuantityVerdict(line({ quantity: 2, quantityHigh: 2 }))).toBe('stated');
    });

    it('reports BOTH bounds empty as absent — a submittable state (R40)', () => {
        // ⛔ THE U8 GAP THIS UNIT CLOSES. "Butter the size of an egg" states no amount; the draft holds
        // `NaN`, and calling that invalid is what made such a recipe readable but not editable.
        expect(draftQuantityVerdict(line({ quantity: Number.NaN }))).toBe('absent');
    });

    it('rejects an upper bound with no lower bound', () => {
        expect(draftQuantityVerdict(line({ quantity: Number.NaN, quantityHigh: 3 }))).toBe('invalid');
    });

    it('rejects an upper bound below its lower bound', () => {
        expect(draftQuantityVerdict(line({ quantity: 3, quantityHigh: 2 }))).toBe('invalid');
    });

    it('rejects a stated zero or negative — a typed number that is not an amount', () => {
        expect(draftQuantityVerdict(line({ quantity: 0 }))).toBe('invalid');
        expect(draftQuantityVerdict(line({ quantity: -1 }))).toBe('invalid');
    });

    it('rejects a bound the storage column cannot hold, on EITHER side of the range', () => {
        // Composes the wire's own per-bound schema, so a bound outside 0.001 .. 1 000 000 is refused here
        // rather than round-tripping to a 400 — and the UPPER bound is checked too, which a validator
        // written against the old scalar would have missed entirely.
        expect(draftQuantityVerdict(line({ quantity: 0.0001 }))).toBe('invalid');
        expect(draftQuantityVerdict(line({ quantity: 1, quantityHigh: 1_000_001 }))).toBe('invalid');
    });
});

/**
 * U9 — the seed adapter must round-trip every member of the quantity value object.
 *
 * This is the editability half of the unit: a recipe whose quantity is a range or absent has to survive
 * being opened in the editor and saved again without the bound quietly changing. The three assertions
 * below are open -> validate -> submit for each member, which is the only shape that catches a narrowing
 * (`2–3` saved back as `2`) or a fabrication (an absent amount saved back as `0`).
 */
describe('toRecipeFormValues + validate + submit — the quantity round-trip (U9)', () => {
    const seed = (quantity: RecipeIngredientView['quantity']): RecipeFormValues =>
        toRecipeFormValues(
            makeRecipeDetail({
                ingredients: [makeIngredientView({ quantity, unit: 'cups' })],
                steps: [makeStepView()],
            }),
        );

    it('round-trips an EXACT quantity', () => {
        const values = seed({ kind: 'exact', value: 2 });

        expect(validateRecipeForm(values)).toEqual({});
        expect(toCreateRecipeInput(values).ingredients[0]?.quantity).toEqual({ kind: 'exact', value: 2 });
    });

    it('round-trips a RANGE without narrowing it to its lower bound', () => {
        const values = seed({ kind: 'range', low: 2, high: 3 });

        expect(values.ingredients[0]?.quantity).toBe(2);
        expect(values.ingredients[0]?.quantityHigh).toBe(3);
        expect(validateRecipeForm(values)).toEqual({});
        expect(toCreateRecipeInput(values).ingredients[0]?.quantity).toEqual({ kind: 'range', low: 2, high: 3 });
    });

    it('round-trips an ABSENT quantity without fabricating one, and lets the form SUBMIT', () => {
        // ⛔ The defect U8 handed to U9: the draft holds `NaN`, and the old validator refused it, so this
        // recipe could be opened and never saved. Both halves are asserted — it validates, AND what it
        // submits is still `absent` rather than a `0` or a `1` the source never stated.
        const values = seed({ kind: 'absent' });

        expect(values.ingredients[0]?.quantity).toBeNaN();
        expect(validateRecipeForm(values)).toEqual({});
        expect(toCreateRecipeInput(values).ingredients[0]?.quantity).toEqual({ kind: 'absent' });
    });

    it('carries an absent quantity through the UPDATE body too (the edit path, not just create)', () => {
        expect(toUpdateRecipeInput(seed({ kind: 'absent' })).ingredients?.[0]?.quantity).toEqual({ kind: 'absent' });
    });
});

/**
 * U26/U27 — the DRAFT ↔ WIRE round trip for the two new line fields.
 *
 * ⛔ The failure this suite exists for is silent NARROWING, the same one U9's range work was written
 * against: a mapper that drops a field lets a cook open a recipe, change nothing, press save, and lose the
 * preparation — with every assertion about "the recipe was saved" still passing.
 */
describe('U26/U27 — preparation + groupLabel survive the draft round trip', () => {
    const detailWith = (over: Partial<RecipeIngredientView>): RecipeDetail =>
        makeRecipeDetail({
            ingredients: [
                makeIngredientView({
                    ingredientId: 'ing-1',
                    name: 'Onion',
                    quantity: { kind: 'exact', value: 2 },
                    unit: 'cup',
                    ...over,
                }),
            ],
        });

    it('seeds BOTH from a loaded recipe', () => {
        const values = toRecipeFormValues(
            detailWith({ preparation: 'finely chopped', groupLabel: 'For the marinade' }),
        );

        expect(values.ingredients[0]).toMatchObject({
            preparation: 'finely chopped',
            groupLabel: 'For the marinade',
        });
    });

    it('OMITS both keys when the loaded recipe states neither — never seeds `""`', () => {
        const values = toRecipeFormValues(detailWith({}));

        expect(values.ingredients[0]).not.toHaveProperty('preparation');
        expect(values.ingredients[0]).not.toHaveProperty('groupLabel');
    });

    // ⛔ THE NARROWING GUARD. Open → save with no edit must produce the same two values, not lose them.
    it('⛔ a load-then-save round trip preserves both, unchanged', () => {
        const detail = detailWith({ preparation: 'finely chopped', groupLabel: 'For the marinade' });
        const body = toCreateRecipeInput(toRecipeFormValues(detail));

        expect(body.ingredients[0]).toMatchObject({
            preparation: 'finely chopped',
            groupLabel: 'For the marinade',
        });
    });

    it('sends NEITHER key for an ungrouped, unprepared line — never `""`', () => {
        const body = toCreateRecipeInput(toRecipeFormValues(detailWith({})));

        expect(body.ingredients[0]).not.toHaveProperty('preparation');
        expect(body.ingredients[0]).not.toHaveProperty('groupLabel');
    });

    // A cook who types into the field and then clears it leaves `''` in the draft. Sending that would `400`
    // the whole save (`recipeIngredientGroupLabelSchema` rejects a blank) over a field they think is empty.
    it('omits a CLEARED field rather than sending the empty string', () => {
        const values = toRecipeFormValues(detailWith({}));
        const cleared = updateIngredientAt(values, 0, { preparation: '', groupLabel: '' });
        const body = toCreateRecipeInput(cleared);

        expect(body.ingredients[0]).not.toHaveProperty('preparation');
        expect(body.ingredients[0]).not.toHaveProperty('groupLabel');
    });

    // ⛔ And a field that is only whitespace is the same case wearing different bytes — `'  '` is not empty
    // to `=== ''`, so it would be SENT, and the wire would reject the whole recipe.
    it('omits a WHITESPACE-ONLY field, and TRIMS one the cook padded', () => {
        const values = toRecipeFormValues(detailWith({}));
        const padded = updateIngredientAt(values, 0, { preparation: '   ', groupLabel: '  Dry  ' });
        const body = toCreateRecipeInput(padded);

        expect(body.ingredients[0]).not.toHaveProperty('preparation');
        expect(body.ingredients[0]?.groupLabel).toBe('Dry');
    });

    // ⛔ U26's headline rule, on the CLIENT side of the wire this time.
    it('⛔ NEVER concatenates the preparation into the food name, on read or on write', () => {
        const detail = detailWith({ preparation: 'finely chopped' });
        const values = toRecipeFormValues(detail);
        const body = toCreateRecipeInput(values);

        expect(values.ingredients[0]?.name).toBe('Onion');
        expect(body.ingredients[0]?.name).toBe('Onion');
        expect(body.ingredients[0]?.name).not.toContain('finely chopped');
    });

    it('the UPDATE body carries both too — they are on the BASE schema, so a PATCH may edit them', () => {
        const detail = detailWith({ preparation: 'finely chopped', groupLabel: 'For the marinade' });
        const body = toUpdateRecipeInput(toRecipeFormValues(detail));

        expect(body.ingredients?.[0]).toMatchObject({
            preparation: 'finely chopped',
            groupLabel: 'For the marinade',
        });
    });

    // The section labels and their ORDER must survive a whole grouped recipe, not just one line.
    it('a GROUPED recipe round-trips its labels and their order', () => {
        const detail = makeRecipeDetail({
            ingredients: [
                makeIngredientView({ ingredientId: 'i-1', name: 'Flour', groupLabel: 'Dry' }),
                makeIngredientView({ ingredientId: 'i-2', name: 'Sugar', groupLabel: 'Dry' }),
                makeIngredientView({ ingredientId: 'i-3', name: 'Milk', groupLabel: 'Wet' }),
            ],
        });
        const body = toCreateRecipeInput(toRecipeFormValues(detail));

        expect(body.ingredients.map((line) => line.groupLabel)).toEqual(['Dry', 'Dry', 'Wet']);
        expect(body.ingredients.map((line) => line.name)).toEqual(['Flour', 'Sugar', 'Milk']);
    });
});

describe('meal type — a closed vocabulary in the draft, mapped like difficulty (U34)', () => {
    it('carries a stated meal type onto the create body', () => {
        expect(toCreateRecipeInput(filledValues({ mealType: 'dinner' })).mealType).toBe('dinner');
    });

    it('OMITS it when not stated — create has no clear sentinel, so it must never send null', () => {
        const input = toCreateRecipeInput(filledValues());

        expect(input.mealType).toBeUndefined();
        expect('mealType' in input).toBe(false);
    });

    it('sends an explicit null on UPDATE to CLEAR a previously-stated meal type', () => {
        // The crux, identical to difficulty's: an OMIT means "unchanged" on a PATCH, so a cook who ever chose
        // "dinner" could never get back to "not stated" without this sentinel.
        expect(toUpdateRecipeInput(filledValues()).mealType).toBeNull();
    });

    it('carries the NEW value when an edit changes it', () => {
        expect(toUpdateRecipeInput(filledValues({ mealType: 'brunch' })).mealType).toBe('brunch');
    });

    it('seeds from a loaded recipe, and omits it when the recipe states none', () => {
        const stated = toRecipeFormValues(makeRecipeDetail({ mealType: 'dessert' }));
        const unstated = toRecipeFormValues(makeRecipeDetail({}));

        expect(stated.mealType).toBe('dessert');
        expect(unstated.mealType).toBeUndefined();
        expect('mealType' in unstated).toBe(false);
    });

    it('is a SEPARATE axis from tags and dietary flags — setting it writes into neither array', () => {
        // The mockup wrote its Dietary chips into the SAME array as its Categories, which is the state bug
        // this models away. Three axes, three fields, no aliasing.
        const values = filledValues({ mealType: 'dinner', tags: ['weeknight'], dietaryFlags: ['vegan'] });
        const input = toCreateRecipeInput(values);

        expect(input.mealType).toBe('dinner');
        expect(input.tags).toEqual(['weeknight']);
        expect(input.dietaryFlags).toEqual(['vegan']);
    });
});
