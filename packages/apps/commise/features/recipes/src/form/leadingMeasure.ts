/**
 * @module @commise/features-recipes/form — the add field's leading-measure reader (`docs/architecture/uiOverhaulBlueprint.md`
 * A1; build spec §7.5.3). The cook types the amount and a known unit in front of the food search ("2 tbsp olive oil,
 * for frying"); this splits that text into the measure the row is committed with, the words the food search is asked,
 * and the preparation.
 *
 * - **The amount** is read by recipe-core's measure reader (`@kitchensink/recipe-core/parsing/measure-reader`):
 *   numbers, mixed numbers, fractions, non-ASCII digits, ranges, a known unit glued to its amount (`200g`) and the
 *   comma rules below. It moved there so a pasted line and recipe-service's paste matcher read a measure the same way
 *   (ADR-0071). The `of` after a unit (`2 cups of flour`) is this module's own grammar.
 * - **The known unit** (or a size word, `isSizeWord`: "1 large onion") is the next one or two tokens, CASE PRESERVED (`T` is a tablespoon, `t` a teaspoon), known when
 *   recipe-core's `classifyUnit` knows it, and stored as `normalizeUnit` spells it. "Known" has ONE authority:
 *   `parse-ingredient`'s second vocabulary is refused here (A1 rejection 2; `recipe-import-core`'s `ingredientLine.ts`
 *   records the `T.`/`t.` disagreement two vocabularies produced).
 * - **A count unit after the food** ("3 garlic cloves") is lifted into the unit when no unit follows the amount, so the
 *   cook's word is not lost into the food search. A closed list ({@link TRAILING_COUNT_UNITS}), never when the word is
 *   the whole search, and never when a spice word stands before `cloves` ("2 whole cloves" is the spice, a food search).
 * - **A comma inside an amount** is a decimal point when one or two digits follow it (`1,5 kg`), and groups thousands
 *   only in the `1,000` / `12,345` / `1,000,000` shape (the measure reader's rule).
 * - **The preparation** is what follows the first comma that is not inside a number (`1,000 g`, `1,5 kg`).
 * - **The search** is the rest; with no leading amount it is the whole text before the comma.
 *
 * The amount goes through recipe-core's `statedQuantity`, so this cannot produce a quantity the wire refuses. The row
 * editor's Amount field reads each bound with the same amount rules (`readAmountField`).
 *
 * ⚠️ PLATFORM PRECONDITION (A1): the measure reader compiles Unicode property escapes at module load, which need
 * Hermes. Proven on the RN 0.86 Hermes Android emulator by the `addIngredientLine` Maestro flow, which types a non-ASCII
 * digit (`٣`) and reads it back as an amount.
 *
 * Pure and platform-agnostic.
 *
 * @pattern Parser — parse, don't validate, at the UI boundary
 * @pattern Specification — "known unit" delegated to recipe-core's `classifyUnit`, the single authority
 */
import { ABSENT_QUANTITY, classifyUnit, isSizeWord, normalizeUnit, type IngredientQuantity } from '@kitchensink/recipe-core';
import {
    amountAt,
    leadingAmount,
    quantityOf,
    readStatedMeasure,
    splitGluedUnit,
} from '@kitchensink/recipe-core/parsing/measure-reader';

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

/** Whether `token` is a unit recipe-core knows. Pure. */
const isKnownUnit = (token: string): boolean => classifyUnit(token) !== 'unknown';

/** Whether `token` can stand in the unit position after an amount: a known unit, or a size word ("1 large onion"). Pure. */
const isStatedUnit = (token: string): boolean => isKnownUnit(token) || isSizeWord(token);

/**
 * The count units a cook may put AFTER the food ("3 garlic cloves", "4 bread slices"), as `normalizeUnit` spells them.
 * Closed on purpose: a unit that names a measure of its own (`cup`, `g`) is stated before the food, and a word outside
 * this list is a food ("2 eggs"). Each is a unit whose count the food shares ("garlic" is counted in "cloves").
 */
const TRAILING_COUNT_UNITS: ReadonlySet<string> = new Set(['clove', 'slice', 'stick', 'piece']);

/** The words that, before `cloves`, make it the spice and not a count of garlic: "2 whole cloves" stays a food search. */
const SPICE_QUALIFIERS: ReadonlySet<string> = new Set(['whole', 'ground', 'dried', 'powdered']);

/**
 * A count unit that ends the food search, lifted out of it: "garlic cloves" → unit `clove`, search `garlic`. Pure.
 *
 * @param searchTokens - The food search's words, after the amount.
 * @returns The unit, as the cook wrote the word and as `normalizeUnit` spells it, and the search without it; or
 *     `undefined` when the search does not end in a count unit, is only that word, or names the spice.
 */
function trailingCountUnit(
    searchTokens: readonly string[],
): { readonly written: string; readonly unit: string; readonly search: readonly string[] } | undefined {
    const written = searchTokens.at(-1);
    const before = searchTokens.at(-2);

    if (written === undefined || before === undefined) {
        return undefined;
    }

    const unit = normalizeUnit(written);

    if (!TRAILING_COUNT_UNITS.has(unit) || (unit === 'clove' && SPICE_QUALIFIERS.has(before.toLowerCase()))) {
        return undefined;
    }

    return { written, unit, search: searchTokens.slice(0, -1) };
}

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
    const search = tokens.slice(searchStart);
    // No unit after the amount: a count unit the cook put after the food is still their unit ("3 garlic cloves").
    const lifted = unit === undefined ? trailingCountUnit(search) : undefined;

    if (lifted !== undefined) {
        return {
            quantity: quantityOf(amount),
            unit: lifted.unit,
            search: lifted.search.join(' '),
            preparation,
            measureText: [typedMeasure, lifted.written].join(' '),
        };
    }

    return {
        quantity: quantityOf(amount),
        unit: unit?.unit ?? '',
        search: search.join(' '),
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
