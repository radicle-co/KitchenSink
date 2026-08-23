/**
 * THE READ SIDE of the U11 verification gate (plan U14 / R15) — the pure rules that decide which verdict a
 * recipe line is about, and what that verdict means for the cook looking at the line.
 *
 * DESIGN PATTERN: a pure Specification/Policy module, the sibling of `./provenancePolicy.ts`,
 * `./visibilityPolicy.ts` and `./nutritionState.ts`. It performs no I/O: it is handed a line's own columns
 * and the band a reader already fetched, and it returns the answer. The Repository that fetches the band is
 * `../dal/lineVerifications.dal.ts`.
 *
 * ## ⛔ WHY THIS EXISTS AT ALL — the gate was WRITE-ONLY
 *
 * `recipe-workers` records a verdict into `recipe_ingredient_verifications` (migration 0023) and nothing in
 * any service ever selected from it. A disagreement was durably stored and structurally unable to reach a
 * cook. This module is the first half of closing that: it names the join, and it names what the join means.
 *
 * ## ⛔ ONE DERIVATION, USED BY BOTH ENDS
 *
 * {@link verifiedLineIdentity} is the SINGLE mapping from a `recipe_ingredients` row onto the tuple a verdict
 * is keyed on, and the U11 PRODUCER (`./verificationRequests.ts`) goes through it too — it does not derive
 * the same tuple beside it. That is not tidiness: the verdict table is content-addressed, so these two
 * derivations ARE the join. A field spelled differently on one side means the worker writes a row under one
 * key and this service looks for it under another, and because absence of a verdict means PUBLISH the
 * mismatch does not raise, does not log and does not withhold — it reports "the gate has judged nothing"
 * forever while the gate judges, and is billed for, every line. `verificationRequests.ts` named this risk in
 * its own docstring; a second column→tuple mapping is exactly the shape it warned about.
 * `verificationIdentityParity.test.ts` asserts the two ends agree, in both directions.
 *
 * ## ⛔ THE IDENTITY MUST MATCH WHAT THE WORKER HASHED, BYTE FOR BYTE
 *
 * A verdict is keyed on `verificationKey()` — a digest over `[version, normalizedLine, foodId, quantityLow,
 * quantityHigh, unit, statedMeasure]` (`@kitchensink/recipe-core/resolution/verification-key`). A reader that
 * assembles that tuple even slightly differently computes a key that matches no row, reports "no verdict" for
 * every line, and looks completely healthy while doing it — because ABSENCE OF A VERDICT MEANS PUBLISH.
 *
 * ⚠️ The last member is the newest and the easiest to drop. `statedMeasure` is what the SOURCE printed before
 * the importer restated a historical unit (migration 0027), and it is in the key because it changes what the
 * model is SHOWN and therefore what it concludes — see `verificationKey.ts` for why leaving it out would have
 * served a pre-0027 false DISAGREE to a corrected line forever.
 *
 * ⚠️ So {@link verifiedLineIdentity} is the ONE authoritative mapping from a `recipe_ingredients` row onto
 * that tuple, and the queue PRODUCER that enqueues a line for verification must build its message from this
 * function rather than re-deriving the same five fields beside it. The trap it closes: `recipe_ingredients.
 * unit` is `NOT NULL` and spells "unitless" as the EMPTY STRING, while `lineVerificationMessageSchema.unit`
 * is `string | null`. The empty string and `null` are different JSON preimages, so a producer that forwards
 * `row.unit` verbatim and a reader that converts it would never agree on a single unitless line — "2 eggs",
 * "1 lemon", every count line in the corpus.
 *
 * ## ⚠️ ABSENCE OF A ROW MEANS PUBLISH, AND THAT IS NOT A DEFAULT — IT IS THE CONTRACT
 *
 * Migration 0023's header settles it: the gate runs off a queue, so a line publishes between save and
 * verification no matter what the table says. The only coherent read-side rule is "an explicit contradiction
 * withholds, everything else behaves exactly as it did before the gate existed". That is also what makes a
 * LOST verdict benign, which is what lets the worker swallow a failed verdict write without re-paying for
 * the call.
 */
import {
    FoodResolutionStatus,
    type IngredientQuantity,
    type LineResolutionStatus,
    type StatedMeasure,
} from '@kitchensink/recipe-core';
import type { StatedMeasureIdentity, VerifiedLineIdentity } from '@kitchensink/recipe-core/resolution/verification-key';

/**
 * The bands migration 0023's `recipe_ingredient_verifications_band_check` admits.
 *
 * ⛔ Declared here as the READER's floor rather than imported from the worker: `recipe-workers` is a separate
 * deployable that this service does not and must not depend on. The database CHECK is the shared authority,
 * and `__tests__/integration/ingredients/verificationSchema.integration.test.ts` is what proves the two
 * spellings still agree.
 */
export const VERIFICATION_BANDS = ['verified', 'contradicted', 'inconclusive'] as const;

/** The collapsed judgement the gate recorded about one line. */
export type VerificationBand = (typeof VERIFICATION_BANDS)[number];

/**
 * The columns of one `recipe_ingredients` row a verdict's identity is derived FROM.
 *
 * ⛔ Deliberately the STRUCTURAL MINIMUM, so the producer's richer `VerifiableLine`
 * (`./verificationRequests.ts`, which also carries `foodId` and `candidateFoodName`) is assignable to it and
 * both ends can go through the ONE derivation below. Widen this and the two ends can start disagreeing again.
 *
 * `sourceLine` admits `null` AND `undefined` for the same reason: the read path holds a Drizzle column
 * (`null`) and the producer holds an adapted projection (`undefined`), and both mean "this line was AUTHORED,
 * not transcribed". Forcing either to convert would put a second spelling of that fact in the codebase.
 */
export interface JudgeableLine {
    /**
     * The raw line the cook's SOURCE stated (migration 0024). Absent when the line was AUTHORED rather than
     * transcribed — there is no source for our parse to disagree with.
     */
    readonly sourceLine: string | null | undefined;
    /** What the source stated: one value, two bounds, or nothing (U8/KTD-6). */
    readonly quantity: IngredientQuantity;
    /** The parsed unit. `NOT NULL` in the database; blank means unitless. */
    readonly unit: string;
    /**
     * What the SOURCE printed, when {@link quantity}/{@link unit} are a RESTATEMENT of it (migration 0027).
     *
     * ⛔ A REQUIRED KEY carrying `undefined`, deliberately, and not `statedMeasure?:`. Every construction
     * site of this shape — the read path, the queue producer, the parity test — must make a decision about
     * it, because a site that forgets it would key the judgement the pre-0027 way while the model is shown
     * the post-0027 numbers, and the only symptom would be a verdict nobody can find. `sourceLine` above
     * carries the same shape for the same reason.
     */
    readonly statedMeasure: StatedMeasure | undefined;
}

/**
 * The tuple a verdict about this line would be keyed on, or `undefined` when no verdict about it can exist.
 *
 * Two lines can never be judged and both return `undefined` rather than a half-built identity: a line with
 * no source text (nothing to check our parse against) and a freeform line with no food (nothing to check it
 * against). Both are ordinary states, not failures — `decideVerification` skips them on the write side too.
 *
 * @param line - The line's own columns.
 * @param foodId - The opaque food-service id the line's ingredient resolved to, if any.
 * @returns The identity to hash, or `undefined` when this line is unjudgeable. Pure.
 */
export function verifiedLineIdentity(
    line: JudgeableLine,
    foodId: string | undefined,
): VerifiedLineIdentity | undefined {
    if (foodId === undefined || line.sourceLine === null || line.sourceLine === undefined) {
        return undefined;
    }

    if (line.sourceLine.trim() === '') {
        // A source line with no visible content is not a transcription. The producer reaches the same
        // conclusion through `decideVerification`'s `skip: 'no-source-text'`; stating it here too is what
        // lets this function be TOTAL rather than only correct for inputs the producer already filtered.
        return undefined;
    }

    return {
        sourceLine: line.sourceLine,
        foodId,
        quantityLow: quantityLowOf(line.quantity),
        quantityHigh: line.quantity.kind === 'range' ? line.quantity.high : null,
        unit: unitOf(line.unit),
        // ⛔ BESIDE the restated pair, never instead of it. The restated pair still keys the row because it is
        // what nutrition is computed from and what U14's reader holds; the stated pair is what the model is
        // asked about, and it is in the key because it changes the judgement (see `verificationKey.ts`).
        statedMeasure: statedMeasureIdentityOf(line.statedMeasure),
    };
}

/**
 * The stated measure in the digest's spelling: two bounds and a unit, or `null`.
 *
 * ⛔ `null` rather than an omitted member, matching the way an exact quantity reports `quantityHigh: null`.
 * The identity's member is REQUIRED, so "this line was not restated" is a value rather than an absence, and a
 * caller cannot express it by forgetting.
 *
 * @param measure - What the source printed, when the line was restated.
 * @returns The identity member. Pure.
 */
function statedMeasureIdentityOf(measure: StatedMeasure | undefined): StatedMeasureIdentity | null {
    if (measure === undefined) {
        return null;
    }

    const { quantity } = measure;

    // ⛔ NOT `quantityLowerBound`/`quantityUpperBound`. Those answer "the largest amount the line admits",
    // whose right answer for an EXACT quantity is the value itself — and repeating a value into
    // `quantityHigh` is exactly the spelling this contract does not use (see `verifiedLineIdentity` above,
    // which makes the same choice for the restated pair). `StatedAmount` has no `absent` member, so this
    // switch is total over two cases rather than three.
    return quantity.kind === 'exact'
        ? { quantityLow: quantity.value, quantityHigh: null, unit: measure.unit }
        : { quantityLow: quantity.low, quantityHigh: quantity.high, unit: measure.unit };
}

/**
 * The unit as the wire contract states it: the value, or `null` when the parser found none.
 *
 * ⛔ `trim()`, NOT `=== ''`, and that is a REACHABLE difference rather than defensive tidiness.
 * `recipeIngredientUnitSchema` is `z.string().min(1)` with no `.trim()`, so a single SPACE passes the wire
 * and is persisted verbatim into a `NOT NULL` column. Comparing against `''` alone would make the reader
 * treat `' '` as the unit while the producer treats it as none — two keys for one judgement, and every
 * verdict for such a line silently unfindable. Caught by `verificationIdentityParity.test.ts`.
 *
 * ⚠️ The value itself is NOT trimmed when it survives: `' cup '` keys as `' cup '`. Trimming the returned
 * value would be a second normalization on top of the one `verificationKeyPreimage` already performs, and it
 * would re-partition every verdict already written.
 *
 * @param unit - The persisted unit, where blank means the parser found none.
 * @returns The unit, or `null`. Pure.
 */
function unitOf(unit: string): string | null {
    return unit.trim() === '' ? null : unit;
}

/**
 * The status ONE recipe line reports, given whatever the gate concluded about it and whatever the shared
 * catalog says about its food.
 *
 * ⛔ Only `contradicted` overrides. The switch is exhaustive over {@link VerificationBand} with NO default
 * branch, so a fourth band added to migration 0023 is a COMPILE error here rather than a line that silently
 * keeps publishing under a judgement nobody taught this function to read.
 *
 * ⛔ `NEEDS_REVIEW` is returned, never WRITTEN. It rides `RecipeIngredientView.resolutionStatus` — one recipe
 * line — and never `ingredients.food_resolution_status`, whose blast radius is every recipe in the system
 * that references the same food (0023's first reason).
 *
 * @param band - The gate's verdict for this line, or `undefined` when it has not judged it.
 * @param catalogStatus - The shared catalog row's own food-resolution status, if it has one.
 * @returns The status the line reports, or `undefined` when it has nothing to report. Pure.
 */
export function resolveLineStatus(
    band: VerificationBand | undefined,
    catalogStatus: LineResolutionStatus | undefined,
): LineResolutionStatus | undefined {
    if (band === undefined) {
        return catalogStatus;
    }

    switch (band) {
        case 'contradicted':
            return FoodResolutionStatus.NEEDS_REVIEW;
        case 'verified':
        case 'inconclusive':
            return catalogStatus;
    }
}

/**
 * Whether a verdict WITHHOLDS this line's catalog nutrition from the recipe's figure.
 *
 * Stated as its own predicate rather than inlined at the two call sites, so "withheld" has one definition:
 * the nutrition classifier and the line projection cannot disagree about which lines were held back.
 *
 * @param band - The gate's verdict for this line, or `undefined`.
 * @returns `true` only for an explicit contradiction. Pure.
 */
export function isWithheld(band: VerificationBand | undefined): boolean {
    return band === 'contradicted';
}

/** The low bound of a quantity in the digest's spelling: the value, the range's low, or `null`. Pure. */
function quantityLowOf(quantity: IngredientQuantity): number | null {
    switch (quantity.kind) {
        case 'exact':
            return quantity.value;
        case 'range':
            return quantity.low;
        case 'absent':
            // ⛔ NOT `0` and NOT `1`. `null` is the digest's spelling of "the source stated no amount", and a
            // fabricated number would key the verdict to a quantity nobody wrote.
            return null;
    }
}
