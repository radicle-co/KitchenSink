/**
 * `pastedLineRowOf` — the measure and name one food of a pasted line is SAVED with (build spec §7.5.3, §7.5.4; ADR-0071).
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
 *  3. **Only the FIRST food of a line carries the line's AMOUNT.** A second food on the same line (`2 tbsp butter and
 *     flour`) states none, because the line gave one amount. A line that states NO amount says its words of every food
 *     it names (`salt and pepper to taste`): there is no number to give twice, and dropping the words from the second
 *     food lost "to taste" in production (2026-11-08).
 *  4. **A size word is a unit** (ADR-0026 §8, owner ruling 2026-08-26). The parse keeps a leading size word in the
 *     food's name (`3 large eggs` → `large eggs`, no unit), so a counted row with no unit takes it as its unit and the
 *     name keeps the rest. The line then reads "3 large eggs" beside any matched food, and `unitToGrams` can meet a
 *     catalog portion labelled `large`. A name that is only a size word is never emptied.
 *
 * Reachable ONLY as `@kitchensink/recipe-core/parsing/pasted-line-measure`, never from the barrel. Pure.
 *
 * @pattern Specification — the one rule for a pasted line's saved measure, shared by the editor and the matcher
 */
import { ABSENT_QUANTITY, type IngredientQuantity } from '../ingredientQuantity.js';
import { isSizeWord } from '../units.js';
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
interface PastedLineMeasure {
    readonly quantity: IngredientQuantity;
    readonly unit: string;
}

/** What a pasted row is saved with: its measure, and the food's name with any size word moved into the unit. */
export interface PastedLineRow extends PastedLineMeasure {
    readonly name: string;
}

/** A row that states no measure. */
const NO_MEASURE: PastedLineMeasure = Object.freeze({ quantity: ABSENT_QUANTITY, unit: '' });

/**
 * The measure one food of a pasted line is saved with, before rule 4.
 *
 * @param parse - The line's parse: its reading and the source's words for the measure.
 * @param foodIndex - Which food of the line. Only the first (`0`) carries an amount (rule 3).
 * @returns The quantity and the unit in the cook's words. Pure.
 */
function pastedLineMeasureOf(parse: PastedLineParse, foodIndex: number): PastedLineMeasure {
    const measure = lineMeasureOf(parse);

    return foodIndex === 0 || measure.quantity.kind === 'absent' ? measure : NO_MEASURE;
}

/**
 * The line's measure in the cook's words (rules 1 and 2).
 *
 * @param parse - The line's parse: its reading and the source's words for the measure.
 * @returns The quantity and the unit in the cook's words. Pure.
 */
function lineMeasureOf(parse: PastedLineParse): PastedLineMeasure {
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

/**
 * Split a leading size word off a name, trying the two-word form (`extra large`) before the one-word form.
 *
 * @param name - The food's name as the parse read it.
 * @returns The size word as written and the rest, or `undefined` when the name does not lead with one. Pure.
 */
function leadingSizeWord(name: string): { readonly size: string; readonly rest: string } | undefined {
    const words = name.trim().split(/\s+/u);

    for (const width of [2, 1]) {
        const size = words.slice(0, width).join(' ');
        const rest = words.slice(width).join(' ');

        if (words.length > width && isSizeWord(size)) {
            return { size, rest };
        }
    }

    return undefined;
}

/**
 * The measure and name one food of a pasted line is saved with (rules 1 to 4).
 *
 * @param parse - The line's parse: its reading and the source's words for the measure.
 * @param foodIndex - Which food of the line. Only the first (`0`) carries an amount (rule 3).
 * @param name - That food's name as the parse read it.
 * @returns The quantity, the unit in the cook's words, and the name. Pure.
 */
export function pastedLineRowOf(parse: PastedLineParse, foodIndex: number, name: string): PastedLineRow {
    const measure = pastedLineMeasureOf(parse, foodIndex);
    const counted = foodIndex === 0 && measure.unit === '' && measure.quantity.kind !== 'absent';
    const sized = counted ? leadingSizeWord(name) : undefined;

    return sized === undefined ? { ...measure, name } : { ...measure, unit: sized.size, name: sized.rest };
}
