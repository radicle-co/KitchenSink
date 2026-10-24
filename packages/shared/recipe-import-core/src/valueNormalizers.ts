import { recipeMinutesSchema, recipeServingsSchema } from '@kitchensink/recipe-core';
import Fraction from 'fraction.js';

import { normalizeQuantity, RANGE_SEPARATOR } from './normalizeQuantity.js';

/**
 * Why a scalar field is empty or suspect.
 *
 * ⛔ `absent` and `unreadable` exist as distinct members because HAZ-040's prohibition is about the
 * ABSENT case: "no branch returns a default for an absent input". Collapsing them would make the one
 * case the hazard names indistinguishable from every other.
 */
export type ValueReviewReason =
    /** Nothing was supplied. The field stays empty — never `0`, never `4`. */
    | 'absent'
    /** Something was supplied but states no value (`"overnight"`, `"a crowd"`). */
    | 'unreadable'
    /** A range was stated (`"15 to 20 minutes"`); the LOWER bound was taken. */
    | 'range_narrowed'
    /** A bare number with no unit was read as minutes. The assumption is flagged, not hidden. */
    | 'unit_assumed'
    /** The value cannot be stored by the column (negative, or beyond `int4`). */
    | 'out_of_storage_range'
    /** A real, nonzero duration rounded down to `0` minutes. `0` is legal; a silent `0` is not. */
    | 'rounded_to_zero'
    /** A yield must be a whole number of servings, and this one is not. */
    | 'not_a_whole_number';

/** A duration normalized to whole minutes, or left empty. */
export interface NormalizedMinutes {
    /** Integer minutes, or `undefined`. ⛔ Never a default for an absent input (HAZ-040). */
    readonly minutes: number | undefined;
    /** Exactly `reviewReasons.length > 0`. */
    readonly needsReview: boolean;
    readonly reviewReasons: readonly ValueReviewReason[];
}

/** A free-text yield normalized to a positive whole number of servings, or left empty. */
export interface NormalizedServings {
    /** A positive integer, or `undefined`. ⛔ Never a default for an absent input (HAZ-040). */
    readonly servings: number | undefined;
    /** Exactly `reviewReasons.length > 0`. */
    readonly needsReview: boolean;
    readonly reviewReasons: readonly ValueReviewReason[];
}

/** Duration unit words to minutes. `second` is a rational so `"ninety seconds"` stays exact until rounding. */
const DURATION_UNIT_MINUTES: ReadonlyMap<string, Fraction> = new Map([
    ['second', new Fraction(1, 60)],
    ['seconds', new Fraction(1, 60)],
    ['sec', new Fraction(1, 60)],
    ['secs', new Fraction(1, 60)],
    ['minute', new Fraction(1)],
    ['minutes', new Fraction(1)],
    ['min', new Fraction(1)],
    ['mins', new Fraction(1)],
    ['hour', new Fraction(60)],
    ['hours', new Fraction(60)],
    ['hr', new Fraction(60)],
    ['hrs', new Fraction(60)],
    ['day', new Fraction(1440)],
    ['days', new Fraction(1440)],
]);

/**
 * A conjunction joining two terms of ONE duration (`"1 hour and 30 minutes"`).
 *
 * Measured 2026-08-19: without this, the term loop stopped at the `"and"` and returned **60 minutes with
 * `needsReview: false`** — half the duration dropped, and reported as certain. A silently plausible wrong
 * number is worse than an empty field, which is the whole premise of this module.
 *
 * It does not collide with the `"one and one-half"` form: that `and` is consumed inside
 * {@link normalizeQuantity}'s own phrase grammar and never reaches this loop.
 */
const TERM_CONJUNCTION = /^\s*(?:and|plus|&)\s+/i;

/**
 * Words scanned after a quantity before giving up on finding its unit.
 *
 * Three, because `"three-quarters of an hour"` puts two filler words between the two ("of", "an"), and a
 * wider scan would let a later term's unit attach to an earlier term's quantity.
 */
const UNIT_LOOKAHEAD_WORDS = 3;

/** Terms summed in one duration (`"1 hour 30 minutes"` is two). Bounds work on hostile input. */
const MAX_DURATION_TERMS = 8;

/** Word positions probed for a yield. A yield phrase is short; scanning further is only attack surface. */
const MAX_YIELD_WORDS_SCANNED = 40;

interface UnitReading {
    readonly minutes: Fraction;
    readonly rest: string;
}

/** Finds the duration unit belonging to the quantity just read, skipping filler words like "of an". */
function readDurationUnit(after: string): UnitReading | null {
    const words = [...after.matchAll(/\S+/g)].slice(0, UNIT_LOOKAHEAD_WORDS);

    for (const word of words) {
        const minutes = DURATION_UNIT_MINUTES.get(word[0].toLowerCase().replace(/[.,;:]+$/, ''));

        if (minutes !== undefined) {
            return { minutes, rest: after.slice(word.index + word[0].length) };
        }
    }

    return null;
}

/** True when the phrase is a bare indefinite article — `"a crowd"` states no count, unlike `"a dozen"`. */
function isBareArticle(phrase: string): boolean {
    return /^an?$/i.test(phrase.trim());
}

/**
 * Normalize free-text duration prose to whole minutes (MOD-020, FR-021).
 *
 * Handles word and numeral forms, compound terms (`"1 hour 30 minutes"` sums), and ranges (`"15 to 20
 * minutes"` takes 15 and flags). Pure and TOTAL; never throws.
 *
 * ⛔ HAZ-040: an absent or unreadable input leaves the field `undefined` and flags it. It NEVER returns
 * `0` as a stand-in — `prep_time_minutes` is a nullable `integer CHECK (>= 0)`, so a fabricated `0` would
 * be stored as a fact.
 *
 * ISO-8601 durations are deliberately out of scope: this corpus has none, and `iso8601-duration`'s
 * `parse()` returns an all-zero object rather than failing on unmatched text, which is precisely the
 * fabricated `0` this contract forbids. Adding it needs its own gate on that library's `pattern` export.
 *
 * @param raw - The extracted, already-sanitized text, or nothing at all.
 * @returns Whole minutes with every assumption named, or `undefined` with a reason.
 */
export function normalizeDurationToMinutes(raw: string | null | undefined): NormalizedMinutes {
    if (raw === null || raw === undefined || raw.trim() === '') {
        return { minutes: undefined, needsReview: true, reviewReasons: ['absent'] };
    }

    const reasons: ValueReviewReason[] = [];
    let total = new Fraction(0);
    let terms = 0;
    let rest = raw;

    while (rest.trim() !== '' && terms < MAX_DURATION_TERMS) {
        const term = normalizeQuantity(rest);

        if (term.quantity === null) {
            break;
        }

        let after = term.rest;
        const separator = RANGE_SEPARATOR.exec(after);

        if (separator !== null) {
            const upper = normalizeQuantity(after.slice(separator[0].length));

            if (upper.quantity !== null) {
                reasons.push('range_narrowed');
                after = upper.rest;
            }
        }

        const unit = readDurationUnit(after);

        if (unit === null) {
            // A bare numeral standing alone is minutes; a WORD with no unit ("a while") states nothing.
            if (!/[a-z]/i.test(term.phrase) && !/[a-z]/i.test(after)) {
                reasons.push('unit_assumed');
                total = total.add(term.quantity);
                terms += 1;
            }

            break;
        }

        total = total.add(term.quantity.mul(unit.minutes));
        terms += 1;
        rest = unit.rest.replace(TERM_CONJUNCTION, ' ');
    }

    if (terms === 0) {
        return { minutes: undefined, needsReview: true, reviewReasons: ['unreadable'] };
    }

    const rounded = Math.round(total.valueOf());

    if (!recipeMinutesSchema.safeParse(rounded).success) {
        return { minutes: undefined, needsReview: true, reviewReasons: [...reasons, 'out_of_storage_range'] };
    }

    if (rounded === 0 && total.compare(0) !== 0) {
        reasons.push('rounded_to_zero');
    }

    return { minutes: rounded, needsReview: reasons.length > 0, reviewReasons: reasons };
}

/**
 * Normalize a free-text yield to a positive whole number of servings (MOD-020, FR-021).
 *
 * Reads the first genuine count anywhere in the phrase, so `"serves four"`, `"for six persons"` and
 * `"enough for twelve"` all resolve. A range takes the lower bound and flags. Pure and TOTAL.
 *
 * ⛔ HAZ-040: absent or ambiguous leaves the field `undefined` and flags it. It never returns the
 * seductive default of `4`, and it never reads a bare `"a"` as a count — `"a crowd"` is not one serving.
 *
 * @param raw - The extracted, already-sanitized yield text, or nothing at all.
 * @returns A positive integer with every assumption named, or `undefined` with a reason.
 */
export function normalizeServings(raw: string | null | undefined): NormalizedServings {
    if (raw === null || raw === undefined || raw.trim() === '') {
        return { servings: undefined, needsReview: true, reviewReasons: ['absent'] };
    }

    const positions = [...raw.matchAll(/\S+/g)].slice(0, MAX_YIELD_WORDS_SCANNED);

    for (const position of positions) {
        const reading = normalizeQuantity(raw.slice(position.index));

        if (reading.quantity === null || isBareArticle(reading.phrase)) {
            continue;
        }

        const reasons: ValueReviewReason[] = [];
        const separator = RANGE_SEPARATOR.exec(reading.rest);

        if (separator !== null && normalizeQuantity(reading.rest.slice(separator[0].length)).quantity !== null) {
            reasons.push('range_narrowed');
        }

        const value = reading.quantity.valueOf();

        if (!Number.isInteger(value)) {
            return { servings: undefined, needsReview: true, reviewReasons: [...reasons, 'not_a_whole_number'] };
        }

        if (!recipeServingsSchema.safeParse(value).success) {
            return { servings: undefined, needsReview: true, reviewReasons: [...reasons, 'out_of_storage_range'] };
        }

        return { servings: value, needsReview: reasons.length > 0, reviewReasons: reasons };
    }

    return { servings: undefined, needsReview: true, reviewReasons: ['unreadable'] };
}
