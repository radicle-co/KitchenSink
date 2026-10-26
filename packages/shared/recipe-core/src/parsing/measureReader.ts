/**
 * The measure reader's amount rules and its stated-measure half (`docs/architecture/uiOverhaulBlueprint.md` A1; build
 * spec §7.5.3), shared by the editor's add field, a pasted line and recipe-service's paste matcher (ADR-0071).
 *
 * - **The amount** comes from `numeric-quantity`: numbers, mixed numbers, ASCII and unicode fractions, and non-ASCII
 *   decimal digits. Roman numerals stay off. A range is two amounts joined by `-`, `–`, `—` or `to`: these separators
 *   and a known unit glued to its amount (`200g`) are this module's only own grammar. An inverted range is swapped (the
 *   owner's rule for the draft's bounds, 2026-09-12).
 * - **A comma inside an amount** is a decimal point when one or two digits follow it (`1,5 kg`), and groups thousands
 *   only in the `1,000` / `12,345` / `1,000,000` shape. Any other comma inside digits is ambiguous, and no amount is read.
 * - **A stated measure** (a parse's `statedMeasure`: "2 tbsp", "1 large", "a handful") is read with these rules, and the
 *   words after the amount are kept AS THE COOK WROTE THEM, never as `normalizeUnit` spells them.
 *
 * ⛔ WHY IT LIVES HERE. The editor saves a pasted line with the measure this reads, and the paste matcher keys the
 * review gate's verdict with the same measure (`pastedLineMeasure.ts`). Two readers would key two judgements for one
 * kept line, and the save path would pay the gate again. It moved here from `@commise/features-recipes`'
 * `form/leadingMeasure.ts`, which still owns the add field's own grammar (the unit after the amount, the preparation,
 * the count unit after the food) and reads its amounts through this module.
 *
 * ⚠️ `@kitchensink/recipe-import-core` has a SECOND `readStatedMeasure`, which canonicalises the unit through
 * `parse-ingredient`'s vocabulary for the import comparator. The two answer different questions today and are a known
 * duplication for a later code-quality pass; this one is the editor's.
 *
 * ⚠️ PLATFORM PRECONDITION (A1): `numeric-quantity` compiles `/\p{Nd}/gu` at module load, and the glued-unit split
 * below uses `\p{L}`. Both need Hermes' Unicode property escapes, proven on the RN 0.86 Hermes Android emulator by the
 * `addIngredientLine` Maestro flow.
 *
 * Reachable ONLY as `@kitchensink/recipe-core/parsing/measure-reader`, never from the barrel: `contract-gen` hashes the
 * barrel, and this module has no wire projection. Pure and platform-agnostic.
 *
 * @pattern Parser — parse, don't validate, at the UI and service boundary
 * @pattern Adapter over numeric-quantity
 */
import { numericQuantity } from 'numeric-quantity';

import { ABSENT_QUANTITY, statedQuantity, type IngredientQuantity } from '../ingredientQuantity.js';
import { classifyUnit } from '../units.js';

/** The tokens that join two amounts into a range, compared lower-cased. */
const RANGE_WORDS: ReadonlySet<string> = new Set(['-', '–', '—', 'to']);

/** The dashes that join two amounts inside one token (`2-3`, `2–2.5`). */
const RANGE_DASH = /[-–—]/u;

/** A token's leading run of non-letters, then letters: `200g` → `200` and `g`. */
const GLUED_UNIT = /^([^\p{L}]+)(\p{L}.*)$/u;

/**
 * A run of digits, points and commas, and the one shape each comma reading allows. The runs that hold a comma (`1,5`,
 * `1,000`) are the ones read. Matched as one maximal run and FILTERED for a comma, not as `[\p{Nd}.]*,[\p{Nd},.]*`:
 * that pattern retries every position of a run with no comma in it, so it was quadratic in the run (CodeQL
 * `js/polynomial-redos`, alert 483). The two give the same runs: a run holding a comma is matched from its first
 * character either way.
 */
const NUMBER_RUN = /[\p{Nd},.]+/gu;
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
    const runs = (text.match(NUMBER_RUN) ?? []).filter((run) => run.includes(','));

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
export interface AmountRead {
    readonly low: number;
    readonly high?: number;
    readonly taken: number;
}

/**
 * One amount at `tokens[at]`: a mixed number over two tokens (`1 1/2`), else one token, which may be a dash-joined
 * range (`2-3`) or a hyphenated mixed number (`1-1/2`). Pure.
 */
export function amountAt(tokens: readonly string[], at: number): AmountRead | undefined {
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
export function leadingAmount(tokens: readonly string[]): AmountRead | undefined {
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

/** `200g butter` → `200 g butter`: a known unit glued to its amount is split off. Anything else is left whole. Pure. */
export function splitGluedUnit(tokens: readonly string[]): readonly string[] {
    const [first, ...rest] = tokens;
    const glued = first === undefined ? null : GLUED_UNIT.exec(first);

    if (glued === null) {
        return tokens;
    }

    const [, amount = '', unit = ''] = glued;

    return amountAt([amount], 0) !== undefined && isKnownUnit(unit) ? [amount, unit, ...rest] : tokens;
}

/** The quantity two bounds state, swapped when inverted. Pure. */
export function quantityOf(read: AmountRead): IngredientQuantity {
    const { low, high } = read;

    if (high === undefined) {
        return statedQuantity(low) ?? ABSENT_QUANTITY;
    }

    return statedQuantity(Math.min(low, high), Math.max(low, high)) ?? ABSENT_QUANTITY;
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
