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

function isNumeralToken(token: Token | undefined): boolean {
    return token !== undefined && /^-?\d/.test(token.text);
}

function wordValue(token: Token | undefined): number | undefined {
    return token === undefined ? undefined : WHOLE_NUMBER_WORDS.get(token.text.toLowerCase());
}

/** Reads `"1 1/2"`, `"2/3"`, `"1.5"`, `"3"` and `"-30"` — the notations `fraction.js` parses natively. */
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

    if (/^\d+$/.test(first.text) && second !== undefined && /^\d+\/\d+$/.test(second.text)) {
        const fractionPart = toFraction(second.text);

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
        const fractionPart = readFractionWords(tokens, whole.next + 1);

        if (fractionPart !== null) {
            return applyMultiplier(tokens, { value: whole.value.add(fractionPart.value), next: fractionPart.next });
        }
    }

    // A fraction reading subsumes the whole reading when both match ("one-half" is 1/2, not 1).
    const fractionOnly = readFractionWords(tokens, 0);

    if (fractionOnly !== null) {
        return applyMultiplier(tokens, fractionOnly);
    }

    return whole === null ? null : applyMultiplier(tokens, whole);
}

/**
 * Read the LEADING English quantity phrase of a line and rewrite it as a numeral.
 *
 * DESIGN PATTERN: Adapter. It translates 1900s cookbook prose into the input dialect `parse-ingredient`
 * accepts, and exposes the exact rational for the callers that have no downstream parser.
 *
 * Pure and TOTAL: a line that opens with no quantity phrase comes back unchanged with a `null` quantity,
 * and no input throws. Unicode vulgar fractions (`½`) are deliberately NOT read here — Unicode NFKD turns
 * `"1½"` into `"11/2"` (5.5, not 1.5), and `parse-ingredient` reads them correctly downstream anyway.
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
    // A phrase written entirely in numerals needs no rewrite; rewriting it would only churn the text.
    const rewritten = /[a-z]/i.test(phrase) ? reading.value.toFraction(true) + rest : line;

    return { line: rewritten, quantity: reading.value, phrase, rest };
}
