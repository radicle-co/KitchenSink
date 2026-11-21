/**
 * @module @kitchensink/difference-check/measures: the longest common subsequence of two token sequences, the engine
 * of measure L (KTD-3).
 *
 * Bit-parallel (Hyyrö 2004), 32 bits to a word: O(n x ceil(m / 32)) for n new tokens against m baseline tokens, exact.
 * About 9 x 10^6 word steps at the 100 kB body limit, where a plain table is about 3 x 10^8 cells and blocks the event
 * loop of a save for hundreds of milliseconds. Hand-rolled on purpose: no npm package does it over token arrays, and the
 * Myers libraries (`diff-sequences`, `fast-myers-diff`) degrade to quadratic on independent texts, the common case.
 * `alignment.test.ts` holds it to a plain table on random sequences.
 *
 * Memory: one mask of `ceil(m / 32)` words for each distinct token the two sides share, at most about 36 MB at the body
 * limit, freed when the call returns.
 *
 * Pure.
 */

/** Bits to a word. */
const WORD_BITS = 32;

/** The largest unsigned 32-bit value. */
const WORD_MAX = 0xffffffff;

/**
 * The length of the longest common subsequence of two token sequences.
 *
 * @param baseline - The sequence held as bit vectors.
 * @param steps - The sequence read one token at a time.
 * @returns 0 to the shorter length.
 */
export function longestCommonSubsequence(baseline: readonly string[], steps: readonly string[]): number {
    if (baseline.length === 0 || steps.length === 0) {
        return 0;
    }

    const words = Math.ceil(baseline.length / WORD_BITS);
    const stepTokens = new Set(steps);
    const masks = new Map<string, Uint32Array>();

    // A token's mask holds a 1 at every place the baseline has it. A token the new steps lack never matches.
    baseline.forEach((token, place) => {
        if (!stepTokens.has(token)) {
            return;
        }

        let mask = masks.get(token);

        if (mask === undefined) {
            mask = new Uint32Array(words);
            masks.set(token, mask);
        }

        mask[place >>> 5] = (mask[place >>> 5] ?? 0) | (1 << (place & 31));
    });

    // A 1 in `vector` is a baseline place not yet matched. Each match clears one bit, so the zeros count the subsequence.
    const vector = new Uint32Array(words).fill(WORD_MAX);

    for (const token of steps) {
        const mask = masks.get(token);

        if (mask === undefined) {
            continue;
        }

        let carry = 0;

        for (let word = 0; word < words; word += 1) {
            const current = vector[word] ?? 0;
            const match = mask[word] ?? 0;
            // `>>> 0` keeps the match unsigned: bit 31 would make the plain `&` negative and corrupt the sum.
            const sum = current + ((current & match) >>> 0) + carry;

            carry = sum > WORD_MAX ? 1 : 0;
            vector[word] = sum | (current & ~match);
        }
    }

    let length = 0;

    for (let place = 0; place < baseline.length; place += 1) {
        length += 1 - (((vector[place >>> 5] ?? 0) >>> (place & 31)) & 1);
    }

    return length;
}
