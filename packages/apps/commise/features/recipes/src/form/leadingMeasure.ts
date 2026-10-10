/**
 * @module @commise/features-recipes/form — the add field's leading-measure reader (`docs/architecture/uiOverhaulBlueprint.md`
 * A1; build spec §7.5.3). The cook types the amount and a known unit in front of the food search ("2 tbsp olive oil,
 * for frying"); this splits that text into the measure the row is committed with, the words the food search is asked,
 * and the preparation.
 *
 * - **The amount** comes from `numeric-quantity`: numbers, mixed numbers, ASCII and unicode fractions, and non-ASCII
 *   decimal digits. Roman numerals stay off. A range is two amounts joined by `-`, `–`, `—` or `to`: these separators,
 *   a known unit glued to its amount (`200g`) and the `of` after a unit (`2 cups of flour`) are this module's only own
 *   grammar. An inverted range is swapped (the owner's rule for the draft's bounds, 2026-09-12).
 * - **The known unit** (or a size word, `isSizeWord`: "1 large onion") is the next one or two tokens, CASE PRESERVED (`T` is a tablespoon, `t` a teaspoon), known when
 *   recipe-core's `classifyUnit` knows it, and stored as `normalizeUnit` spells it. "Known" has ONE authority:
 *   `parse-ingredient`'s second vocabulary is refused here (A1 rejection 2; `recipe-import-core`'s `ingredientLine.ts`
 *   records the `T.`/`t.` disagreement two vocabularies produced).
 * - **A comma inside an amount** is a decimal point when one or two digits follow it (`1,5 kg`), and groups thousands
 *   only in the `1,000` / `12,345` / `1,000,000` shape. Any other comma inside digits is ambiguous, and no amount is read.
 * - **The preparation** is what follows the first comma that is not inside a number (`1,000 g`, `1,5 kg`).
 * - **The search** is the rest; with no leading amount it is the whole text before the comma.
 *
 * The amount goes through recipe-core's `statedQuantity`, so this cannot produce a quantity the wire refuses. The row
 * editor's Amount field reads each bound with the same amount rules (`readAmountField`).
 *
 * ⚠️ PLATFORM PRECONDITION (A1): `numeric-quantity` compiles `/\p{Nd}/gu` at module load, and the glued-unit split
 * below uses `\p{L}`. Both need Hermes' Unicode property escapes. Proven on the RN 0.86 Hermes Android emulator by the
 * `addIngredientLine` Maestro flow, which types a non-ASCII digit (`٣`) and reads it back as an amount.
 *
 * Pure and platform-agnostic.
 *
 * @pattern Parser — parse, don't validate, at the UI boundary
 * @pattern Specification — "known unit" delegated to recipe-core's `classifyUnit`, the single authority
 * @pattern Adapter over numeric-quantity
 */
import {
    ABSENT_QUANTITY,
    classifyUnit,
    isSizeWord,
    normalizeUnit,
    statedQuantity,
    type IngredientQuantity,
} from '@kitchensink/recipe-core';
import { numericQuantity } from 'numeric-quantity';

/** What the add field reads from the cook's text. */
export interface LeadingMeasureReading {
    /** The leading amount, or `ABSENT_QUANTITY` when none leads the text. */
    readonly quantity: IngredientQuantity;
    /** The known unit as `normalizeUnit` spells it; `''` when none. */
    readonly unit: string;
    /** What the food search is asked. */
    readonly search: string;
    /** What follows the first comma; `''` when none. */
    readonly preparation: string;
    /** The amount and unit as the cook typed them (the live reading's first part); `''` when none. */
    readonly measureText: string;
}

/** What the row editor's Amount field reads from one bound's text. */
export type AmountFieldReading =
    { readonly kind: 'blank' } | { readonly kind: 'amount'; readonly value: number } | { readonly kind: 'unreadable' };

/** The tokens that join two amounts into a range, compared lower-cased. */
const RANGE_WORDS: ReadonlySet<string> = new Set(['-', '–', '—', 'to']);

/** The dashes that join two amounts inside one token (`2-3`, `2–2.5`). */
const RANGE_DASH = /[-–—]/u;

/** A token's leading run of non-letters, then letters: `200g` → `200` and `g`. */
const GLUED_UNIT = /^([^\p{L}]+)(\p{L}.*)$/u;

/** One decimal digit, in any script. */
const DIGIT = /^\p{Nd}$/u;

/**
 * Where the preparation's comma is: the first comma not between two digits (`1,000 g` keeps its comma), or `-1`. A loop
 * rather than a lookbehind, which this module does not ask of the bundle's regex engine. Pure.
 */
function preparationCommaOf(text: string): number {
    const characters = [...text];
    let offset = 0;

    for (const [index, character] of characters.entries()) {
        const inNumber = DIGIT.test(characters[index - 1] ?? '') && DIGIT.test(characters[index + 1] ?? '');

        if (character === ',' && !inNumber) {
            return offset;
        }

        offset += character.length;
    }

    return -1;
}

/** A run of digits that holds a comma (`1,5`, `1,000`), and the one shape each comma reading allows. */
const COMMA_RUN = /[\p{Nd}.]*,[\p{Nd},.]*/gu;
const THOUSANDS = /^\p{Nd}{1,3}(?:,\p{Nd}{3})+$/u;
const DECIMAL_COMMA = /^\p{Nd}+,\p{Nd}{1,2}$/u;

/**
 * Which character the amount in `text` uses as its decimal point, or `undefined` when a comma in it is ambiguous.
 *
 * A comma followed by one or two digits is a decimal point (`1,5`, `12,50`); only `\d{1,3}(,\d{3})+` groups thousands
 * (`1,000`, `12,345`). Any other comma inside digits (`1,5000`), or decimal and grouping commas in one text, is
 * ambiguous: no amount is read rather than a wrong one. Pure.
 */
function decimalSeparatorOf(text: string): ',' | '.' | undefined {
    const runs = text.match(COMMA_RUN) ?? [];

    if (runs.every((run) => THOUSANDS.test(run))) {
        return '.';
    }

    return runs.every((run) => DECIMAL_COMMA.test(run)) ? ',' : undefined;
}

/** A positive, finite amount `numeric-quantity` reads from the whole of `text`, or `undefined`. Pure. */
function amountOf(text: string): number | undefined {
    const decimalSeparator = decimalSeparatorOf(text);

    if (decimalSeparator === undefined) {
        return undefined;
    }

    const value = numericQuantity(text, { decimalSeparator });

    return Number.isFinite(value) && value > 0 ? value : undefined;
}

/** An amount read from the tokens, and how many tokens it took. */
interface AmountRead {
    readonly low: number;
    readonly high?: number;
    readonly taken: number;
}

/**
 * One amount at `tokens[at]`: a mixed number over two tokens (`1 1/2`), else one token, which may be a dash-joined
 * range (`2-3`) or a hyphenated mixed number (`1-1/2`). Pure.
 */
function amountAt(tokens: readonly string[], at: number): AmountRead | undefined {
    const first = tokens[at];

    if (first === undefined) {
        return undefined;
    }

    const next = tokens[at + 1];
    const mixed = next === undefined ? undefined : amountOf(`${first} ${next}`);

    if (mixed !== undefined) {
        return { low: mixed, taken: 2 };
    }

    const single = amountOf(first);

    if (single !== undefined) {
        return { low: single, taken: 1 };
    }

    // `1-1/2` is a mixed number; `2-3` and `2–2.5` are not, so they are ranges.
    const dash = RANGE_DASH.exec(first);

    if (dash === null || dash.index === 0) {
        return undefined;
    }

    const hyphenatedMixed = amountOf(`${first.slice(0, dash.index)} ${first.slice(dash.index + 1)}`);

    if (hyphenatedMixed !== undefined) {
        return { low: hyphenatedMixed, taken: 1 };
    }

    const low = amountOf(first.slice(0, dash.index));
    const high = amountOf(first.slice(dash.index + 1));

    return low === undefined || high === undefined ? undefined : { low, high, taken: 1 };
}

/** The leading amount, a range over a separator included (`2 to 3`). Pure. */
function leadingAmount(tokens: readonly string[]): AmountRead | undefined {
    const first = amountAt(tokens, 0);

    if (first === undefined || first.high !== undefined) {
        return first;
    }

    const separator = tokens[first.taken];
    const second =
        separator !== undefined && RANGE_WORDS.has(separator.toLowerCase())
            ? amountAt(tokens, first.taken + 1)
            : undefined;

    return second === undefined || second.high !== undefined
        ? first
        : { low: first.low, high: second.low, taken: first.taken + 1 + second.taken };
}

/** Whether `token` is a unit recipe-core knows. Pure. */
const isKnownUnit = (token: string): boolean => classifyUnit(token) !== 'unknown';

/** Whether `token` can stand in the unit position after an amount: a known unit, or a size word ("1 large onion"). Pure. */
const isStatedUnit = (token: string): boolean => isKnownUnit(token) || isSizeWord(token);

/** A unit read from the tokens, and how many tokens it took. */
interface UnitRead {
    readonly unit: string;
    readonly taken: number;
}

/** The unit at `tokens[at]` (known, or a size word): two tokens first (`fl oz`, `extra large`), then one. Pure. */
function unitAt(tokens: readonly string[], at: number): UnitRead | undefined {
    const first = tokens[at];
    const second = tokens[at + 1];

    if (first === undefined) {
        return undefined;
    }

    if (second !== undefined && isStatedUnit(`${first} ${second}`)) {
        return { unit: normalizeUnit(`${first} ${second}`), taken: 2 };
    }

    return isStatedUnit(first) ? { unit: normalizeUnit(first), taken: 1 } : undefined;
}

/** `200g butter` → `200 g butter`: a known unit glued to its amount is split off. Anything else is left whole. Pure. */
function splitGluedUnit(tokens: readonly string[]): readonly string[] {
    const [first, ...rest] = tokens;
    const glued = first === undefined ? null : GLUED_UNIT.exec(first);

    if (glued === null) {
        return tokens;
    }

    const [, amount = '', unit = ''] = glued;

    return amountAt([amount], 0) !== undefined && isKnownUnit(unit) ? [amount, unit, ...rest] : tokens;
}

/** The quantity two bounds state, swapped when inverted. Pure. */
function quantityOf(read: AmountRead): IngredientQuantity {
    const { low, high } = read;

    if (high === undefined) {
        return statedQuantity(low) ?? ABSENT_QUANTITY;
    }

    return statedQuantity(Math.min(low, high), Math.max(low, high)) ?? ABSENT_QUANTITY;
}

/**
 * Read the measure the cook typed in front of the food search.
 *
 * @param text - The add field's text.
 * @returns The quantity, the known unit, the search, the preparation, and the measure as typed. Pure.
 */
export function readLeadingMeasure(text: string): LeadingMeasureReading {
    const comma = preparationCommaOf(text);
    const head = comma === -1 ? text : text.slice(0, comma);
    const preparation = comma === -1 ? '' : text.slice(comma + 1).trim();
    const typedTokens = head
        .trim()
        .split(/\s+/u)
        .filter((token) => token !== '');
    const tokens = splitGluedUnit(typedTokens);
    const glued = tokens.length !== typedTokens.length;
    const amount = leadingAmount(tokens);

    if (amount === undefined) {
        return { quantity: ABSENT_QUANTITY, unit: '', search: typedTokens.join(' '), preparation, measureText: '' };
    }

    const unit = unitAt(tokens, amount.taken);
    const measureEnd = amount.taken + (unit?.taken ?? 0);
    // `2 cups of flour`: the `of` belongs to the measure, never to the food search.
    const searchStart = unit !== undefined && tokens[measureEnd]?.toLowerCase() === 'of' ? measureEnd + 1 : measureEnd;
    // A glued `200g` is one typed token for two read ones, so the typed measure is one token shorter.
    const typedMeasure = typedTokens.slice(0, glued ? measureEnd - 1 : measureEnd).join(' ');

    return {
        quantity: quantityOf(amount),
        unit: unit?.unit ?? '',
        search: tokens.slice(searchStart).join(' '),
        preparation,
        measureText: typedMeasure,
    };
}

const BLANK_FIELD: AmountFieldReading = { kind: 'blank' };
/** A decimal separator with nothing after it yet (`1.` on the way to `1.5`). */
const TRAILING_SEPARATOR = /(\p{Nd})[.,]$/u;
const UNREADABLE_FIELD: AmountFieldReading = { kind: 'unreadable' };

/**
 * Read one bound of the row editor's Amount field with this module's amount rules: the WHOLE text is one amount, or it
 * is blank, or it is unreadable. A unit or a range inside one bound's field is not one amount, and neither is zero or a
 * negative. A decimal separator with nothing after it yet reads as the number before it (`1.` is 1), so the field is not
 * marked while the cook types `1.5`. Never `NaN`, so the draft can never hold one (`quantity.ts`).
 *
 * @param text - The field's text.
 * @returns What the text states. Pure.
 */
export function readAmountField(text: string): AmountFieldReading {
    const tokens = text
        .trim()
        .replace(TRAILING_SEPARATOR, '$1')
        .split(/\s+/u)
        .filter((token) => token !== '');

    if (tokens.length === 0) {
        return BLANK_FIELD;
    }

    const read = amountAt(tokens, 0);

    return read === undefined || read.high !== undefined || read.taken !== tokens.length
        ? UNREADABLE_FIELD
        : { kind: 'amount', value: read.low };
}

/** A measure phrase as the cook stated it: the amount this module reads at its start, and the words after it. */
export interface StatedMeasureReading {
    /** The leading amount, or `ABSENT_QUANTITY` when the phrase states none this module reads ("a handful"). */
    readonly quantity: IngredientQuantity;
    /** The words after the amount, as the cook wrote them, a trailing `of` dropped; the whole phrase with no amount. */
    readonly words: string;
}

/**
 * Read a measure phrase the cook stated (a parse's `statedMeasure`: "2 tbsp", "1 large", "a handful") with this
 * module's amount rules, keeping the rest in the cook's own words rather than as `normalizeUnit` spells it.
 *
 * @param phrase - The measure phrase.
 * @returns The amount and the cook's words after it. Pure.
 */
export function readStatedMeasure(phrase: string): StatedMeasureReading {
    const tokens = splitGluedUnit(
        phrase
            .trim()
            .split(/\s+/u)
            .filter((token) => token !== ''),
    );
    const amount = leadingAmount(tokens);
    const rest = amount === undefined ? tokens : tokens.slice(amount.taken);
    const words = rest.at(-1)?.toLowerCase() === 'of' ? rest.slice(0, -1) : rest;

    return { quantity: amount === undefined ? ABSENT_QUANTITY : quantityOf(amount), words: words.join(' ') };
}

/**
 * The unit of a reading as the cook typed it ("tbsp", "Tbsp.", "large"), a trailing `of` dropped; `''` when the text
 * stated no measure. Build spec §7.5.3: the amount and unit the cook typed are the cook's own statement and nothing
 * later overwrites them, so a line is committed with THIS, never with `reading.unit` (`normalizeUnit`'s spelling,
 * which only the live reading's accessible text uses). The add field and a pasted line both call it, so the rule has
 * one home. Pure.
 *
 * @param reading - What {@link readLeadingMeasure} read.
 * @returns The cook's own unit words.
 */
export function statedUnitOf(reading: LeadingMeasureReading): string {
    return reading.measureText === '' ? '' : readStatedMeasure(reading.measureText).words;
}
