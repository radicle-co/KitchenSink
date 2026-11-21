/**
 * @module @kitchensink/difference-check/measures: the three measures of v1 over normalised tokens (KTD-3): A (kept
 * three-token shingles), R (the longest shared run) and F (new stemmed words).
 *
 * Linear in the tokens for A and F, and O(n log n) for R: no pairwise run matrix, which would be quadratic at the body
 * limit.
 *
 * Pure.
 */
import { NUMBER_TOKEN, UNIT_TOKEN } from '../normalise/foldQuantities.js';

/** The largest run R reports, which bounds the work. */
const RUN_CAP = 64;

/** A token no word can contain, so two different windows never join to the same key. */
const SEPARATOR = '\u0001';

/**
 * The distinct windows of `size` tokens.
 *
 * @param tokens - Normalised tokens.
 * @param size - The window size.
 * @returns A set of keys; empty for fewer tokens than `size`.
 */
export function shinglesOf(tokens: readonly string[], size: number): Set<string> {
    const shingles = new Set<string>();

    for (let start = 0; start + size <= tokens.length; start += 1) {
        shingles.add(tokens.slice(start, start + size).join(SEPARATOR));
    }

    return shingles;
}

/**
 * Measure A: the baseline's distinct three-token shingles found in the new text.
 *
 * @param baseline - The baseline tokens.
 * @param steps - The new steps' tokens.
 * @returns `kept` of `total` distinct baseline shingles.
 */
export function keptShingles(baseline: readonly string[], steps: readonly string[]): { kept: number; total: number } {
    const original = shinglesOf(baseline, 3);
    const present = shinglesOf(steps, 3);
    let kept = 0;

    for (const shingle of original) {
        if (present.has(shingle)) {
            kept += 1;
        }
    }

    return { kept, total: original.size };
}

/**
 * Measure R: the length of the longest run of tokens the two texts share, capped at 64.
 *
 * A shared run of length k holds a shared run of every shorter length, so the answer is found by binary search over the
 * window size.
 *
 * @param baseline - The baseline tokens.
 * @param steps - The new steps' tokens.
 * @returns 0 to 64.
 */
export function longestSharedRun(baseline: readonly string[], steps: readonly string[]): number {
    const shares = (size: number): boolean => {
        const original = shinglesOf(baseline, size);

        for (const shingle of shinglesOf(steps, size)) {
            if (original.has(shingle)) {
                return true;
            }
        }

        return false;
    };

    let low = 0;
    let high = Math.min(RUN_CAP, baseline.length, steps.length);

    while (low < high) {
        const middle = Math.ceil((low + high) / 2);

        if (shares(middle)) {
            low = middle;
        } else {
            high = middle - 1;
        }
    }

    return low;
}

/**
 * Measure F: the distinct stemmed words of the new text that the baseline does not have, numbers and units excluded.
 *
 * @param baseline - The baseline tokens.
 * @param steps - The new steps' tokens.
 * @returns The count.
 */
export function newWordCount(baseline: readonly string[], steps: readonly string[]): number {
    const known = new Set(baseline);
    const fresh = new Set<string>();

    for (const token of steps) {
        if (token !== NUMBER_TOKEN && token !== UNIT_TOKEN && !known.has(token)) {
            fresh.add(token);
        }
    }

    return fresh.size;
}
