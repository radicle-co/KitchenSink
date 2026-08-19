import {
    MAX_RECIPE_INGREDIENT_NAME_LENGTH,
    normalizeUnit,
    recipeIngredientQuantitySchema,
} from '@kitchensink/recipe-core';
import { parseIngredient } from 'parse-ingredient';

import { normalizeQuantity } from './normalizeQuantity.js';

/**
 * Why a parsed line still wants a human's eye. A boolean says "something is off"; the draft review has to
 * tell a user "we took the lower bound of 2-3" apart from "we could not read this line at all".
 */
export type IngredientReviewReason =
    /** The line was blank. */
    | 'empty_input'
    /** No quantity could be read. The quantity is `null` — it is NEVER guessed. */
    | 'no_quantity'
    /** A quantity was read but is not storable (non-positive, or outside recipe-core's window). */
    | 'quantity_out_of_storage_range'
    /** The line stated a range (`"2 to 3 cups"`); the LOWER bound was taken. */
    | 'quantity_range_narrowed'
    /** The line is a section heading (`"For the sauce:"`), not an ingredient. */
    | 'group_header'
    /** More than one line was passed in, so content beyond the first would be dropped. */
    | 'multiline_input'
    /** The name exceeds what recipe-core will store. It is returned UNCUT; truncation is not this module's. */
    | 'name_too_long';

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
     * The quantity, already inside the window `recipeIngredientQuantitySchema` accepts, or `null`.
     *
     * ⛔ `null` is NEVER a fabricated `1`. The destination column is `numeric(10,3) NOT NULL
     * CHECK (quantity > 0)`, which would accept an invented `1` in silence — that acceptance is the whole
     * reason this module exists.
     */
    readonly quantity: number | null;
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

function roundToStorageScale(value: number): number {
    const factor = 10 ** QUANTITY_STORAGE_SCALE;

    return Math.round(value * factor) / factor;
}

/**
 * Parse one free-text ingredient line into a quantity, unit and name (MOD-019, FR-020).
 *
 * DESIGN PATTERN: Facade over a three-stage pipeline — `normalizeQuantity` (prose to numeral) ->
 * `parse-ingredient` (unit + description) -> recipe-core's schema (what is storable).
 *
 * ⚠️ The quantity is taken from `normalizeQuantity` whenever it read one, and only falls back to
 * `parse-ingredient` for notations that module deliberately leaves alone (unicode vulgar fractions).
 * That order is not a preference: `parse-ingredient@2.2.0` was measured on 2026-08-19 to TRUNCATE a
 * numeral at six digits — `"1000001 cups water"` comes back as `quantity: 100000`, a plausible wrong
 * number that is inside the storable window and would therefore be persisted without a flag.
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
        return { raw, quantity: null, unit: null, name: '', needsReview: true, reviewReasons: ['empty_input'] };
    }

    const normalized = normalizeQuantity(raw);
    const entries = parseIngredient(normalized.line);
    const entry = entries[0];

    if (entry === undefined) {
        return { raw, quantity: null, unit: null, name: '', needsReview: true, reviewReasons: ['empty_input'] };
    }

    if (entries.length > 1) {
        reasons.push('multiline_input');
    }

    if (entry.isGroupHeader) {
        reasons.push('group_header');
    }

    const exact = normalized.quantity?.valueOf() ?? entry.quantity;
    let quantity: number | null = null;

    if (exact === null || !Number.isFinite(exact)) {
        reasons.push('no_quantity');
    } else {
        if (entry.quantity2 !== null && entry.quantity2 !== entry.quantity) {
            reasons.push('quantity_range_narrowed');
        }

        const storable = roundToStorageScale(exact);

        if (recipeIngredientQuantitySchema.safeParse(storable).success) {
            quantity = storable;
        } else {
            reasons.push('quantity_out_of_storage_range');
        }
    }

    const unit = entry.unitOfMeasure === null ? null : normalizeUnit(entry.unitOfMeasure) || null;
    const name = entry.description;

    if (name.length > MAX_RECIPE_INGREDIENT_NAME_LENGTH) {
        reasons.push('name_too_long');
    }

    return { raw, quantity, unit, name, needsReview: reasons.length > 0, reviewReasons: reasons };
}
