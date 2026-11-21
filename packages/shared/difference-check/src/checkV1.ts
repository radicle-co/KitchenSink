/**
 * @module @kitchensink/difference-check: v1's decision, over a normaliser. The version-bound entry is
 * `differenceCheckV1`; this module takes the normaliser as a parameter so a test can leave a stage out.
 *
 * Pure.
 */
import { longestCommonSubsequence } from './measures/alignment.js';
import { keptShingles, longestSharedRun, newWordCount } from './measures/measures.js';
import { NUMBER_TOKEN, UNIT_TOKEN } from './normalise/foldQuantities.js';
import { V1_STOPWORDS } from './v1Stopwords.js';

/** What a check reports: the decision and the numbers behind it, and no text. */
export interface DifferenceCheckResult {
    readonly version: 'v1';
    /** Whether the new steps are different enough from the baseline. */
    readonly pass: boolean;
    /** Distinct baseline three-token shingles found in the new steps. */
    readonly kept: number;
    /** Distinct baseline three-token shingles. */
    readonly total: number;
    /** The longest shared run of tokens, capped at 64. */
    readonly longestRun: number;
    /** Distinct stemmed words in the new steps that the baseline does not have. */
    readonly newWords: number;
    /** The longest common subsequence of the two content sequences (measure L). */
    readonly aligned: number;
    /** The baseline's content-token count: what `aligned` is judged against. */
    readonly alignTotal: number;
}

/** The fewest distinct three-token shingles a baseline may hold (KTD-4). */
export const MINIMUM_BASELINE_SHINGLES = 20;

/** The longest shared run that still passes: a shared run of this many tokens fails (measure R). */
const LONGEST_PASSING_RUN = 8;

/** The fewest new stemmed words that pass (measure F). */
const MINIMUM_NEW_WORDS = 5;

/**
 * Judge new steps text against a baseline.
 *
 * @param normalise - Text to tokens.
 * @param baselineText - The stored original steps text.
 * @param stepsText - The new steps text.
 * @returns The result. A baseline under the minimum, one with no content word, or empty new steps, never passes.
 */
export function runCheck(
    normalise: (text: string) => string[],
    baselineText: string,
    stepsText: string,
): DifferenceCheckResult {
    const original = normalise(baselineText);
    const steps = normalise(stepsText);
    const { kept, total } = keptShingles(original, steps);
    const longestRun = longestSharedRun(original, steps);
    const newWords = newWordCount(original, steps);

    // Stage 6 (KTD-2): what L does not compare. The stopwords run the same stages as the text. An ingredient word is a
    // content word like any other: removing them would help a spinner who swaps only the other words (po, 2026-11-21).
    const dropped = new Set([NUMBER_TOKEN, UNIT_TOKEN, ...normalise([...V1_STOPWORDS].join(' '))]);
    const content = (tokens: readonly string[]): string[] => tokens.filter((token) => !dropped.has(token));
    const originalContent = content(original);
    const aligned = longestCommonSubsequence(originalContent, content(steps));
    const alignTotal = originalContent.length;

    const measuresPass =
        5 * kept <= total &&
        longestRun <= LONGEST_PASSING_RUN &&
        newWords >= MINIMUM_NEW_WORDS &&
        alignTotal > 0 &&
        20 * aligned <= 9 * alignTotal;

    return {
        version: 'v1',
        pass: total >= MINIMUM_BASELINE_SHINGLES && steps.length > 0 && measuresPass,
        kept,
        total,
        longestRun,
        newWords,
        aligned,
        alignTotal,
    };
}
