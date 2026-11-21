/**
 * Synthetic words for the boundary cases: each one is its own normal form (the skeleton and the stemmer leave it
 * alone, and it is never a unit), so a case can count tokens exactly. `fixedPointsOfV1.test.ts` holds that claim.
 */

/** Consonant-only letters the confusables map and the Porter stemmer both leave alone. */
const SYLLABLE_LETTERS = ['b', 'd', 'f', 'h', 'k', 'p', 't', 'z'] as const;

/**
 * The `index`-th synthetic word: four letters from {@link SYLLABLE_LETTERS}, so up to 4096 distinct words.
 *
 * @param index - 0 to 4095.
 * @returns One word, lower case.
 */
export function synthWord(index: number): string {
    const base = SYLLABLE_LETTERS.length;
    let rest = index;
    let word = '';

    for (let place = 0; place < 4; place += 1) {
        word = `${SYLLABLE_LETTERS[rest % base] ?? 'b'}${word}`;
        rest = Math.floor(rest / base);
    }

    return word;
}

/**
 * `count` distinct synthetic words from `start`.
 *
 * @param count - How many.
 * @param start - The index of the first.
 * @returns The words, in order.
 */
export function synthWords(count: number, start = 0): string[] {
    return Array.from({ length: count }, (_, offset) => synthWord(start + offset));
}

/**
 * A text of the given words, one space apart.
 *
 * @param words - The words.
 * @returns The text.
 */
export function textOf(words: readonly string[]): string {
    return words.join(' ');
}
