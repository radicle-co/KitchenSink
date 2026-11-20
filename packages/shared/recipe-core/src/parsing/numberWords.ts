/**
 * The English number/fraction lexicon a line of recipe text is written in: an imported ingredient line and a step's
 * time in words.
 *
 * DESIGN PATTERN: Registry, whose intent is already satisfied by a module-scope `ReadonlyMap` — there is
 * no registry class here and none is wanted. This file is data over a closed ~50-word vocabulary, plus the one
 * function that reads a whole number from it (`readNumberWords`). The grammar that composes fractions from entries is
 * `normalizeQuantity`, and the arithmetic is `fraction.js`.
 *
 * ⛔ LIBRARY-FIRST JUSTIFICATION (measured 2026-08-19; re-verified in this workspace on the same date —
 * do not re-litigate, and do not replace this table with a "words to numbers" package):
 *
 * - `parse-ingredient@2.2.0` (MIT, ~1,900 dl/wk) — the importer's choice, and it IS used for unit + description
 *   extraction. It cannot read number WORDS:
 *   measured to return `quantity: null` for `"one tablespoon of butter"`, `"two-thirds cup of flour"` and
 *   `"one-half teaspoon salt"` — which is the notation an entire 1900s cookbook is written in.
 * - `fraction.js@5.3.4` (MIT, ~51M dl/wk) — USED for every rational operation by its user, `normalizeQuantity`.
 *   Fraction arithmetic is never done by hand and `2/3` is never allowed to become `0.6666666666666666` internally.
 * - `numerizer@0.0.4` — REJECTED. Last published 2022-06-22 (dormant), and measured to emit the CORRUPTED string
 *   `"2-<frac>2 pounds of beef"` for `"one and one-half pounds of beef"`.
 * - `words-to-numbers@1.5.1` (~41k dl/wk, maintained) — REJECTED for fractions. Measured to produce
 *   `"1-half"` for `"one-half"` and `"2-thirds"` for `"two-thirds"`: it cannot represent a fraction at all.
 *
 * No maintained library was found that reads English FRACTION words, so the hand-authored part is reduced
 * to the smallest thing that cannot be bought — a lexicon.
 */

/**
 * Whole-number words, including the indefinite articles.
 *
 * `a`/`an` map to 1 because `"a pinch of salt"` states a quantity of one pinch. That reading is suppressed
 * by {@link INDEFINITE_QUALIFIERS} where the article introduces an indefinite amount instead.
 *
 * The tens beyond sixty are present although no requirement named them: this is a CLOSED set, and leaving
 * a hole at `seventy` would make `"seventy minutes"` unreadable for no reason a reader could reconstruct.
 *
 * Exported only so the table's own test can assert it entry by entry; readers go through {@link readNumberWords}.
 */
export const WHOLE_NUMBER_WORDS: ReadonlyMap<string, number> = new Map([
    ['a', 1],
    ['an', 1],
    ['one', 1],
    ['two', 2],
    ['three', 3],
    ['four', 4],
    ['five', 5],
    ['six', 6],
    ['seven', 7],
    ['eight', 8],
    ['nine', 9],
    ['ten', 10],
    ['eleven', 11],
    ['twelve', 12],
    ['thirteen', 13],
    ['fourteen', 14],
    ['fifteen', 15],
    ['sixteen', 16],
    ['seventeen', 17],
    ['eighteen', 18],
    ['nineteen', 19],
    ['twenty', 20],
    ['thirty', 30],
    ['forty', 40],
    ['fifty', 50],
    ['sixty', 60],
    ['seventy', 70],
    ['eighty', 80],
    ['ninety', 90],
]);

/**
 * Words that MULTIPLY the count before them (`"two dozen"` = 24), which is why they are not in
 * {@link WHOLE_NUMBER_WORDS} — a table that mixed the two would make `"two dozen"` read as 14.
 */
export const MULTIPLIER_WORDS: ReadonlyMap<string, number> = new Map([
    ['dozen', 12],
    ['dozens', 12],
    ['hundred', 100],
]);

/**
 * Fraction words as DENOMINATORS. Every English fraction word is a unit fraction, so the numerator always
 * comes from the count word beside it (`"two thirds"` = 2 x 1/3) and storing whole rationals here would
 * duplicate that composition once per numerator.
 */
export const FRACTION_WORD_DENOMINATORS: ReadonlyMap<string, number> = new Map([
    ['half', 2],
    ['halves', 2],
    ['third', 3],
    ['thirds', 3],
    ['quarter', 4],
    ['quarters', 4],
    ['fourth', 4],
    ['fourths', 4],
    ['fifth', 5],
    ['fifths', 5],
    ['sixth', 6],
    ['sixths', 6],
    ['eighth', 8],
    ['eighths', 8],
    ['tenth', 10],
    ['tenths', 10],
    ['sixteenth', 16],
    ['sixteenths', 16],
]);

/**
 * Words after `a`/`an` that make the article an INDEFINITE amount rather than a count of one, so
 * `"a little water"` yields no quantity instead of a fabricated `1`.
 *
 * Exactly these two, because exactly these two were measured in the corpus: across Project Gutenberg
 * #12350 (`The International Jewish Cook Book`, 1919), `"a little"` occurs 362 times and `"a few"` 194 —
 * more often than every genuine `a`-as-one phrase in the book combined (`"a pinch"` 74, `"a dozen"` 18,
 * `"a sprig"` 10, `"a stalk"` 2). Nothing speculative belongs here; add a word only with a count.
 *
 * Exported only so the table's own test can assert it entry by entry; readers go through {@link readNumberWords}.
 */
export const INDEFINITE_QUALIFIERS: ReadonlySet<string> = new Set(['little', 'few']);

/** Tens a unit word may follow to form a compound number (`"forty-five"` = 45). */
const TENS_VALUES: ReadonlySet<number> = new Set([20, 30, 40, 50, 60, 70, 80, 90]);

/** `a` and `an`, which state a count of one and are never the unit half of a compound. */
const INDEFINITE_ARTICLES: ReadonlySet<string> = new Set(['a', 'an']);

/**
 * Reads a whole-number word at `index`, compounds included (`"forty-five"`), as a plain integer.
 *
 * `a`/`an` read as one unless a qualifier follows (`"a little"`, `"a few"`), and they are excluded from the unit half
 * of a compound, so `"twenty a"` reads as 20. Matching is case-insensitive. Whole numbers are exact as numbers, so no
 * fraction type is needed here. Pure.
 *
 * @param words - The tokens of a line, one per entry. A punctuation token matches no number word.
 * @param index - Where to read.
 * @returns The value and the index of the first word not used, or `undefined` when no number word is at `index`.
 */
export function readNumberWords(
    words: readonly string[],
    index: number,
): { readonly value: number; readonly next: number } | undefined {
    const word = words[index]?.toLowerCase();
    const base = word === undefined ? undefined : WHOLE_NUMBER_WORDS.get(word);

    if (word === undefined || base === undefined) {
        return undefined;
    }

    if (INDEFINITE_ARTICLES.has(word)) {
        const following = words[index + 1]?.toLowerCase();

        return following !== undefined && INDEFINITE_QUALIFIERS.has(following)
            ? undefined
            : { value: base, next: index + 1 };
    }

    const nextWord = words[index + 1]?.toLowerCase();
    const nextValue = nextWord === undefined ? undefined : WHOLE_NUMBER_WORDS.get(nextWord);

    if (
        TENS_VALUES.has(base) &&
        nextWord !== undefined &&
        nextValue !== undefined &&
        nextValue >= 1 &&
        nextValue <= 9 &&
        !INDEFINITE_ARTICLES.has(nextWord)
    ) {
        return { value: base + nextValue, next: index + 2 };
    }

    return { value: base, next: index + 1 };
}
