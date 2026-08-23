import {
    ABSENT_QUANTITY,
    MAX_RECIPE_INGREDIENT_NAME_LENGTH,
    normalizeUnit,
    recipeIngredientQuantitySchema,
    statedQuantity,
    type IngredientQuantity,
} from '@kitchensink/recipe-core';
import { parseIngredient, unitsOfMeasure, type UnitOfMeasureDefinitions } from 'parse-ingredient';

import { HISTORICAL_UNIT_DEFINITIONS } from './historicalUnits.js';
import { normalizeQuantityRange } from './normalizeQuantity.js';
import { findQuantityPhrases } from './quantityPhrases.js';
import { MEASUREMENT_JOIN_SOURCE } from './splitMeasurement.js';

/**
 * The period spellings `parse-ingredient` does not RECOGNISE, taught through its own extension point —
 * the `*ful` family (R31) and the historical measures (R32).
 *
 * R31 has two halves and they live in different places, which is not the duplication it looks like.
 * Canonicalising `teaspoonful` -> `teaspoon` is recipe-core's `UNIT_ALIASES`, and it serves gram
 * conversion for a unit a USER typed. Recognising the word as a unit rather than as the first noun of the
 * description is `parse-ingredient`'s tokenizer, and no table of ours can do it. The two change for
 * different reasons — one tracks our wire's unit strings, the other tracks this library's vocabulary —
 * and recipe-core cannot reach for the library at all: it ships in the Expo bundle, which is the boundary
 * `corpusPipeline.integration.test.ts` asserts this package stays outside of.
 *
 * Measured 2026-08-21 against `parse-ingredient@2.2.0`: `teaspoonful` and `tablespoonful` are already
 * alternates, but `identifyUnit` returns `null` for `teaspoonfuls`, `tablespoonfuls`, `cupful` and
 * `cupfuls` — and `"Drop in tablespoonfuls"` occurs verbatim in the committed corpus slice.
 *
 * Each entry SPREADS the library's own definition rather than restating it, so the conversion factors and
 * existing alternates (`tsp`, `T`, `c.`) cannot drift out from under us.
 */
const IMPORT_UNITS: UnitOfMeasureDefinitions = {
    teaspoon: withAlternates('teaspoon', ['teaspoonfuls']),
    tablespoon: withAlternates('tablespoon', ['tablespoonfuls']),
    cup: withAlternates('cup', ['cupful', 'cupfuls']),
    // R32 — the historical measures, which the library does not define AT ALL (not even a stem to extend).
    // They carry no conversion factor on purpose: what a gill is worth is a fact about the SOURCE BOOK, not
    // about the language. See `historicalUnits.ts`.
    ...HISTORICAL_UNIT_DEFINITIONS,
};

/** One library unit definition with extra spellings appended. Throws at module load if the id is gone. */
function withAlternates(id: string, extra: readonly string[]): UnitOfMeasureDefinitions[string] {
    const base = unitsOfMeasure[id];

    if (base === undefined) {
        throw new Error(`recipe-import-core: parse-ingredient no longer defines the unit "${id}".`);
    }

    return { ...base, alternates: [...base.alternates, ...extra] };
}

/**
 * Why a parsed line still wants a human's eye. A boolean says "something is off"; the draft review has to
 * tell a user "the two bounds this line states disagree" apart from "we could not read this line at all".
 */
export type IngredientReviewReason =
    /** The line was blank. */
    | 'empty_input'
    /** No quantity could be read. The quantity is `absent` — it is NEVER guessed. */
    | 'no_quantity'
    /** A bound was read but is not storable (non-positive, or outside recipe-core's window). */
    | 'quantity_out_of_storage_range'
    /** The line stated an upper bound BELOW its lower one (`"3 to 2 cups"`); neither can be trusted. */
    | 'quantity_bounds_inverted'
    /** The line is a section heading (`"For the sauce:"`), not an ingredient. */
    | 'group_header'
    /** More than one line was passed in, so content beyond the first would be dropped. */
    | 'multiline_input'
    /** The name exceeds what recipe-core will store. It is returned UNCUT; truncation is not this module's. */
    | 'name_too_long'
    /**
     * The line stated a measurement this parse did not read, and it was left sitting in the food name.
     * The persisted quantity therefore UNDERSTATES the line (`"2 cups and 1 tablespoon"` reads as 2 cups).
     * ⚠️ Raised only for a measurement that ADDS. A parenthesised restatement (`"1 pound (about 4 cups)"`)
     * states the same amount twice, so the quantity is already right and only the name needed cleaning.
     */
    | 'measurement_in_name';

/**
 * Reasons meaning "the value we would persist is not the value the source stated" (R39).
 *
 * DESIGN PATTERN: Specification, as data. A caller deciding whether to publish a line needs this
 * distinction and cannot derive it from `needsReview`; re-deriving the list at the call site would be a
 * second representation of this module's own taxonomy, drifting the moment a reason is added here.
 *
 * ⚠️ Membership is "a stated number would be wrong", not "something is missing". `no_quantity` and
 * `empty_input` name an ABSENCE, which the quantity model now represents honestly; `group_header` and
 * `name_too_long` say nothing about a number; `multiline_input` loses trailing lines but does not corrupt
 * the value of the line it returns.
 */
const VALUE_CORRUPTING_REVIEW_REASONS: ReadonlySet<IngredientReviewReason> = new Set([
    'quantity_out_of_storage_range',
    'quantity_bounds_inverted',
    // ⛔ `measurement_in_name` is deliberately NOT here, and the distinction is the one this set's docstring
    // draws: it names something MISSING, not a number that is wrong. Reading 2 cups from "2 cups and 1
    // tablespoon" reads a real amount the source stated and stops short of the rest — the same shape as
    // `no_quantity`, which is also absent from this set.
    // ⚠️ The consequence decided it. `cookbook-import` DROPS a clause whose reading corrupts a value
    // (`proseRecipe.ts`, "a clause whose own reading misstates a value is not an ingredient at any length"),
    // so membership here would discard the whole ingredient rather than surface it — losing 100% of a line
    // to avoid understating it by 3%.
]);

/**
 * Whether a review reason means a persisted value would misstate the source.
 *
 * @param reason - One reason from a parsed line.
 * @returns `true` when publishing the line would assert a number the source did not state. Pure.
 */
export function corruptsStatedValue(reason: IngredientReviewReason): boolean {
    return VALUE_CORRUPTING_REVIEW_REASONS.has(reason);
}

/**
 * One free-text ingredient line, parsed.
 *
 * DESIGN PATTERN: Value Object, produced by an Anti-Corruption Layer — `parse-ingredient`'s array-ness,
 * its `quantity2`/`isGroupHeader` fields and its rounding never escape this module.
 */
export interface ParsedIngredientLine {
    /**
     * The input, byte-identical and UNCONDITIONAL (HAZ-041) — including for a blank line, a heading, or a
     * line no parser could read. It is `raw` relative to THIS function: MOD-018 sanitizes before calling.
     */
    readonly raw: string;
    /**
     * How much the line calls for: an exact amount, a two-bound range, or nothing the source stated.
     *
     * ⛔ `absent` is NEVER a fabricated `1` and never a `0`. Modelling it as a member rather than as a
     * nullable number is what stopped the upper bound of `"2 to 3 cups"` being discarded at one line —
     * `number | null` had nowhere to put it (KTD-6, R36, R40).
     */
    readonly quantity: IngredientQuantity;
    /** The unit, canonicalised by recipe-core's `normalizeUnit`, or `null` when the line states none. */
    readonly unit: string | null;
    /** The ingredient name. Never truncated; see `name_too_long`. */
    readonly name: string;
    /** Exactly `reviewReasons.length > 0`. Named because MOD-018 and the draft model speak in this flag. */
    readonly needsReview: boolean;
    /** Why review is wanted. Empty when the line parsed cleanly. */
    readonly reviewReasons: readonly IngredientReviewReason[];
}

/**
 * Decimal places the `recipe_ingredients.quantity` column keeps (`numeric(10, 3)`).
 *
 * Rounding happens HERE rather than at the INSERT so the value that is range-checked is the value that is
 * stored: `0.0004` rounds to `0.000`, which `CHECK (quantity > 0)` rejects with a `500`, and
 * `MIN_RECIPE_INGREDIENT_QUANTITY` exists in recipe-core for exactly that reason.
 */
const QUANTITY_STORAGE_SCALE = 3;

/**
 * Round an amount to the decimal places `recipe_ingredients.quantity` keeps.
 *
 * Exported because a SECOND producer of a storable quantity now exists: U7's historical-unit conversion
 * (`@kitchensink/cookbook-import`'s `unitEquivalence.ts`) divides one measure by another and lands on
 * 0.6004… for an imperial gill in cups. The column's scale is ONE piece of knowledge, and a private copy
 * of `10 ** 3` beside a second `Math.round` is exactly the drift this repository's DRY rule is about.
 *
 * @param value - Any amount.
 * @returns The amount as the column would store it. Pure.
 */
export function roundToQuantityStorageScale(value: number): number {
    const factor = 10 ** QUANTITY_STORAGE_SCALE;

    return Math.round(value * factor) / factor;
}

/** A bound rounded to what the column keeps, or `null` when there is no readable number here. */
function toStorableBound(value: number | null): number | null {
    return value === null || !Number.isFinite(value) ? null : roundToQuantityStorageScale(value);
}

/**
 * Both bounds, taken from ONE source.
 *
 * ⚠️ Never a bound from each. `normalizeQuantityRange` and `parse-ingredient` disagree about notations by
 * design — this module exists because the latter TRUNCATES a numeral at six digits — so pairing our lower
 * bound with its upper would produce a range neither reader ever saw.
 */
function readBounds(
    range: ReturnType<typeof normalizeQuantityRange>,
    entry: { readonly quantity: number | null; readonly quantity2: number | null },
): { readonly low: number | null; readonly high: number | null } {
    if (range.low !== null) {
        return { low: range.low.valueOf(), high: range.high?.valueOf() ?? null };
    }

    return { low: entry.quantity, high: entry.quantity2 };
}

/**
 * Parse one free-text ingredient line into a quantity, unit and name (MOD-019, FR-020).
 *
 * DESIGN PATTERN: Facade over a three-stage pipeline — `normalizeQuantityRange` (prose to numeral) ->
 * `parse-ingredient` (unit + description) -> recipe-core's schema (what is storable).
 *
 * ⚠️ The quantity is taken from `normalizeQuantityRange` whenever it read ANYTHING, and falls back to
 * `parse-ingredient` only for notations this package's grammar does not cover at all — a quantity that is
 * not at the head of the line (`"Juice of 3 lemons"`). That order is not a preference:
 * `parse-ingredient@2.2.0` was measured on 2026-08-19 to TRUNCATE a numeral at six digits —
 * `"1000001 cups water"` comes back as `quantity: 100000`, a plausible wrong number that is inside the
 * storable window and would therefore be persisted without a flag.
 *
 * Pure and TOTAL. Never throws; there is no error channel, because an unparseable line is DATA the draft
 * carries forward, not a failure that aborts the import.
 *
 * @param raw - One already-sanitized ingredient line.
 * @returns The parse, with `raw` always retained and every incompleteness named in `reviewReasons`.
 */
export function parseIngredientLine(raw: string): ParsedIngredientLine {
    const reasons: IngredientReviewReason[] = [];

    if (raw.trim() === '') {
        return {
            raw,
            quantity: ABSENT_QUANTITY,
            unit: null,
            name: '',
            needsReview: true,
            reviewReasons: ['empty_input'],
        };
    }

    const range = normalizeQuantityRange(raw);
    const entries = parseIngredient(range.line, { additionalUOMs: IMPORT_UNITS });
    const entry = entries[0];

    if (entry === undefined) {
        return {
            raw,
            quantity: ABSENT_QUANTITY,
            unit: null,
            name: '',
            needsReview: true,
            reviewReasons: ['empty_input'],
        };
    }

    if (entries.length > 1) {
        reasons.push('multiline_input');
    }

    if (entry.isGroupHeader) {
        reasons.push('group_header');
    }

    const quantity = readQuantity(readBounds(range, entry), reasons);
    const unit = entry.unitOfMeasure === null ? null : normalizeUnit(entry.unitOfMeasure) || null;
    const name = takeMeasurementOutOf(entry.description, reasons);

    if (name.length > MAX_RECIPE_INGREDIENT_NAME_LENGTH) {
        reasons.push('name_too_long');
    }

    return { raw, quantity, unit, name, needsReview: reasons.length > 0, reviewReasons: reasons };
}

/**
 * A parenthesised group, closed or running to the end.
 *
 * ⛔ Only stripped when it CONTAINS a quantity. "(about 4 cups)" restates the amount and is not part of the
 * food; "(a family recipe)" is prose about the food and must survive — the difference is whether an amount
 * is in there, which `findQuantityPhrases` answers without this module owning a number lexicon.
 */
const PARENTHESISED = /\s*\(([^)]*)\)?/gu;

/**
 * A leading conjunction introducing a second measurement — the remainder `parse-ingredient` did not read.
 *
 * ⚠️ Anchored at the START, because this runs on what is LEFT after the leading quantity was taken. A
 * conjunction anywhere else joins words in the food's own name ("salt and pepper"), which must not be cut.
 *
 * ⛔ Built from `MEASUREMENT_JOIN_SOURCE` rather than written out, so the digit lookahead cannot be lost
 * here while surviving there. It was, once: an "and" cut without that lookahead splits "One and one-half"
 * and publishes a third of the stated quantity.
 */
const LEADING_JOIN = new RegExp(`^\\s*${MEASUREMENT_JOIN_SOURCE}`, 'iu');

/**
 * Take a measurement out of the food name, naming the case where doing so leaves the quantity understated.
 *
 * ⛔ THE DEFECT THIS CLOSES. `parse-ingredient` reads the LEADING quantity and calls everything after it the
 * food, so a line stating a second measurement puts it in the name — "and 1 tablespoon all-purpose flour"
 * and "(about 4 cups) shredded cooked chicken", both measured 2026-08-23 with `reviewReasons` EMPTY. A name
 * carrying a measurement matches no catalog row, and an empty reason means nobody is asked to fix it.
 *
 * ⚠️ It does not need to recognise every join. Whatever it fails to strip stays in the name and is FLAGGED
 * by the residual check below, so an unrecognised ampersand or comma is visible rather than silent — which
 * is the property that lets the narrow rules above stay narrow.
 *
 * @param description - The food text `parse-ingredient` returned.
 * @param reasons - Collected review reasons; appended to when the quantity understates the line.
 * @returns The food name with any measurement removed. Pure apart from the `reasons` it appends to.
 * @sideEffect Appends to `reasons`.
 */
function takeMeasurementOutOf(description: string, reasons: IngredientReviewReason[]): string {
    // Restatements first: a conjunction INSIDE one ("(about 4 cups and a bit)") joins nothing.
    let name = description.replace(PARENTHESISED, (match, inner: string | undefined) =>
        findQuantityPhrases(inner ?? '').length > 0 ? ' ' : match,
    );

    const join = LEADING_JOIN.exec(name);

    if (join !== null) {
        const afterJoin = name.slice(join[0].length);
        const [amount] = findQuantityPhrases(afterJoin);

        // Only when the conjunction actually introduces an AMOUNT. "and pepper" is the food's own name.
        if (amount !== undefined && amount.start === 0) {
            name = afterJoin.slice(amount.end).replace(/^\s*\S+\s*/u, ' ');
            reasons.push('measurement_in_name');
        }
    }

    const cleaned = name.replace(/\s+/gu, ' ').trim();

    // ⛔ THE COMPLETENESS CHECK, and the reason the rules above may stay narrow. A join this module does not
    // recognise — an ampersand, a comma, a word-number — leaves its amount at the FRONT of what remains,
    // because the leading quantity was already taken and the food follows. So an amount with nothing
    // word-like before it is a measurement; one with words before it belongs to the food, which is what
    // keeps "type 00 flour" and "Flour, 00" from flagging on their grade.
    const [residual] = findQuantityPhrases(cleaned);

    if (!reasons.includes('measurement_in_name') && residual !== undefined) {
        const before = cleaned.slice(0, residual.start);

        if (!/\p{L}/u.test(before)) {
            reasons.push('measurement_in_name');
        }
    }

    return cleaned;
}

/**
 * Turn two read bounds into the quantity, naming every way they fail to be storable.
 *
 * ⛔ A bound outside the column's window makes the WHOLE line unquantified rather than silently narrowing
 * it to the bound that happened to fit. Keeping `2` out of `"2 to 1000001 cups"` would publish a number
 * the source states only half of, and this import's standing rule is that a dropped line costs one
 * ingredient while a wrong number is a plausible lie in a public recipe's nutrition.
 *
 * @param bounds - The lower and upper bounds, from one reader.
 * @param reasons - Accumulator, appended to in place.
 * @returns The quantity value object. Impure only in appending to `reasons`, which is the caller's own.
 */
function readQuantity(
    bounds: { readonly low: number | null; readonly high: number | null },
    reasons: IngredientReviewReason[],
): IngredientQuantity {
    const low = toStorableBound(bounds.low);
    const high = toStorableBound(bounds.high);

    if (low === null) {
        reasons.push('no_quantity');

        return ABSENT_QUANTITY;
    }

    const unstorable = [low, high].some(
        (bound) => bound !== null && !recipeIngredientQuantitySchema.safeParse(bound).success,
    );

    if (unstorable) {
        reasons.push('quantity_out_of_storage_range');

        return ABSENT_QUANTITY;
    }

    const quantity = statedQuantity(low, high);

    if (quantity === null) {
        reasons.push('quantity_bounds_inverted');

        return ABSENT_QUANTITY;
    }

    return quantity;
}
