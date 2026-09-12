/**
 * Unit tests for the draft quantity pair — the reading and the gate (`form/quantity.ts`).
 *
 * ⛔ OWNER RULING 2026-09-12 — THE DRAFT'S BOUNDS ARE NORMALISED BEFORE EITHER FUNCTION READS THEM, and
 * these tests are that rule's specification. Verbatim: *"If the high is not a number, then it should be
 * null - null means there is no high. If high is less than low, then swap the values. If low is not a
 * number, then swap with high and high becomes null."*
 *
 * This REPLACES the behaviour three of the assertions below used to pin: an inverted pair and a
 * high-without-low both used to read as `absent` and be refused by the gate. They are now repaired
 * rather than refused, so the cook's numbers survive.
 *
 * ⚠️ Why the rule had to exist at all: the two functions DISAGREED on a non-finite upper bound. The gate
 * filtered the bad high away, saw a lone lower bound and answered `stated`; the reading handed the raw
 * pair on and answered `absent`. So `{quantity: 2, quantityHigh: NaN}` passed validation and reached the
 * wire as "no amount" — the cook's 2 gone, with no error anywhere. Both functions now read through ONE
 * normaliser, so that class of divergence is unrepresentable rather than merely fixed.
 *
 * ⛔ "Not a number" and "not a valid AMOUNT" are the same thing here (owner ruling, same day). One
 * predicate governs both bounds — recipe-core's own `isAmount`: finite AND greater than zero — so `NaN`,
 * `±Infinity`, `0` and negatives are all handled by the three rules above rather than by a second branch.
 *
 * ⚠️ CONSEQUENCE WORTH KNOWING: after normalisation the pair can no longer contradict itself, so the
 * `invalid` verdict — and the `quantityInvalid` error the cook sees — now means ONLY "outside the wire's
 * allowed range" (below `MIN_RECIPE_INGREDIENT_QUANTITY`, or above the max). It no longer means "these two
 * numbers disagree", because that state is now repaired instead of reported.
 */
import { describe, expect, it } from 'vitest';

import { draftQuantity, draftQuantityVerdict } from '../quantity.js';
import type { RecipeFormIngredient } from '../values.js';

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
    it('SWAPS an inverted pair rather than discarding it (owner ruling)', () => {
        expect(draftQuantity(line({ quantity: 3, quantityHigh: 2 }))).toEqual({ kind: 'range', low: 2, high: 3 });
    });

    it('promotes a high with no low to the low, dropping the high (owner ruling)', () => {
        expect(draftQuantity(line({ quantity: Number.NaN, quantityHigh: 3 }))).toEqual({ kind: 'exact', value: 3 });
    });

    it('drops a non-finite high and keeps the low — the case that used to lose the amount', () => {
        expect(draftQuantity(line({ quantity: 2, quantityHigh: Number.NaN }))).toEqual({ kind: 'exact', value: 2 });
        expect(draftQuantity(line({ quantity: 2, quantityHigh: Number.POSITIVE_INFINITY }))).toEqual({
            kind: 'exact',
            value: 2,
        });
    });

    it('still reads a wholly unstated pair as `absent`', () => {
        expect(draftQuantity(line({ quantity: Number.NaN, quantityHigh: Number.NaN }))).toEqual({ kind: 'absent' });
    });

    it('collapses coincident bounds to `exact`, so one amount has one representation', () => {
        expect(draftQuantity(line({ quantity: 2, quantityHigh: 2 }))).toEqual({ kind: 'exact', value: 2 });
    });
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

    it('ADMITS an upper bound with no lower bound — it becomes the amount (owner ruling)', () => {
        expect(draftQuantityVerdict(line({ quantity: Number.NaN, quantityHigh: 3 }))).toBe('stated');
    });

    it('ADMITS an inverted pair — the bounds are swapped, not refused (owner ruling)', () => {
        expect(draftQuantityVerdict(line({ quantity: 3, quantityHigh: 2 }))).toBe('stated');
    });

    it('treats a 0 BOUND exactly like NaN — dropped as a high, swapped out as a low', () => {
        // ⛔ OWNER RULING: "not a number and not a valid amount should be treated the same". So ONE
        // predicate governs, and it is recipe-core's own `isAmount` — finite AND greater than zero. A lone
        // `0` states no amount; a `0` upper bound is dropped and the lower one survives; a `0` LOWER bound
        // is swapped out by its valid high.
        expect(draftQuantity(line({ quantity: 2, quantityHigh: 0 }))).toEqual({ kind: 'exact', value: 2 });
        expect(draftQuantity(line({ quantity: 0, quantityHigh: 2 }))).toEqual({ kind: 'exact', value: 2 });
    });

    it('reads a stated zero or negative as ABSENT — REVERSED by the 2026-09-12 owner ruling', () => {
        // ⚠️ THIS TEST USED TO ASSERT `invalid`, and it was right until the ruling that "not a number and
        // not a valid amount should be treated the same". A typed `0` is now normalised away like `NaN`, so
        // the line states no amount and is submittable. Rewritten to prove the new behaviour rather than
        // deleted, because the INPUT class still needs an owner: without this, nothing pins what a typed
        // zero does. The `invalid` verdict now belongs to the wire-bounds case alone, asserted below.
        expect(draftQuantityVerdict(line({ quantity: 0 }))).toBe('absent');
        expect(draftQuantityVerdict(line({ quantity: -1 }))).toBe('absent');
    });

    it('rejects a bound the storage column cannot hold, on EITHER side of the range', () => {
        // Composes the wire's own per-bound schema, so a bound outside 0.001 .. 1 000 000 is refused here
        // rather than round-tripping to a 400 — and the UPPER bound is checked too, which a validator
        // written against the old scalar would have missed entirely.
        expect(draftQuantityVerdict(line({ quantity: 0.0001 }))).toBe('invalid');
        expect(draftQuantityVerdict(line({ quantity: 1, quantityHigh: 1_000_001 }))).toBe('invalid');
    });
});

describe('the reading and the gate, compared — cross-function properties', () => {
    const line = (over: Partial<RecipeFormIngredient> = {}): RecipeFormIngredient => ({
        ingredientId: '00000000-0000-4000-8000-0000000000aa',
        name: 'Flour',
        quantity: 2,
        ...over,
    });

    it('⛔ refuses a bound below the wire floor, which the READING accepts — the intended asymmetry', () => {
        // ⛔ DO NOT "FIX" THIS INTO A BICONDITIONAL. `draftQuantity` answers `exact 0.0001` here, because
        // recipe-core's `isAmount` asks only "finite and positive". The verdict refuses it, because it
        // composes `ingredientQuantitySchema`, which applies MIN_RECIPE_INGREDIENT_QUANTITY (0.001). That
        // asymmetry is the whole point of composing the union rather than checking a scalar: a validator
        // written against the scalar would have checked only the LOWER bound. Relaxing the verdict to agree
        // with the reading here would delete that protection.
        expect(draftQuantity(line({ quantity: 0.0001 }))).toEqual({ kind: 'exact', value: 0.0001 });
        expect(draftQuantityVerdict(line({ quantity: 0.0001 }))).toBe('invalid');
    });
});

describe('⛔ THE READING AND THE GATE CANNOT DISAGREE — one normaliser, asserted as a property', () => {
    const line = (over: Partial<RecipeFormIngredient> = {}): RecipeFormIngredient => ({
        ingredientId: '00000000-0000-4000-8000-0000000000aa',
        name: 'Flour',
        quantity: 2,
        ...over,
    });

    // ⛔ THE MUTANT THIS EXISTS TO KILL: re-introducing a second, private reading of the bounds in either
    // function. The defect this replaced was exactly that — the gate filtered non-finite bounds itself
    // while the reading passed them straight to `statedQuantity`, so the two answered different questions
    // about the same line and the wire mapper silently dropped a stated amount. Both now read through the
    // SAME normaliser, so the implication below is structural rather than coincidental.
    //
    // ⛔ IT IS ONE-DIRECTIONAL, AND MUST STAY SO. The converse fails BY DESIGN on a sub-floor amount:
    // `0.0001` reads as `exact` (recipe-core's `isAmount` asks only "finite and positive") while the gate
    // refuses it, because the gate composes the wire's own `ingredientQuantitySchema`, which applies
    // MIN_RECIPE_INGREDIENT_QUANTITY. A biconditional would go red there and the tempting repair would be
    // to relax the gate — deleting the bound check that catches an UPPER bound a scalar check cannot see.
    const pairs: readonly Partial<RecipeFormIngredient>[] = [
        { quantity: 2 },
        { quantity: 2, quantityHigh: 3 },
        { quantity: 3, quantityHigh: 2 },
        { quantity: 2, quantityHigh: 2 },
        { quantity: 2, quantityHigh: Number.NaN },
        { quantity: 2, quantityHigh: Number.POSITIVE_INFINITY },
        { quantity: Number.NaN, quantityHigh: 3 },
        { quantity: Number.NaN, quantityHigh: Number.NaN },
        { quantity: Number.NEGATIVE_INFINITY, quantityHigh: 5 },
        { quantity: 0 },
        { quantity: -1 },
        { quantity: 2, quantityHigh: 0 },
        { quantity: 0.0001 },
    ];

    it('a line the gate calls `stated` always reads as a real amount — never `absent`', () => {
        const lost = pairs
            .filter((over) => draftQuantityVerdict(line(over)) === 'stated')
            .filter((over) => draftQuantity(line(over)).kind === 'absent');

        expect(lost).toEqual([]);
    });

    it('a line the gate calls `absent` reads as absent too, so "no amount" means the same thing to both', () => {
        const disagreed = pairs
            .filter((over) => draftQuantityVerdict(line(over)) === 'absent')
            .filter((over) => draftQuantity(line(over)).kind !== 'absent');

        expect(disagreed).toEqual([]);
    });

    it('⚠️ the converse genuinely fails on a sub-floor amount — pinned so nobody "completes" the property', () => {
        expect(draftQuantity(line({ quantity: 0.0001 }))).toEqual({ kind: 'exact', value: 0.0001 });
        expect(draftQuantityVerdict(line({ quantity: 0.0001 }))).toBe('invalid');
    });
});
