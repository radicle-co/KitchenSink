/**
 * How much of an ingredient a recipe calls for — as a VALUE OBJECT rather than a nullable scalar.
 *
 * DESIGN PATTERN: Value Object + smart constructor, over a discriminated union whose exhaustive `switch`
 * is the Visitor a caller needs. There is no class and none is wanted: the union IS the type, and
 * {@link statedQuantity} is the only door into it.
 *
 * ## Why the union, and not `quantity` plus a loose `quantityHigh`
 *
 * A recipe line states one of exactly three things, and the pair-of-numbers shape can spell states that
 * are none of them: an upper bound below its lower, an upper bound with no lower, and — the one that
 * shipped — a `0` doing double duty as "the source stated no amount". Modelling the three cases as
 * members makes those unrepresentable rather than merely invalid, so no consumer has to re-check them.
 *
 * ⛔ `absent` is NEVER a zero and never a fabricated `1` (R40). A 1900s cookbook says "butter the size of
 * an egg", and the honest reading of that line is that it states no number — not that it states none of
 * something.
 *
 * ## This module is ON the barrel, and that is a deliberate reversal (U8)
 *
 * U7 landed it as the subpath-only `@kitchensink/recipe-core/ingredient-quantity`, because the barrel is
 * inside recipe-service's `CONTRACT_HASH` fingerprint and adding to it — even a comment — moves the hash.
 * U8 widens the wire to carry this very type, so the hash moves anyway and the type belongs where the rest
 * of the wire vocabulary lives. The subpath is GONE: two doors into one module is two places to look.
 *
 * ⛔ Do not confuse this with `scaling.ts`, which is subpath-only for a reason that still holds — it is
 * presentation policy the service never composes. This one IS composed by `recipes.schema.ts`.
 */
import { z } from 'zod';

import { recipeIngredientQuantitySchema } from './recipeRequestBounds.js';

/** A recipe line's stated amount: one value, two bounds, or nothing the source stated. */
export type IngredientQuantity =
    | { readonly kind: 'exact'; readonly value: number }
    | { readonly kind: 'range'; readonly low: number; readonly high: number }
    | { readonly kind: 'absent' };

/** The one representation of "the source stated no amount" (R40, R41). */
export const ABSENT_QUANTITY: IngredientQuantity = Object.freeze({ kind: 'absent' });

/** An amount is a positive, finite number of something; `0`, `-1` and `NaN` are not amounts. */
function isAmount(value: number): boolean {
    return Number.isFinite(value) && value > 0;
}

/**
 * Build the quantity a source line states.
 *
 * @param low - The stated amount, or the lower bound of a stated range.
 * @param high - The upper bound, when the line stated a range (`"2 to 3 cups"`).
 * @returns The value object, or `null` when the bounds describe no amount the source could have stated —
 *   a non-positive or non-finite bound, or an upper bound below its lower. `null` is a PARSE FAILURE the
 *   caller must report, deliberately not a fourth member: "these two numbers disagree" is a fact about
 *   the reading, not a state a recipe can be in. Pure.
 */
export function statedQuantity(low: number, high?: number | null): IngredientQuantity | null {
    if (!isAmount(low)) {
        return null;
    }

    if (high === undefined || high === null) {
        return Object.freeze({ kind: 'exact', value: low });
    }

    if (!isAmount(high) || high < low) {
        return null;
    }

    // A range whose bounds coincide is one value, and one value has ONE representation.
    return high === low ? Object.freeze({ kind: 'exact', value: low }) : Object.freeze({ kind: 'range', low, high });
}

/**
 * The smallest amount the line admits.
 *
 * @param quantity - The stated quantity.
 * @returns The lower bound, or `null` when the source stated no amount. An exact quantity reports itself,
 *   because `"2 cups"` is the range 2 to 2. Pure.
 */
export function quantityLowerBound(quantity: IngredientQuantity): number | null {
    switch (quantity.kind) {
        case 'exact':
            return quantity.value;
        case 'range':
            return quantity.low;
        case 'absent':
            return null;
    }
}

/**
 * The largest amount the line admits.
 *
 * @param quantity - The stated quantity.
 * @returns The upper bound, or `null` when the source stated no amount. Pure.
 */
export function quantityUpperBound(quantity: IngredientQuantity): number | null {
    switch (quantity.kind) {
        case 'exact':
            return quantity.value;
        case 'range':
            return quantity.high;
        case 'absent':
            return null;
    }
}

/**
 * Whether two quantities state the same amount — the value object's own identity-by-value. Pure.
 *
 * ⚠️ EXISTS BECAUSE `!==` SILENTLY CHANGED MEANING. Both change detectors in this system compared the old
 * scalar with `!==`: `ingredientContentChanged` (the version diff) and `ingredientsChanged` (the service's
 * C-004 substantive-edit test). Against an OBJECT that operator is reference identity, so every ingredient
 * would have read as modified on every diff and every metadata-only PATCH would have minted a new version.
 * Neither would have failed to compile, and neither would have looked wrong in review.
 *
 * @param left - One quantity.
 * @param right - The other.
 * @returns `true` when both name the same member with the same bounds.
 */
export function quantitiesEqual(left: IngredientQuantity, right: IngredientQuantity): boolean {
    switch (left.kind) {
        case 'exact':
            return right.kind === 'exact' && right.value === left.value;
        case 'range':
            return right.kind === 'range' && right.low === left.low && right.high === left.high;
        case 'absent':
            return right.kind === 'absent';
    }
}

/**
 * The WIRE form of {@link IngredientQuantity} — a discriminated union, so the request contract can spell
 * exactly the three states the domain admits and no others.
 *
 * ⛔ NOT `quantity?: number` plus `quantityHigh?: number`. That pair type-checks four extra states the
 * product has no reading for (`high` with no `low`, `high < low`, `high === low`, and a `0` meaning
 * "unstated"), and a `.refine` rejecting them at the boundary still leaves every downstream consumer
 * holding a type that admits them. Following ADR-0023's `recipeSourceInputSchema`, which chose a union over
 * optional fields for the same reason.
 *
 * `z.strictObject` members, deliberately: this schema is the REQUEST carrier, and the failure it forecloses
 * is a client that means `2 to 5`, mis-spells the member, and has its upper bound silently stripped —
 * persisting an exact `2` with a `200`. Response schemas in this repo are non-strict, but every producer of
 * this shape is regenerated from this file in lockstep (ADR-0014), so strictness costs nothing on the way
 * out.
 *
 * Each bound is `recipeIngredientQuantitySchema`, so a bound the `numeric(10,3)` column cannot store is
 * refused in ONE place rather than three.
 */
export const ingredientQuantitySchema: z.ZodType<IngredientQuantity> = z
    .discriminatedUnion('kind', [
        z.strictObject({ kind: z.literal('exact'), value: recipeIngredientQuantitySchema }),
        z.strictObject({
            kind: z.literal('range'),
            low: recipeIngredientQuantitySchema,
            high: recipeIngredientQuantitySchema,
        }),
        z.strictObject({ kind: z.literal('absent') }),
    ])
    // STRICTLY greater, not `>=`: `statedQuantity` collapses coincident bounds to `exact`, so admitting
    // `low === high` here would give one amount two wire representations — the thing the `''`-is-rejected
    // unit convention exists to prevent.
    .refine((quantity) => quantity.kind !== 'range' || quantity.high > quantity.low, {
        message: 'A quantity range must state an upper bound strictly above its lower bound',
    });
