/**
 * `pastedLineMeasureOf` — the measure one food of a pasted line is SAVED with (build spec §7.5.3, §7.5.4; ADR-0071).
 *
 * ⛔ ONE RULE, TWO CALLERS. The editor (`@commise/features-recipes`' `pastedLines.ts`) saves a pasted row with this
 * measure, and recipe-service's paste matcher (`matchJudgementOf`) keys the review gate's verdict with it, so the key a
 * proposal is judged under is the key the save path computes for the line the cook kept. When the editor read the
 * cook's words and the matcher read the parse's canonical unit, `2 tbsp` saved unit `tbsp` while the verdict was keyed
 * on `tablespoon`, and the save path paid the gate again for a judgement already on record.
 *
 * The rules (they were the editor's `cookMeasureOf`):
 *
 *  1. **The cook's own words win.** The parse's `statedMeasure` is read with the measure reader's amount rules, and the
 *     words after the amount are kept as written (`tbsp`, `T`, `large`), never as `normalizeUnit` spells them.
 *  2. **The parse's reading stands** where those words state no amount the reader reads but the parse read one
 *     (`one cup`), or where the parse kept no words.
 *  3. **Only the FIRST food of a line carries the line's measure.** A second food on the same line (`salt and pepper`)
 *     states none, because the line gave one amount.
 *
 * Reachable ONLY as `@kitchensink/recipe-core/parsing/pasted-line-measure`, never from the barrel. Pure.
 *
 * @pattern Specification — the one rule for a pasted line's saved measure, shared by the editor and the matcher
 */
import { ABSENT_QUANTITY, type IngredientQuantity } from '../ingredientQuantity.js';
import { readCooksMeasure } from './measureReader.js';

/** What a parse says about a line's measure: its reading, and the words the source used. */
export interface PastedLineParse {
    /** The parse's amount. */
    readonly quantity: IngredientQuantity;
    /** The parse's canonical unit, or `null` when the line states none. */
    readonly unit: string | null;
    /** The source's own words for the measure ("2 tbsp", "a handful"), when the parse kept them. */
    readonly statedMeasure?: string | null | undefined;
}

/** The measure a pasted row is saved with. `unit` is `''` when the row states none, as the editor saves it. */
export interface PastedLineMeasure {
    readonly quantity: IngredientQuantity;
    readonly unit: string;
}

/** A row that states no measure. */
const NO_MEASURE: PastedLineMeasure = Object.freeze({ quantity: ABSENT_QUANTITY, unit: '' });

/**
 * The measure one food of a pasted line is saved with.
 *
 * @param parse - The line's parse: its reading and the source's words for the measure.
 * @param foodIndex - Which food of the line. Only the first (`0`) carries the measure.
 * @returns The quantity and the unit in the cook's words. Pure.
 */
export function pastedLineMeasureOf(parse: PastedLineParse, foodIndex: number): PastedLineMeasure {
    if (foodIndex !== 0) {
        return NO_MEASURE;
    }

    const parsed: PastedLineMeasure = { quantity: parse.quantity, unit: parse.unit ?? '' };
    const phrase = parse.statedMeasure?.trim() ?? '';

    if (phrase === '') {
        return parsed;
    }

    const stated = readCooksMeasure(phrase);

    if (stated.quantity.kind !== 'absent') {
        return { quantity: stated.quantity, unit: stated.words };
    }

    return parse.quantity.kind === 'absent' ? { quantity: ABSENT_QUANTITY, unit: stated.words } : parsed;
}
