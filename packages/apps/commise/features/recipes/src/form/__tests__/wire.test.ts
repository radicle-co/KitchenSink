/**
 * Unit tests for the draft <-> published-request projections, in both directions (`form/wire.ts`).
 *
 * ⚠️ These 6 describe blocks came from `model.test.ts`, which covered all of `form/model.ts`
 * before it was split into one module per concern. No assertion was changed, added or dropped in the
 * move — the suite is redistributed, not rewritten.
 */
import { describe, expect, it } from 'vitest';
import {
    RecipeDifficulty,
    RecipeStatus,
    RecipeVisibility,
    type RecipeDetail,
    type RecipeIngredientView,
} from '@kitchensink/recipe-core';
import { createRecipeRequestSchema, updateRecipeRequestSchema } from '@kitchensink/schema-recipe';
import {
    makeFilledRecipeFormValues,
    makeIngredientView,
    makeRecipeDetail,
    makeStepView,
} from '../../__fixtures__/index.js';
import { applyDraftAction } from '../props.js';
import { validateRecipeForm } from '../validate.js';
import { defaultRecipeFormValues, type RecipeFormValues } from '../values.js';
import { toCreateRecipeInput, toRecipeFormValues, toUpdateRecipeInput } from '../wire.js';

describe('toCreateRecipeInput', () => {
    it('maps form values to the wire contract with auto total time', () => {
        const input = toCreateRecipeInput(
            makeFilledRecipeFormValues({ description: 'Creamy.', cuisine: 'Italian', tags: ['dinner'] }),
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
            makeFilledRecipeFormValues({
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
            makeFilledRecipeFormValues({
                steps: [{ instruction: 'Rest.', timerSeconds: 600 }, { instruction: 'Serve.' }],
            }),
        );
        expect(input.steps[0]).toEqual({ instruction: 'Rest.', timerSeconds: 600 });
        expect(input.steps[1]).toEqual({ instruction: 'Serve.' });
    });

    it('carries a stated difficulty', () => {
        expect(toCreateRecipeInput(makeFilledRecipeFormValues({ difficulty: RecipeDifficulty.HARD })).difficulty).toBe(
            'hard',
        );
        expect(toCreateRecipeInput(makeFilledRecipeFormValues({ difficulty: RecipeDifficulty.EASY })).difficulty).toBe(
            'easy',
        );
    });

    it('OMITS difficulty when not stated — create has no clear sentinel, so it must never send null', () => {
        const input = toCreateRecipeInput(makeFilledRecipeFormValues());

        // Mutation guard: `null` (the update clear) is illegal on create; absence must be a true omit.
        expect(input.difficulty).toBeUndefined();
        expect('difficulty' in input).toBe(false);
    });

    it('OMITS status when not given (the plain non-wizard save path never touches publication state)', () => {
        const input = toCreateRecipeInput(makeFilledRecipeFormValues());

        expect(input.status).toBeUndefined();
        expect('status' in input).toBe(false);
    });

    it('carries a given status verbatim (draft or published)', () => {
        expect(toCreateRecipeInput(makeFilledRecipeFormValues(), RecipeStatus.DRAFT).status).toBe('draft');
        expect(toCreateRecipeInput(makeFilledRecipeFormValues(), RecipeStatus.PUBLISHED).status).toBe('published');
    });
});

describe('toUpdateRecipeInput (three-state difficulty)', () => {
    it('carries a stated difficulty (set on an update)', () => {
        expect(
            toUpdateRecipeInput(makeFilledRecipeFormValues({ difficulty: RecipeDifficulty.MEDIUM })).difficulty,
        ).toBe('medium');
    });

    it('carries the NEW value when an edit changes difficulty', () => {
        // Form seeded from medium, user picks hard → the update asserts the new value.
        expect(toUpdateRecipeInput(makeFilledRecipeFormValues({ difficulty: RecipeDifficulty.HARD })).difficulty).toBe(
            'hard',
        );
    });

    it('sends explicit null to CLEAR when an edit removes a previously-set difficulty', () => {
        // The edit form loaded a difficulty, the user chose "not stated" → the field is absent. This is the
        // crux: it MUST become an explicit `null` clear, NOT an omit (omit = unchanged = cannot clear).
        const input = toUpdateRecipeInput(makeFilledRecipeFormValues());

        expect(input.difficulty).toBeNull();
        expect('difficulty' in input).toBe(true);
    });

    // U34 widened the exception list by exactly one: `mealType` is the SECOND three-state field, so it
    // differs between the two bodies for the same reason `difficulty` does (create omits, update clears with
    // an explicit null). Everything else must still mirror, which is what makes this a drift detector rather
    // than a restatement of the mapper.
    it('mirrors create for every field except the three-state pair AND visibility', () => {
        const values = makeFilledRecipeFormValues({
            description: 'Creamy.',
            cuisine: 'Italian',
            difficulty: RecipeDifficulty.EASY,
            mealType: 'dinner',
        });
        const { difficulty: _updateDifficulty, mealType: _updateMealType, ...updateRest } = toUpdateRecipeInput(values);
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
        const input = toUpdateRecipeInput(makeFilledRecipeFormValues({ visibility: RecipeVisibility.PRIVATE }));

        expect('visibility' in input).toBe(false);
    });

    // The other half, so the omission above cannot be "fixed" by dropping visibility from BOTH mappers: create
    // genuinely accepts it (`createRecipeRequestSchema.visibility`), and the editor's privacy control needs it.
    it('but create KEEPS visibility, which its own contract does accept', () => {
        expect(
            toCreateRecipeInput(makeFilledRecipeFormValues({ visibility: RecipeVisibility.PRIVATE })).visibility,
        ).toBe('private');
    });

    it('diverges from create ONLY on the not-stated case: create omits, update clears with null', () => {
        // The one behavioral difference between the two mappers, pinned so neither drifts onto the other.
        expect('difficulty' in toCreateRecipeInput(makeFilledRecipeFormValues())).toBe(false);
        expect(toUpdateRecipeInput(makeFilledRecipeFormValues()).difficulty).toBeNull();
    });

    it('OMITS status when not given — a plain update never flips draft/published as a side effect', () => {
        const input = toUpdateRecipeInput(makeFilledRecipeFormValues());

        expect(input.status).toBeUndefined();
        expect('status' in input).toBe(false);
    });

    it('carries a given status verbatim (draft or published)', () => {
        expect(toUpdateRecipeInput(makeFilledRecipeFormValues(), RecipeStatus.DRAFT).status).toBe('draft');
        expect(toUpdateRecipeInput(makeFilledRecipeFormValues(), RecipeStatus.PUBLISHED).status).toBe('published');
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
        const body = {
            ...toUpdateRecipeInput(makeFilledRecipeFormValues(), RecipeStatus.PUBLISHED),
            expectedVersion: 1,
        };
        const parsed = updateRecipeRequestSchema.safeParse(body);

        expect(parsed.error?.issues ?? []).toEqual([]);
        expect(parsed.success).toBe(true);
    });

    it('toCreateRecipeInput produces a body createRecipeRequestSchema accepts', () => {
        const parsed = createRecipeRequestSchema.safeParse(toCreateRecipeInput(makeFilledRecipeFormValues()));

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
        const cleared = applyDraftAction(values, {
            kind: 'updateIngredientAt',
            index: 0,
            patch: { preparation: '', groupLabel: '' },
        });
        const body = toCreateRecipeInput(cleared);

        expect(body.ingredients[0]).not.toHaveProperty('preparation');
        expect(body.ingredients[0]).not.toHaveProperty('groupLabel');
    });

    // ⛔ And a field that is only whitespace is the same case wearing different bytes — `'  '` is not empty
    // to `=== ''`, so it would be SENT, and the wire would reject the whole recipe.
    it('omits a WHITESPACE-ONLY field, and TRIMS one the cook padded', () => {
        const values = toRecipeFormValues(detailWith({}));
        const padded = applyDraftAction(values, {
            kind: 'updateIngredientAt',
            index: 0,
            patch: { preparation: '   ', groupLabel: '  Dry  ' },
        });
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
        expect(toCreateRecipeInput(makeFilledRecipeFormValues({ mealType: 'dinner' })).mealType).toBe('dinner');
    });

    it('OMITS it when not stated — create has no clear sentinel, so it must never send null', () => {
        const input = toCreateRecipeInput(makeFilledRecipeFormValues());

        expect(input.mealType).toBeUndefined();
        expect('mealType' in input).toBe(false);
    });

    it('sends an explicit null on UPDATE to CLEAR a previously-stated meal type', () => {
        // The crux, identical to difficulty's: an OMIT means "unchanged" on a PATCH, so a cook who ever chose
        // "dinner" could never get back to "not stated" without this sentinel.
        expect(toUpdateRecipeInput(makeFilledRecipeFormValues()).mealType).toBeNull();
    });

    it('carries the NEW value when an edit changes it', () => {
        expect(toUpdateRecipeInput(makeFilledRecipeFormValues({ mealType: 'brunch' })).mealType).toBe('brunch');
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
        const values = makeFilledRecipeFormValues({ mealType: 'dinner', tags: ['weeknight'], dietaryFlags: ['vegan'] });
        const input = toCreateRecipeInput(values);

        expect(input.mealType).toBe('dinner');
        expect(input.tags).toEqual(['weeknight']);
        expect(input.dietaryFlags).toEqual(['vegan']);
    });
});
