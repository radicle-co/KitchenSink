/**
 * U7/U11 — THE STATED MEASURE, the amount and unit a source PRINTED before we restated it.
 *
 * ## What these specs are actually pinning
 *
 * The importer restates a historical measure at parse time: `one gill of milk` becomes `0.5 cup`, because
 * the USDA household-portion table carries `cup` and has never heard of a gill. The restated pair is what
 * nutrition is computed from — and, until this module shipped, it was also the only pair the verification
 * gate could see, so the model was shown a source reading `one gill of milk` beside a parse claiming
 * `0.5 cup` and asked whether they agree. That is a manufactured FALSE DISAGREE against a line we parsed
 * correctly, and U11 ranks a wrong disagree as the unacceptable direction.
 *
 * So the two properties below are the whole point of the type, and each is asserted as a REFUSAL rather
 * than only as an acceptance:
 *
 *  1. **A stated measure can never state NOTHING.** `IngredientQuantity` has an `absent` member for
 *     `butter the size of an egg`, and `convertHistoricalUnit` refuses such a line outright — there is no
 *     number to restate and inventing one is R40's forbidden fabrication. `statedMeasureSchema` must
 *     therefore reject `absent` at the boundary, not merely leave the database's CHECK to turn it into a
 *     500 on a legitimate-looking save.
 *  2. **A stated measure can never be UNITLESS.** `''` is how `recipe_ingredients.unit` spells "no unit",
 *     and a restatement is never FROM nothing; admitting a blank would give "this line has no stated
 *     measure" a second spelling beside the absent key.
 */
import { describe, expect, it } from 'vitest';

import { statedMeasureSchema, type StatedMeasure } from '../statedMeasure.js';

describe('statedMeasureSchema', () => {
    it('accepts the plan headline case — an exact amount in a historical unit', () => {
        const parsed = statedMeasureSchema.parse({ quantity: { kind: 'exact', value: 1 }, unit: 'gill' });

        expect(parsed).toEqual({ quantity: { kind: 'exact', value: 1 }, unit: 'gill' });
    });

    it('accepts a stated RANGE, because a source may print one', () => {
        const parsed = statedMeasureSchema.parse({
            quantity: { kind: 'range', low: 1, high: 2 },
            unit: 'wineglass',
        });

        expect(parsed).toEqual({ quantity: { kind: 'range', low: 1, high: 2 }, unit: 'wineglass' });
    });

    // ⛔ Property 1. `absent` is a legal `IngredientQuantity` and an ILLEGAL stated measure: there is nothing
    // to have restated. Admitting it would write a NULL `stated_quantity` beside a non-NULL `stated_unit`,
    // which `recipe_ingredients_stated_measure_coherent` refuses — a 500 where a 400 belongs.
    it('REFUSES an absent quantity', () => {
        expect(statedMeasureSchema.safeParse({ quantity: { kind: 'absent' }, unit: 'gill' }).success).toBe(false);
    });

    // ⛔ Property 2.
    it('REFUSES a blank unit', () => {
        expect(statedMeasureSchema.safeParse({ quantity: { kind: 'exact', value: 1 }, unit: '' }).success).toBe(false);
    });

    // The pair is ALL-OR-NOTHING: half a restatement cannot say what it converted FROM, which is exactly the
    // disclosure R35 exists to force. Absence is spelled by omitting the whole object, never by a half one.
    it('REFUSES a measure missing either half', () => {
        expect(statedMeasureSchema.safeParse({ quantity: { kind: 'exact', value: 1 } }).success).toBe(false);
        expect(statedMeasureSchema.safeParse({ unit: 'gill' }).success).toBe(false);
    });

    // `strictObject`, for the reason `ingredientQuantitySchema` states: a mis-spelled member that is silently
    // stripped persists a measure the caller did not mean.
    it('REFUSES an unknown member', () => {
        expect(
            statedMeasureSchema.safeParse({
                quantity: { kind: 'exact', value: 1 },
                unit: 'gill',
                millilitres: 118,
            }).success,
        ).toBe(false);
    });

    // A range's own coherence is inherited from `ingredientQuantitySchema` rather than restated here — the
    // assertion exists so a later refactor that stops composing it fails loudly.
    it('inherits the range coherence rule', () => {
        expect(
            statedMeasureSchema.safeParse({ quantity: { kind: 'range', low: 3, high: 2 }, unit: 'gill' }).success,
        ).toBe(false);
    });

    it('is assignable to the domain type', () => {
        const measure: StatedMeasure = statedMeasureSchema.parse({
            quantity: { kind: 'exact', value: 1 },
            unit: 'gill',
        });

        // `kind` narrows to the two members that state something — `absent` is not in the union at all, so
        // this reads a field that would not compile if the type had not excluded it.
        expect(measure.quantity.kind === 'exact' ? measure.quantity.value : measure.quantity.low).toBe(1);
    });
});
