/**
 * Unit tests for the draft's submittability rules (`form/validate.ts`).
 *
 * ⚠️ These 2 describe blocks came from `model.test.ts`, which covered all of `form/model.ts`
 * before it was split into one module per concern. No assertion was changed, added or dropped in the
 * move — the suite is redistributed, not rewritten.
 */
import { describe, expect, it } from 'vitest';

import { makeFilledRecipeFormValues } from '../../__fixtures__/index.js';
import { MAX_RECIPE_TITLE_LENGTH, recipeIngredientQuantitySchema } from '@kitchensink/recipe-core';
import { applyDraftAction } from '../props.js';
import { validateRecipeForm } from '../validate.js';
import type { RecipeFormValues } from '../values.js';
import { toCreateRecipeInput } from '../wire.js';

describe('validateRecipeForm', () => {
    it('passes a complete form', () => {
        expect(validateRecipeForm(makeFilledRecipeFormValues())).toEqual({});
    });

    it('requires a title (returns the locale-agnostic code, not English copy)', () => {
        expect(validateRecipeForm(makeFilledRecipeFormValues({ title: '   ' })).title).toBe('titleRequired');
    });

    it('requires at least one ingredient and one step', () => {
        expect(validateRecipeForm(makeFilledRecipeFormValues({ ingredients: [] })).ingredients).toBe(
            'ingredientsEmpty',
        );
        expect(validateRecipeForm(makeFilledRecipeFormValues({ steps: [] })).steps).toBe('stepsRequired');
    });

    it('flags an ingredient line that has not resolved to a catalog id', () => {
        const errors = validateRecipeForm(
            makeFilledRecipeFormValues({ ingredients: [{ ingredientId: null, name: 'Kale', quantity: 1 }] }),
        );
        expect(errors.ingredients).toBe('ingredientsUnresolved');
    });

    /**
     * U28 — an unresolved line is REFUSED, and its refusal must be the only outcome it can have.
     *
     * ⛔ THE SILENT DROP IS THE DATA-LOSS BUG, not the row. `toCreateRecipeInput` filters every line with no
     * `ingredientId` out of the wire body, so before U28 a Save Draft (which validates step 1 only) posted a
     * recipe MISSING the row the cook had just typed, with no error anywhere. The invariant below pins the
     * repair from the other side: anything the editor can now BUILD survives the wire mapping intact.
     */
    it('⛔ drops NO line built through the picker path — appended count === posted count', () => {
        const values = [
            { ingredientId: '00000000-0000-4000-8000-000000000001', name: 'Salt', quantity: 1 },
            { ingredientId: '00000000-0000-4000-8000-000000000002', name: 'Flour', quantity: 200, unit: 'g' },
            { ingredientId: '00000000-0000-4000-8000-000000000003', name: 'Water', quantity: 1 },
        ].reduce<RecipeFormValues>(
            (acc, line) => applyDraftAction(acc, { kind: 'appendResolvedIngredient', line }),
            makeFilledRecipeFormValues({ ingredients: [] }),
        );

        expect(values.ingredients).toHaveLength(3);
        // ⛔ The filter in `toCreateRecipeInput` is now unreachable from the UI — this asserts it, rather than
        // trusting it. A regression that lets the editor build an unresolved line shows up HERE as a count
        // mismatch, even if every other test still passes.
        expect(toCreateRecipeInput(values).ingredients).toHaveLength(values.ingredients.length);
        expect(validateRecipeForm(values).ingredients).toBeUndefined();
    });

    it('still REFUSES a line with no food, whatever it holds otherwise (the restored-draft case)', () => {
        // The state stays REPRESENTABLE on purpose (see `ResolvedRecipeFormIngredient`): a draft restored
        // from an older source may carry one, and the leaves must render it and say why. What must never
        // happen is it passing validation or reaching the wire.
        const values = makeFilledRecipeFormValues({
            ingredients: [{ ingredientId: null, name: 'Kale', quantity: 2, unit: 'cups' }],
        });

        expect(validateRecipeForm(values).ingredients).toBe('ingredientsUnresolved');
        expect(toCreateRecipeInput(values).ingredients).toHaveLength(0);
    });

    it('treats an EMPTY-STRING id as unresolved, exactly as the wire filter must', () => {
        const values = makeFilledRecipeFormValues({ ingredients: [{ ingredientId: '', name: 'Kale', quantity: 1 }] });

        expect(validateRecipeForm(values).ingredients).toBe('ingredientsUnresolved');
    });

    /**
     * REWRITTEN for U9 (was: "flags ... a non-positive quantity" -> `ingredientsUnresolved`).
     *
     * The old code conflated two different failures under one message, and U9 makes that untenable: an
     * absent quantity is now VALID, so "every ingredient needs a resolved item and a quantity greater than
     * zero" is no longer a true sentence. Resolution and quantity are separate codes with separate copy,
     * and the assertion below proves the quantity failure gets the quantity code.
     */
    // ⚠️ REVERSED by the 2026-09-12 owner ruling: the draft's bounds are NORMALISED before they are read
    // ("not a number and not a valid amount should be treated the same"), so a typed zero now states no
    // amount rather than an invalid one — and a line that states no amount is submittable (R40). Rewritten
    // to prove the new behaviour; the `ingredientsQuantityInvalid` code now has exactly one cause, the
    // wire-BOUNDS case asserted below, and `form/quantity.ts` carries the argument.
    it('does NOT flag a typed zero — it states no amount, which is submittable (REVERSED 2026-09-12)', () => {
        const errors = validateRecipeForm(
            makeFilledRecipeFormValues({
                ingredients: [{ ingredientId: '00000000-0000-4000-8000-000000000001', name: 'Kale', quantity: 0 }],
            }),
        );
        expect(errors.ingredients).toBeUndefined();
    });

    // ⚠️ REVERSED by the same ruling: an inverted pair is now SWAPPED rather than refused, so the cook's
    // two numbers survive as `2–3` instead of being reported back as an error.
    it('does NOT flag an inverted RANGE — the bounds are swapped (REVERSED 2026-09-12)', () => {
        const errors = validateRecipeForm(
            makeFilledRecipeFormValues({
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
        expect(errors.ingredients).toBeUndefined();
    });

    // ⚠️ REVERSED by the same ruling: a lone upper bound is PROMOTED to the amount ("if low is not a
    // number, then swap with high and high becomes null"), so the cook's 3 survives as an exact amount.
    it('does NOT flag an upper bound with no lower one — it becomes the amount (REVERSED 2026-09-12)', () => {
        const errors = validateRecipeForm(
            makeFilledRecipeFormValues({
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
        expect(errors.ingredients).toBeUndefined();
    });

    it('ACCEPTS a line that states no quantity at all (R40) — an absent amount is not an error', () => {
        expect(
            validateRecipeForm(
                makeFilledRecipeFormValues({
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
                makeFilledRecipeFormValues({
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
            makeFilledRecipeFormValues({
                ingredients: [
                    { ingredientId: null, name: 'Kale', quantity: 1 },
                    { ingredientId: '00000000-0000-4000-8000-000000000001', name: 'Salt', quantity: 0 },
                ],
            }),
        );
        expect(errors.ingredients).toBe('ingredientsUnresolved');
    });

    it('requires a non-blank step instruction (whitespace-only fails, mirroring the title rule)', () => {
        const errors = validateRecipeForm(makeFilledRecipeFormValues({ steps: [{ instruction: '   ' }] }));
        expect(errors.steps).toBe('stepsRequired');
    });

    // DA5 no-drift guard: the composed validator deliberately does NOT parse servings/prep/cook time through
    // the wire schema's `positiveIntSchema`/`nonNegativeIntSchema` (which additionally require an integer) —
    // a fractional-but-positive value must stay VALID, exactly as it always has.
    it('accepts fractional-but-positive servings and times (composing the schema must not newly require an integer)', () => {
        expect(
            validateRecipeForm(
                makeFilledRecipeFormValues({ servings: 2.5, prepTimeMinutes: 1.5, cookTimeMinutes: 0.5 }),
            ),
        ).toEqual({});
    });
});

describe('the form validators ARE the published wire schemas, so the two cannot drift', () => {
    it('composes the create schema`s own title field', () => {
        // Identity, not equivalence: `validateRecipeForm` reads `createRecipeRequestSchema.shape.title`, so a
        // change to the server`s title rule reaches the editor with no second edit.
        expect(
            validateRecipeForm(makeFilledRecipeFormValues({ title: 'a'.repeat(MAX_RECIPE_TITLE_LENGTH + 1) })).title,
        ).toBe('titleRequired');
    });

    it('rejects an ingredient quantity the wire would reject, instead of round-tripping to a 400', () => {
        // 0.0001 rounds to 0.000 in the `numeric(10,3)` column and then violates its `CHECK (quantity > 0)`.
        expect(recipeIngredientQuantitySchema.safeParse(0.0001).success).toBe(false);
        expect(
            validateRecipeForm(
                makeFilledRecipeFormValues({
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
