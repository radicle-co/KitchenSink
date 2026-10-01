import Fraction from 'fraction.js';

import {
    FRACTION_WORD_DENOMINATORS,
    INDEFINITE_QUALIFIERS,
    MULTIPLIER_WORDS,
    WHOLE_NUMBER_WORDS,
} from './quantityWords.js';

/**
 * The reading of a line's LEADING quantity phrase.
 *
 * DESIGN PATTERN: Value Object. Four facts about one match, all independently used: `quantity` by the
 * scalar normalizers (which have no `parse-ingredient` step to fall back on), `line` by the ingredient-line
 * facade (which hands it to `parse-ingredient`), and `phrase`/`rest` by any caller walking consecutive
 * terms — so the grammar lives here once instead of being re-implemented per caller.
 */
export interface NormalizedQuantity {
    /**
     * The input with a WORD-form quantity phrase rewritten as a numeral `parse-ingredient` can read
     * (`"two-thirds cup"` -> `"2/3 cup"`). Identical to the input when the phrase was already a numeral,
     * and when nothing matched.
     */
    readonly line: string;
    /** The exact rational the phrase states, or `null` when the line opens with no quantity phrase. */
    readonly quantity: Fraction | null;
    /** The source text consumed, verbatim (`"one and one-half"`). Empty when nothing matched. */
    readonly phrase: string;
    /** Everything after the consumed phrase. The whole input when nothing matched, so a caller loop ends. */
    readonly rest: string;
}

/**
 * Longest prefix examined for a quantity phrase.
 *
 * A leading quantity phrase is never long — `"two and three-quarters"` is 22 characters — and an
 * "ingredient line" arriving from an untrusted import can be megabytes. Bounding the window is what keeps
 * a hostile field from turning tokenization into the expensive part of the import.
 */
const QUANTITY_WINDOW_CHARS = 64;

/**
 * A token is a slashed fraction, a (possibly signed, possibly decimal) numeral, or a run of non-space
 * non-hyphen characters.
 *
 * The hyphen is a SEPARATOR, not part of a word, because `"one-half"` and `"one half"` are the same
 * quantity and `"forty-five"` is one number. It is admitted as a sign only in the numeral alternative,
 * which is what lets `"-30 minutes"` read as negative while `"15-20 minutes"` still splits into two terms.
 */
const TOKEN_PATTERN = /\d+\/\d+|-?\d+(?:\.\d+)?|[^\s\-–—]+/g;

/** Values that may be followed by a unit word to form a compound number (`"forty-five"` = 45). */
const TENS_VALUES: ReadonlySet<number> = new Set([20, 30, 40, 50, 60, 70, 80, 90]);

interface Token {
    readonly text: string;
    readonly start: number;
    readonly end: number;
}

/** A successful read: the value, and the index of the first token NOT consumed. */
interface Reading {
    readonly value: Fraction;
    readonly next: number;
}

/** Split the scan window into tokens with their offsets in the original line. */
function tokenize(window: string): readonly Token[] {
    return [...window.matchAll(TOKEN_PATTERN)].map((match) => ({
        text: match[0],
        start: match.index,
        end: match.index + match[0].length,
    }));
}

/** `fraction.js` throws on anything it cannot represent (including `1/0`); this module must be total. */
function toFraction(literal: string): Fraction | null {
    try {
        const value = new Fraction(literal);

        return Number.isFinite(value.valueOf()) ? value : null;
    } catch {
        return null;
    }
}

/**
 * A Unicode vulgar fraction is any character whose NFKD decomposition is `digits FRACTION-SLASH digits`.
 *
 * ⚠️ Applied PER TOKEN and anchored, which is the whole difference between this working and the naive
 * form that does not: NFKD over the WHOLE string turns `"1½"` into `"11⁄2"` — eleven halves, not one and
 * a half. The tokenizer has already split `"1½"` into `1` and `½`, so each half decomposes unambiguously.
 * Deriving the value from the decomposition rather than from a hand-written table is also what makes the
 * whole block work — `⅜`, `⅚` and `↉` cost nothing and cannot be forgotten.
 */
const DECOMPOSED_VULGAR_FRACTION = /^(\d+)⁄(\d+)$/u;

/** Reads a single vulgar-fraction character (`½`, `⅔`, `⅜`) as its exact rational. */
function readVulgarFraction(tokens: readonly Token[], index: number): Reading | null {
    const token = tokens[index];

    if (token === undefined) {
        return null;
    }

    const value = vulgarFractionValue(token.text);

    return value === null ? null : { value, next: index + 1 };
}

/** The rational a lone vulgar-fraction character states, or `null` when it is not one. */
function vulgarFractionValue(text: string): Fraction | null {
    const match = DECOMPOSED_VULGAR_FRACTION.exec(text.normalize('NFKD'));

    return match === null ? null : toFraction(`${match[1]}/${match[2]}`);
}

function isNumeralToken(token: Token | undefined): boolean {
    return token !== undefined && /^-?\d/.test(token.text);
}

function wordValue(token: Token | undefined): number | undefined {
    return token === undefined ? undefined : WHOLE_NUMBER_WORDS.get(token.text.toLowerCase());
}

/**
 * Reads `"1 1/2"`, `"1½"`, `"2/3"`, `"1.5"`, `"3"` and `"-30"` — the notations `fraction.js` parses
 * natively, plus the MIXED numeral whose fraction part is a single vulgar-fraction character.
 */
function readNumeral(tokens: readonly Token[], index: number): Reading | null {
    const first = tokens[index];

    if (!isNumeralToken(first) || first === undefined) {
        return null;
    }

    const whole = toFraction(first.text);

    if (whole === null) {
        return null;
    }

    const second = tokens[index + 1];

    if (/^\d+$/.test(first.text) && second !== undefined) {
        const fractionPart = /^\d+\/\d+$/.test(second.text)
            ? toFraction(second.text)
            : vulgarFractionValue(second.text);

        if (fractionPart !== null) {
            return { value: whole.add(fractionPart), next: index + 2 };
        }
    }

    return { value: whole, next: index + 1 };
}

/**
 * Reads a whole-number word, including a compound like `"forty-five"` (tens + unit).
 *
 * `a`/`an` are excluded from the unit half of a compound, so `"twenty a"` cannot read as 21.
 */
function readWholeWord(tokens: readonly Token[], index: number): Reading | null {
    const token = tokens[index];
    const base = wordValue(token);

    if (token === undefined || base === undefined) {
        return null;
    }

    // `a`/`an` state a count of one only when they are not introducing an indefinite amount.
    if (base === 1 && /^an?$/i.test(token.text)) {
        const following = tokens[index + 1];

        if (following !== undefined && INDEFINITE_QUALIFIERS.has(following.text.toLowerCase())) {
            return null;
        }
    }

    const nextToken = tokens[index + 1];
    const nextValue = wordValue(nextToken);

    if (
        TENS_VALUES.has(base) &&
        nextToken !== undefined &&
        nextValue !== undefined &&
        nextValue >= 1 &&
        nextValue <= 9 &&
        !/^an?$/i.test(nextToken.text)
    ) {
        return { value: new Fraction(base + nextValue), next: index + 2 };
    }

    return { value: new Fraction(base), next: index + 1 };
}

/** Reads `"half"`, `"one-half"`, `"two thirds"`, `"3/4"`-as-words — a count word times a unit fraction. */
function readFractionWords(tokens: readonly Token[], index: number): Reading | null {
    const count = readWholeWord(tokens, index) ?? readNumeral(tokens, index);
    const fractionIndex = count === null ? index : count.next;
    const fractionToken = tokens[fractionIndex];
    const denominator =
        fractionToken === undefined ? undefined : FRACTION_WORD_DENOMINATORS.get(fractionToken.text.toLowerCase());

    if (denominator === undefined) {
        return null;
    }

    const numerator = count?.value ?? new Fraction(1);
    let next = fractionIndex + 1;

    // "half a cup" is 1/2 cup: the article belongs to the fraction, not to the unit that follows it.
    if (count === null && /^an?$/i.test(tokens[next]?.text ?? '')) {
        next += 1;
    }

    return { value: numerator.div(denominator), next };
}

/** Applies a trailing multiplier word (`"two dozen"`, `"one hundred"`, `"one-half dozen"`). */
function applyMultiplier(tokens: readonly Token[], reading: Reading): Reading {
    const token = tokens[reading.next];
    const multiplier = token === undefined ? undefined : MULTIPLIER_WORDS.get(token.text.toLowerCase());

    return multiplier === undefined ? reading : { value: reading.value.mul(multiplier), next: reading.next + 1 };
}

/** The full grammar: an optional whole part, `and`, then a fraction part — or either alone. */
function readPhrase(tokens: readonly Token[]): Reading | null {
    const whole = readWholeWord(tokens, 0) ?? readNumeral(tokens, 0);

    if (whole !== null && tokens[whole.next]?.text.toLowerCase() === 'and') {
        const fractionPart = readFractionWords(tokens, whole.next + 1) ?? readVulgarFraction(tokens, whole.next + 1);

        if (fractionPart !== null) {
            return applyMultiplier(tokens, { value: whole.value.add(fractionPart.value), next: fractionPart.next });
        }
    }

    // A fraction reading subsumes the whole reading when both match ("one-half" is 1/2, not 1).
    const fractionOnly = readFractionWords(tokens, 0) ?? readVulgarFraction(tokens, 0);

    if (fractionOnly !== null) {
        return applyMultiplier(tokens, fractionOnly);
    }

    return whole === null ? null : applyMultiplier(tokens, whole);
}

/**
 * Separators that make two adjacent quantities ONE range rather than two terms.
 *
 * ⚠️ ONE OWNER, THREE CALLERS — {@link normalizeQuantityRange} here, and `normalizeDurationToMinutes` and
 * `normalizeServings` in `valueNormalizers.ts`, which previously declared their own copy. What counts as a
 * range boundary is a fact about the number grammar, and the grammar lives in this module.
 */
export const RANGE_SEPARATOR = /^\s*(?:to|or|through|[-–—])\s*/i;

/**
 * Read the LEADING English quantity phrase of a line and rewrite it as a numeral.
 *
 * DESIGN PATTERN: Adapter. It translates 1900s cookbook prose into the input dialect `parse-ingredient`
 * accepts, and exposes the exact rational for the callers that have no downstream parser.
 *
 * Pure and TOTAL: a line that opens with no quantity phrase comes back unchanged with a `null` quantity,
 * and no input throws.
 *
 * ⚠️ **Unicode vulgar fractions ARE read here, reversing this module's earlier decision.** That decision
 * said they were "deliberately NOT read — Unicode NFKD turns `1½` into `11/2` (5.5, not 1.5), and
 * `parse-ingredient` reads them correctly downstream anyway." Its first premise still stands and is
 * honoured: NFKD is applied PER TOKEN and anchored ({@link DECOMPOSED_VULGAR_FRACTION}), never to the
 * line, so the `11/2` trap cannot recur. Its second premise was measured FALSE in two directions:
 *
 *  1. This function's own reading won the caller's `??`, so `"1½ cups"` came back as **1** — the fraction
 *     was never handed downstream at all, and the line was flagged as certain.
 *  2. `normalizeDurationToMinutes` has no downstream parser to be saved by. `"1½ hours"` returned
 *     **60 minutes with `needsReview: false`**, and `cook_time_minutes` is `NOT NULL` on a published
 *     public recipe.
 *
 * @param line - One extracted, already-sanitized text field.
 * @returns The rewritten line, the exact rational, the consumed source phrase, and the remainder.
 */
export function normalizeQuantity(line: string): NormalizedQuantity {
    const nothing: NormalizedQuantity = { line, quantity: null, phrase: '', rest: line };
    const tokens = tokenize(line.slice(0, QUANTITY_WINDOW_CHARS));

    if (tokens.length === 0) {
        return nothing;
    }

    const reading = readPhrase(tokens);
    const first = tokens[0];
    const last = tokens[reading === null ? 0 : reading.next - 1];

    if (reading === null || first === undefined || last === undefined) {
        return nothing;
    }

    const phrase = line.slice(first.start, last.end);
    const rest = line.slice(last.end);

    // ⛔ THE INVARIANT: this module never claims a PREFIX of a longer numeric literal. A reading that runs
    // straight into another digit or number-like character has not read the whole number, and returning
    // its head as "the quantity" is the exact shape of the `1½ → 1` defect. Declining hands the line to
    // the downstream parser intact instead. `"15-20"` and `"-30"` are unaffected: a separator intervenes.
    if (/^[\d\p{No}]/u.test(rest)) {
        return nothing;
    }

    // A phrase written entirely in ASCII numerals needs no rewrite; rewriting it would only churn the
    // text. Anything else — number words, or a vulgar fraction — is rewritten into the dialect
    // `parse-ingredient` reads, so the downstream unit/description parse never depends on its notation
    // support.
    const rewritten = /[^\d\s./]/.test(phrase) ? reading.value.toFraction(true) + rest : line;

    return { line: rewritten, quantity: reading.value, phrase, rest };
}

/** A leading quantity phrase, or a leading two-bound RANGE of them, read from one line. */
export interface NormalizedQuantityRange {
    /**
     * The input with BOTH terms of a leading range rewritten as numerals (`"two to three cups"` ->
     * `"2 to 3 cups"`). Identical to {@link NormalizedQuantity.line} when the line states no range.
     */
    readonly line: string;
    /** The stated amount, or the range's lower bound. `null` when the line opens with no quantity. */
    readonly low: Fraction | null;
    /** The range's upper bound, or `null` when the line states one bound rather than two. */
    readonly high: Fraction | null;
    /** Everything after the consumed phrase (or the whole range). */
    readonly rest: string;
}

/**
 * Read a leading `X to Y` range, rewriting BOTH bounds as numerals.
 *
 * DESIGN PATTERN: Adapter, composed from {@link normalizeQuantity} twice — the grammar is not restated.
 * `phrase`/`rest` exist on that value object for precisely this walk.
 *
 * ⚠️ Rewriting BOTH terms is the point. Rewriting only the first leaves `"two to three cups of flour"` as
 * `"2 to three cups of flour"`, which `parse-ingredient` reads as quantity 2, NO unit, and the name
 * `"to three cups of flour"` — a wrong name and a lost unit, both reported as certain.
 *
 * A second term that is not itself a quantity is NOT a range: `"one teaspoon or more of vanilla"` states
 * one amount, and `"a 2-cup mold"` states no range at all.
 *
 * @param line - One extracted, already-sanitized text field.
 * @returns Both bounds and the line rewritten so a downstream parser sees numerals. Pure and TOTAL.
 */
export function normalizeQuantityRange(line: string): NormalizedQuantityRange {
    const first = normalizeQuantity(line);

    if (first.quantity === null) {
        return { line: first.line, low: null, high: null, rest: first.rest };
    }

    const separator = RANGE_SEPARATOR.exec(first.rest);

    if (separator === null) {
        return { line: first.line, low: first.quantity, high: null, rest: first.rest };
    }

    const second = normalizeQuantity(first.rest.slice(separator[0].length));

    if (second.quantity === null) {
        return { line: first.line, low: first.quantity, high: null, rest: first.rest };
    }

    return {
        line: `${first.quantity.toFraction(true)}${separator[0]}${second.quantity.toFraction(true)}${second.rest}`,
        low: first.quantity,
        high: second.quantity,
        rest: second.rest,
    };
}
