/**
 * WHAT THE SOURCE PRINTED, before we restated it into a unit the food catalog can weigh (plan U7 R35 / U11).
 *
 * DESIGN PATTERN: Value Object composed from two existing ones — {@link StatedAmount} and the unit bound —
 * mirroring `HistoricalUnitConversion.stated` in `@kitchensink/cookbook-import`'s `unitEquivalence.ts`, which
 * is the shape that PRODUCES it.
 *
 * ## ⛔ WHY IT HAS TO CROSS THE WIRE, AND WHY THAT REVERSES A RECORDED PREMISE
 *
 * The importer restates a historical measure at parse time. `convertHistoricalUnit` reads `one gill of milk`
 * and returns both halves — `stated: 1 gill`, `restated: 0.5 cup` — because the USDA household-portion table
 * carries `cup` and has never heard of a gill. `restateHistoricalUnit` then OVERWRITES the candidate line's
 * `quantity`/`unit` with the restated pair, and only that pair reached this service. The source's own amount
 * survived as prose, in `notes` and `sourceLine`.
 *
 * U11's verification gate builds its question from the persisted `quantity`/`unit`, so the model was shown a
 * source line reading `one gill of milk` beside a parse claiming `0.5 cup` and asked whether they agree. They
 * do not — and the model is RIGHT to say so, about a line we parsed correctly. That is a manufactured FALSE
 * DISAGREE, and U11 names the false-disagree rate as "the number that triggers a rethink": a wrong AGREE
 * passes data that would have shipped anyway, while a wrong DISAGREE withholds nutrition from a correct line.
 *
 * ⚠️ Two shipped docstrings argued the opposite and are corrected alongside this module. `RangeDerivedBound`
 * (`./nutrition.ts`) and `RecipeNutrition.rangeDerivedBound` (`./recipe.types.ts`) both reasoned that a
 * historical unit "is restated at IMPORT time, upstream of the wire and by a tool, so there is no read-time
 * step to disclose and no column to disclose it in", and told the reader not to "restore the symmetry". The
 * gate IS a read-time consumer, and the premise is false. What is still true — and is why this is not the
 * symmetry those notes refused — is that the marker stays OFF the response wire: `RecipeIngredient` carries
 * neither this nor `sourceLine`. Both are write-side provenance the gate reads, not fields a cook is shown.
 *
 * ## ⛔ THE QUANTITY CANNOT BE `absent`, AND THAT IS ENFORCED BY THE TYPE
 *
 * `IngredientQuantity` has an `absent` member for `butter the size of an egg` (R40/R41). A restatement OF
 * nothing is not a thing: `convertHistoricalUnit` refuses an absent quantity outright, and a NULL
 * `stated_quantity` beside a non-NULL `stated_unit` is what `recipe_ingredients_stated_measure_coherent`
 * rejects — a 500 where a 400 belongs. So this composes {@link statedAmountSchema}, the same union minus that
 * member, rather than admitting it and refining it away.
 */
import { z } from 'zod';

import { statedAmountSchema, type StatedAmount } from './ingredientQuantity.js';
import { recipeIngredientUnitSchema } from './recipeRequestBounds.js';

/** The amount and unit a cook's source PRINTED, when we restated it into one the catalog can weigh. */
export interface StatedMeasure {
    /** What the source stated. Never `absent` — see the module docstring. */
    readonly quantity: StatedAmount;
    /**
     * The unit the source printed (`gill`, `wineglass`, `saltspoon`).
     *
     * ⛔ `.min(1)`, so "unitless" is NOT spellable. `recipe_ingredients.unit` spells unitless as `''` and a
     * restatement is never FROM nothing; a blank here would be a second spelling of "this line has no stated
     * measure" beside the one that means it — omitting the whole object.
     */
    readonly unit: string;
}

/**
 * The WIRE form of {@link StatedMeasure}.
 *
 * `z.strictObject` for the reason `ingredientQuantitySchema` states: a mis-spelled member silently stripped
 * would persist a measure the caller did not mean. The pair is ALL-OR-NOTHING — half a restatement cannot
 * name what it converted FROM, which is exactly the disclosure R35 exists to force — so absence is spelled by
 * omitting the whole object, and both members are required.
 *
 * ⚠️ NO maximum on `unit`, matching `recipeIngredientUnitSchema` and the `text` column it writes. The gate's
 * QUEUE contract bounds it at 64 code points instead, because that value reaches a prompt and ADR-0024 §2
 * makes a hard input cap a precondition of the spend reservation. That asymmetry is deliberate and is the
 * same one `verifyIngredientLineMessageSchema.unit` already documents.
 */
export const statedMeasureSchema: z.ZodType<StatedMeasure> = z.strictObject({
    quantity: statedAmountSchema,
    unit: recipeIngredientUnitSchema,
});
