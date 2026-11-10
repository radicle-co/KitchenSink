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
 *  5. **A parenthetical after the amount is read from the SOURCE line** (owner ruling 2026-11-08, `parentheticalMeasure.ts`).
 *     A dimension ("1 (9 inch) pie pastry") is a NOTE on the food: it leaves the unit and the head of the name, and rides
 *     as `note`. A package size ("1 (28 ounce) can") stays the unit, word for word, and its container word leaves the
 *     name. Rule 4 runs after this, so a size word that follows a dimension is still a unit.
 *  6. **`displayText` is the food words, decided by the parse**: the parse's `display` says whether the cook's words
 *     ("lean ground beef") or the app's own food name are shown. Only `'written'` yields `displayText`, and it is the name
 *     AFTER rules 4 and 5, so no word is said twice (ADR-0026 §11, ADR-0045). A name that leads with the unit's own last word drops it for the same reason.
 *
 * Reachable ONLY as `@kitchensink/recipe-core/parsing/pasted-line-measure`, never from the barrel. Pure.
 *
 * @pattern Specification — the one rule for a pasted line's saved measure, shared by the editor and the matcher
 */
import { ABSENT_QUANTITY, type IngredientQuantity } from '../ingredientQuantity.js';
import { LENGTH_UNIT_VOCABULARY, isSizeWord } from '../units.js';
import { escapeRegExp } from './escapeRegExp.js';
import { readCooksMeasure } from './measureReader.js';
import { readParenthetical, type Parenthetical } from './parentheticalMeasure.js';

/** What a parse says about a line's measure: its reading, and the words the source used. */
export interface PastedLineParse {
    /** The parse's amount. */
    readonly quantity: IngredientQuantity;
    /** The parse's canonical unit, or `null` when the line states none. */
    readonly unit: string | null;
    /** The source's own words for the measure ("2 tbsp", "a handful"), when the parse kept them. */
    readonly statedMeasure?: string | null | undefined;
    /**
     * The cook's line as written. REQUIRED, never defaulted: a caller that has not thought about the parenthetical rule
     * (rule 5) must not silently keep a dimension as the unit.
     */
    readonly sourceLine: string;
    /**
     * Whether the app shows the cook's words for the food (`'written'`) or its own food name (`'food'`), as the parse
     * answered; `null` when no parse answered (a CRF-only line, a refusal, a spent ceiling). REQUIRED for the same reason.
     */
    readonly display: 'written' | 'food' | null;
}

/** The measure a pasted row is saved with. `unit` is `''` when the row states none, as the editor saves it. */
interface PastedLineMeasure {
    readonly quantity: IngredientQuantity;
    readonly unit: string;
}

/** What a pasted row is saved with: its measure, and the food's name with any size word moved into the unit. */
export interface PastedLineRow extends PastedLineMeasure {
    readonly name: string;
    /** The food words the line SHOWS, when the parse chose the cook's words (rule 6). Absent otherwise. */
    readonly displayText?: string;
    /** A dimension the cook wrote in parentheses ("9 inch"), shown beside the food (rule 5). Absent otherwise. */
    readonly note?: string;
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
 * A phrase as a case-insensitive pattern that tolerates other spacing between its words.
 *
 * @param text - The phrase.
 * @returns The pattern source. Pure.
 */
function looseOf(text: string): string {
    return text
        .trim()
        .split(/\s+/u)
        .map(escapeRegExp)
        .join(String.raw`\s+`);
}

/** `words` without the first `phrase` (bare or parenthesised), single-spaced. Pure. */
function withoutPhrase(words: string, phrase: string): string {
    const pattern = new RegExp(
        String.raw`\(\s*${looseOf(phrase)}\s*\)|(?<![\p{L}\p{Nd}])${looseOf(phrase)}(?![\p{L}\p{Nd}])`,
        'iu',
    );

    return words.replace(pattern, ' ').replace(/\s+/gu, ' ').trim();
}

/** `name` without `phrase` when it LEADS the name, or `name` unchanged when removing it would empty it. Pure. */
function withoutLeading(name: string, phrase: string): string {
    const rest = name
        .replace(new RegExp(String.raw`^\(?\s*${looseOf(phrase)}\s*\)?(?![\p{L}\p{Nd}])\s*`, 'iu'), '')
        .trim();

    return rest === '' ? name : rest;
}

/**
 * A name without its leading word when that word is the unit's last word, so the line never reads "3 large large eggs"
 * (the unit says it already). A name that is only that word is kept.
 *
 * @param unit - The unit as it will be saved.
 * @param name - The name as it will be saved.
 * @returns The name. Pure.
 */
function withoutRepeatedUnit(unit: string, name: string): string {
    const unitWord = unit.split(/\s+/u).at(-1)?.toLowerCase();
    const [first, ...rest] = name.trim().split(/\s+/u);

    return unitWord !== undefined && unitWord !== '' && rest.length > 0 && first?.toLowerCase() === unitWord
        ? rest.join(' ')
        : name;
}

/**
 * A unit without the dimension the cook wrote: the parenthetical itself, and a bare length word a parse read out of it
 * (`inch`) when nothing else is left, because a length is never an ingredient's unit.
 *
 * @param unit - The unit words as the measure reader or the parse gave them.
 * @param dimension - The dimension's text ("9 inch").
 * @returns The unit without it. Pure.
 */
function dimensionFreeUnit(unit: string, dimension: string): string {
    const rest = withoutPhrase(unit, dimension);

    return LENGTH_UNIT_VOCABULARY.includes(rest.toLowerCase()) ? '' : rest;
}

/**
 * Apply rule 5 to one food's measure and name.
 *
 * @param parenthetical - What the source line's parenthetical is.
 * @param measure - The measure before the rule.
 * @param name - The food's name before the rule.
 * @returns The measure, name and (for a dimension) the note. Pure.
 */
function withParenthetical(
    parenthetical: Parenthetical,
    measure: PastedLineMeasure,
    name: string,
): { readonly measure: PastedLineMeasure; readonly name: string; readonly note?: string } {
    if (parenthetical.kind === 'dimension') {
        return {
            measure: { ...measure, unit: dimensionFreeUnit(measure.unit, parenthetical.text) },
            name: withoutLeading(name, parenthetical.text),
            note: parenthetical.text,
        };
    }

    return {
        measure: { ...measure, unit: `(${parenthetical.text}) ${parenthetical.container}` },
        name: withoutLeading(withoutLeading(name, parenthetical.text), parenthetical.container),
    };
}

/**
 * The measure, name, display text and note one food of a pasted line is saved with (rules 1 to 6).
 *
 * @param parse - The line's parse: its reading, the source's words for the measure, the source line and the display.
 * @param foodIndex - Which food of the line. Only the first (`0`) carries an amount and a parenthetical (rules 3 and 5).
 * @param name - That food's name as the parse read it.
 * @returns The quantity, the unit in the cook's words, the name, and `displayText` and `note` when they apply. Pure.
 */
export function pastedLineRowOf(parse: PastedLineParse, foodIndex: number, name: string): PastedLineRow {
    const parenthetical = foodIndex === 0 ? readParenthetical(parse.sourceLine) : undefined;
    const shaped =
        parenthetical === undefined
            ? { measure: pastedLineMeasureOf(parse, foodIndex), name }
            : withParenthetical(parenthetical, pastedLineMeasureOf(parse, foodIndex), name);
    const { measure } = shaped;
    const counted = foodIndex === 0 && measure.unit === '' && measure.quantity.kind !== 'absent';
    const sized = counted ? leadingSizeWord(shaped.name) : undefined;
    const placed =
        sized === undefined ? { ...measure, name: shaped.name } : { ...measure, unit: sized.size, name: sized.rest };
    const row = { ...placed, name: withoutRepeatedUnit(placed.unit, placed.name) };

    return {
        ...row,
        ...(parse.display === 'written' && row.name.trim() !== '' ? { displayText: row.name } : {}),
        ...(shaped.note === undefined ? {} : { note: shaped.note }),
    };
}
