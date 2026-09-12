/**
 * @module readStatedMeasure — ONE reading of a stated measure phrase (plan U22, phase 3).
 *
 * DESIGN PATTERN: **Parser (parse, don't validate)** over a `string | null`. It takes the source's own
 * WORDS and returns the value the rest of the system may hold — an amount, a canonical unit, and every
 * reason the reading is incomplete. There is no boolean "is this a valid measure"; the reading IS the
 * answer, and a phrase no number can hold is a legitimate reading rather than a failure.
 *
 * ## ⛔ WHY BOTH ENGINES' AMOUNTS COME THROUGH HERE
 *
 * `ParsedFacts` carries the measure THREE ways: `statedMeasure` (the words), `quantity` (how much) and
 * `unit`. The words are each engine's own; the other two are a READING of them, and the comparator
 * compares all three as independent facts. If the CRF's amount were read by one arithmetic and the LLM's by
 * another, `FACT_COMPARATORS.quantity` would report a disagreement between the two READERS while the two
 * ENGINES agreed about the phrase — a disagreement nobody could act on, on lines that are not in dispute.
 * So both promotions call this, and neither does arithmetic of its own.
 *
 * ## ⛔ IT HOLDS NO UNIT TABLE, AND THAT IS THE POINT
 *
 * The vocabulary this import understands — `parse-ingredient`'s own units, the `*ful` family (R31) and the
 * historical measures the library does not define at all (R32) — is ONE piece of knowledge, and it lives in
 * `ingredientLine.ts` as `IMPORT_UNITS`. A copy here would drift the first time a book printed a spelling
 * the parser learned about, and the symptom would be a gill read as a unit on one path and folded into a
 * food name on the other. So this module reaches the vocabulary through {@link parseIngredientLine} — the
 * package's one reader of English measure text, which also owns number words, ranges, vulgar fractions and
 * the storable window — and adds exactly one thing that reader cannot do on a bare phrase.
 *
 * ## ⚠️ THE ONE THING IT ADDS: `parse-ingredient` WILL NOT NAME A UNIT WITH NOTHING AFTER IT
 *
 * Measured 2026-08-25 against `parse-ingredient@2.2.0`:
 *
 * ```text
 * parseIngredient('2 cups')      -> { quantity: 2, unitOfMeasure: null, description: 'cups' }
 * parseIngredient('2 cups item') -> { quantity: 2, unitOfMeasure: 'cups', description: 'item' }
 * ```
 *
 * A measure phrase is precisely the input with nothing after it, so a reader that simply forwarded the
 * phrase would report EVERY bare measure as unitless — silently, and on every line in the corpus. The
 * repair is to re-read the phrase with a placeholder food appended and take only the UNIT from that read.
 *
 * ⛔ Three properties keep that from becoming a guess:
 *
 *  1. The placeholder read is consulted ONLY when the plain read named no unit, so it can never overrule a
 *     unit the phrase already yielded.
 *  2. The only word the re-read adds is the placeholder, and the placeholder is not a unit — asserted in
 *     `__tests__/readStatedMeasure.test.ts` against the REAL vocabulary, not against a list here. So every
 *     unit this can return is a word the phrase itself wrote.
 *  3. The QUANTITY and the review reasons always come from the plain read. The placeholder is never allowed
 *     to change how much the line calls for. That matters: `parseIngredient('about 2 cups')` reads 2 cups
 *     while `parseIngredient('about 2 cups ingredient')` reads NOTHING AT ALL (measured), so a reader that
 *     took its amount from the second read would lose amounts the first one had.
 *
 * ⚠️ An earlier revision also required the re-read to attribute the WHOLE phrase to the measure, rejecting
 * its unit whenever anything but the placeholder was left over. That guard was DROPPED after measuring it:
 * across 35 real and adversarial phrases it never once changed the answer, and every leftover case it would
 * have rejected — `"2 cups sifted"`, `"one gill or more"`, `"1 pound tin"` — had named the RIGHT unit. An
 * untestable guard whose only observable effect is discarding correct readings is worse than no guard.
 *
 * ⚠️ Accepted, and measured: a qualifier between the amount and the unit defeats both reads —
 * `"a scant cup"` and `"two heaping tablespoons"` come back unitless. Nothing is lost that matters, because
 * `statedMeasure` carries the words verbatim and `raw` carries the whole line; what is lost is the
 * SEGMENTATION, which is the same accepted loss `projectToIngredientLine`'s drop table records.
 */
import { ABSENT_QUANTITY, type IngredientQuantity } from '@kitchensink/recipe-core';

import { parseIngredientLine, type IngredientReviewReason } from '../ingredientLine.js';

/**
 * One measure phrase, read.
 *
 * ⚠️ It carries {@link StatedMeasureReading.reviewReasons} rather than only the two values, because only
 * this module can tell the three absences apart — nothing stated, an amount the column cannot hold, and two
 * bounds that contradict each other all arrive downstream as `absent`. Re-deriving the distinction from the
 * quantity is impossible, and re-deriving a *reason* at the call site would be a second representation of
 * `ingredientLine.ts`'s taxonomy.
 */
export interface StatedMeasureReading {
    /** How much the phrase calls for. `absent` when it states no number the column could hold (R40). */
    readonly quantity: IngredientQuantity;
    /** The unit, canonicalised by recipe-core's `normalizeUnit`, or `null` when the phrase states none. */
    readonly unit: string | null;
    /** Why the reading is incomplete. Empty when the phrase was read whole. */
    readonly reviewReasons: readonly IngredientReviewReason[];
}

/**
 * The food a measure phrase is re-read with so `parse-ingredient` will name its unit.
 *
 * ⛔ It must never be readable as a unit or as an amount, or it would change the very reading it exists to
 * enable. `__tests__/readStatedMeasure.test.ts` asserts that against the REAL vocabulary rather than
 * against a list here, because the vocabulary is `ingredientLine.ts`'s and can grow.
 *
 * ⚠️ Its text never reaches a value. It is compared against the parser's food output and discarded; the
 * only thing taken from that read is the unit.
 */
const MEASURE_PLACEHOLDER_FOOD = 'ingredient';

/**
 * Reasons that are about the MEASURE, as opposed to about a line.
 *
 * ⛔ `parseIngredientLine` judges a whole ingredient line, so it can also report `group_header`,
 * `multiline_input`, `name_too_long` and `empty_input` — all of which describe the LINE or its food, and
 * none of which a caller could act on when what it handed over was a measure phrase. Passing them through
 * would put a reason on a `ParsedLine` that its `raw` does not support.
 */
const MEASURE_REVIEW_REASONS: ReadonlySet<IngredientReviewReason> = new Set([
    'no_quantity',
    'quantity_out_of_storage_range',
    'quantity_bounds_inverted',
    // ⚠️ Kept, and the name is the only awkward part. What it asserts — "the phrase stated a measurement
    // this reading did not take, so the amount UNDERSTATES it" — is exactly true of `"2 cups and 1
    // tablespoon"`, and it is the reason `ingredientLine.ts` already owns for that fact. A fifth reason
    // meaning the same thing would fork a taxonomy whose totality `corruptsStatedValue` depends on.
    'measurement_in_name',
]);

/** The reasons that EXPLAIN an absent quantity. An absence outside this set is an unexplained one. */
const ABSENCE_REASONS: ReadonlySet<IngredientReviewReason> = new Set([
    'no_quantity',
    'quantity_out_of_storage_range',
    'quantity_bounds_inverted',
]);

/** The reading of a phrase that states nothing at all. */
const STATES_NOTHING: StatedMeasureReading = {
    quantity: ABSENT_QUANTITY,
    unit: null,
    reviewReasons: ['no_quantity'],
};

/**
 * The unit `parse-ingredient` names once the phrase is followed by a food.
 *
 * ⛔ Only the UNIT is taken. Everything else this read produces — the amount, the name, the reasons — is
 * discarded, because it was read against text the source did not write.
 *
 * @param stated - The measure phrase, already known to be non-blank.
 * @returns The unit the phrase's own words name, or `null` when the parser still finds none. Pure.
 */
function unitBehindAPlaceholder(stated: string): string | null {
    return parseIngredientLine(`${stated} ${MEASURE_PLACEHOLDER_FOOD}`).unit;
}

/**
 * Read one stated measure phrase.
 *
 * @param stated - The measure EXACTLY as the source stated it, or `null` when it stated none. `''` and a
 *   whitespace-only phrase are the SAME fact as `null` — U16 admits one representation of "no measure".
 * @returns The amount, the canonical unit, and every reason the reading is incomplete. Pure and TOTAL: no
 *   input throws, and an absent quantity always carries a reason saying why.
 */
export function readStatedMeasure(stated: string | null): StatedMeasureReading {
    if (stated === null || stated.trim() === '') {
        return STATES_NOTHING;
    }

    const plain = parseIngredientLine(stated);
    const reasons = plain.reviewReasons.filter((reason) => MEASURE_REVIEW_REASONS.has(reason));

    // ⛔ An absence must never travel unexplained: the projection derives no reason of its own, so a silent
    // `absent` is a line nobody is ever asked about. This is the only reason this module adds.
    const explained = reasons.some((reason) => ABSENCE_REASONS.has(reason));
    const reviewReasons: readonly IngredientReviewReason[] =
        plain.quantity.kind === 'absent' && !explained ? [...reasons, 'no_quantity'] : reasons;

    return {
        quantity: plain.quantity,
        unit: plain.unit ?? unitBehindAPlaceholder(stated),
        reviewReasons,
    };
}
