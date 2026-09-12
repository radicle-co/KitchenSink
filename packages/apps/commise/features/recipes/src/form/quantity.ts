/**
 * @module @commise/features-recipes/form — reading a draft line's loose numbers as a QUANTITY, and judging whether it may be submitted.
 *
 * The two halves answer different questions: `draftQuantity` is TOTAL and never fails, so the four
 * projections call it with no guard; `draftQuantityVerdict` is the gate, and exists because the value object
 * has no member for "these two numbers disagree". No consumer reads both.
 *
 * ⛔ THEY DIVERGE ON A NON-FINITE UPPER BOUND, and the divergence is characterized — not fixed — in
 * `__tests__/quantity.test.ts`. For `{quantity: 2, quantityHigh: NaN}` the verdict says `stated` while the
 * reading says ABSENT, so a save would drop the cook's stated amount with no error anywhere. The path is
 * held closed by a THIRD module neither of these can see — `parseQuantityBound` (`./props.ts`) answers
 * `undefined`, never `NaN` — and nothing asserts that invariant. Read that suite before touching either
 * function: both candidate repairs are user-visible and the choice is the owner's.
 *
 * Pure and platform-agnostic: shared unchanged by the web (`*.tsx`) and native (`*.native.tsx`) form
 * leaves and by the app container, so the two renders can never drift. No React, no platform APIs.
 */
import {
    ABSENT_QUANTITY,
    ingredientQuantitySchema,
    statedQuantity,
    type IngredientQuantity,
} from '@kitchensink/recipe-core';
import { type RecipeFormIngredient } from './values.js';

/**
 * An amount, as recipe-core defines one: finite and greater than zero.
 *
 * ⛔ ONE PREDICATE FOR BOTH BOUNDS (owner ruling 2026-09-12: *"not a number and not a valid amount should be
 * treated the same"*). So `NaN`, `±Infinity`, `0` and negatives are all "no bound stated" and are handled by
 * {@link normaliseBounds}'s three rules rather than by a second branch somewhere else. It mirrors
 * `recipe-core`'s own private `isAmount`, which is what `statedQuantity` applies one layer down.
 *
 * @param value - A raw draft bound.
 * @returns Whether it states an amount. Pure.
 */
const statesAnAmount = (value: number | undefined): value is number =>
    value !== undefined && Number.isFinite(value) && value > 0;

/**
 * The draft's two loose numbers, REPAIRED into a pair that cannot contradict itself.
 *
 * ⛔ OWNER RULING 2026-09-12, verbatim: *"If the high is not a number, then it should be null - null means
 * there is no high. If high is less than low, then swap the values. If low is not a number, then swap with
 * high and high becomes null."* The three rules are applied IN THAT ORDER, which matters: `{low: NaN,
 * high: 3}` survives rule 2 untouched (every comparison with `NaN` is false) and is then promoted by rule 3
 * to `{low: 3}`.
 *
 * ⛔ THIS EXISTS TO MAKE A DIVERGENCE UNREPRESENTABLE, not merely to fix one. `draftQuantityVerdict` used to
 * filter non-finite bounds itself while {@link draftQuantity} passed the raw pair to `statedQuantity`. The
 * two therefore answered different questions about the same line: for `{quantity: 2, quantityHigh: NaN}` the
 * gate said `stated` and the reading said `absent`, so validation let the save through and the wire mapper
 * sent "no amount" — the cook's 2 gone, silently, with `draftToSnapshot` writing the same absence into the
 * conflict snapshot. Both functions now read the pair ONLY through here.
 *
 * ⚠️ Repairing rather than refusing is the ruling's substance: an inverted pair and a high-with-no-low used
 * to be reported to the cook as errors and are now corrected. What survives as `invalid` is exactly the wire
 * BOUNDS check — see {@link draftQuantityVerdict}.
 *
 * @param line - The form's ingredient line.
 * @returns The repaired bounds; `low: undefined` when the line states no amount at all. Pure.
 */
const normaliseBounds = (line: RecipeFormIngredient): { low: number | undefined; high: number | undefined } => {
    let low = statesAnAmount(line.quantity) ? line.quantity : undefined;
    let high = statesAnAmount(line.quantityHigh) ? line.quantityHigh : undefined;

    if (low !== undefined && high !== undefined && high < low) {
        [low, high] = [high, low];
    }

    if (low === undefined) {
        // A high with no low is not half a range — the cook stated one amount, in the wrong field.
        low = high;
        high = undefined;
    }

    return { low, high };
};

/**
 * Parse one loose form draft line into the wire's `exact | range | absent` quantity value object (U8). Pure.
 *
 * ⛔ THE ONLY PLACE THE DRAFT'S NUMBERS BECOME A QUANTITY. Four call sites need this — the create body, the
 * update body, the nutrition line, and the optimistic conflict snapshot — and each of them getting it
 * independently is how three of them would end up disagreeing about what an emptied field means.
 *
 * Reads through {@link normaliseBounds}, so a pair the cook half-typed is REPAIRED before it is read: a
 * non-finite or non-positive upper bound is dropped, an inverted pair is swapped, and a lone upper bound
 * becomes the amount. A draft that states no amount at all still parses to `absent`, never to `0` and never
 * to a fabricated `1` (R40).
 *
 * @param line - The form's ingredient line.
 * @returns The quantity the line states.
 */
export const draftQuantity = (line: RecipeFormIngredient): IngredientQuantity => {
    const { low, high } = normaliseBounds(line);

    return low === undefined ? ABSENT_QUANTITY : (statedQuantity(low, high) ?? ABSENT_QUANTITY);
};

/**
 * What a draft line's quantity pair AMOUNTS TO, for submission purposes (U9).
 *
 * @remarks
 * `absent` — the line states no amount, which is a legitimate, submittable state (R40).
 * `stated` — the line states a coherent amount the wire will accept.
 * `invalid` — the two numbers do not describe any amount, and submission must be blocked.
 */
export type DraftQuantityVerdict = 'absent' | 'stated' | 'invalid';

/**
 * Judge one draft line's quantity pair. Pure.
 *
 * ⛔ THE OTHER HALF OF {@link draftQuantity}, AND THE DEFECT IT CLOSES. `draftQuantity` reports every
 * incoherent pair as `absent`, because the value object has no member for "these two numbers disagree" —
 * which is correct as a reading, and useless as a gate. Until this function existed the validator could not
 * tell "the source stated no amount" from "the user is half-way through typing", so it refused BOTH, and an
 * absent-quantity recipe could be opened in the editor and never saved.
 *
 * The bound check COMPOSES `ingredientQuantitySchema` — the wire's own discriminated union — rather than
 * `recipeIngredientQuantitySchema` applied to a scalar. That matters for a range: the wire applies the
 * storage bound to EVERY numeric member, so an upper bound the `numeric(10,3)` column cannot hold is caught
 * here instead of round-tripping to a 400. A validator written against the old scalar would have checked
 * only the lower one.
 *
 * @param line - The form's ingredient line.
 * @returns Whether the line states no amount, a valid amount, or an incoherent pair.
 */
export const draftQuantityVerdict = (line: RecipeFormIngredient): DraftQuantityVerdict => {
    // ⛔ THE SAME normaliser `draftQuantity` reads through, and that is the whole point — a second, private
    // reading of the bounds here is exactly the defect this replaced. Do not inline a filter.
    const { low, high } = normaliseBounds(line);

    if (low === undefined) {
        return 'absent';
    }

    const quantity = statedQuantity(low, high);

    return quantity !== null && ingredientQuantitySchema.safeParse(quantity).success ? 'stated' : 'invalid';
};
