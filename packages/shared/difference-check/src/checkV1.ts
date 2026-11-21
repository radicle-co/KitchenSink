/**
 * @module @kitchensink/difference-check: v1's decision, over a normaliser. The version-bound entry is
 * `differenceCheckV1`; this module takes the normaliser as a parameter so a test can leave a stage out.
 *
 * Pure.
 */
import { keptShingles, longestSharedRun, newWordCount } from './measures/measures.js';

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
}

/** The fewest distinct three-token shingles a baseline may hold (KTD-4). */
export const MINIMUM_BASELINE_SHINGLES = 20;

/** The longest shared run that still passes: a shared run of this many tokens fails (measure R). */
const LONGEST_PASSING_RUN = 8;

/** The fewest new stemmed words that pass (measure F). */
const MINIMUM_NEW_WORDS = 5;

/**
 * Judge new steps text against a baseline text.
 *
 * @param normalise - Text to tokens.
 * @param baselineText - The stored original steps text.
 * @param stepsText - The new steps text.
 * @returns The result. A baseline under the minimum, or empty new steps, never passes.
 */
export function runCheck(
    normalise: (text: string) => string[],
    baselineText: string,
    stepsText: string,
): DifferenceCheckResult {
    const baseline = normalise(baselineText);
    const steps = normalise(stepsText);
    const { kept, total } = keptShingles(baseline, steps);
    const longestRun = longestSharedRun(baseline, steps);
    const newWords = newWordCount(baseline, steps);
    const measuresPass = 5 * kept <= total && longestRun <= LONGEST_PASSING_RUN && newWords >= MINIMUM_NEW_WORDS;

    return {
        version: 'v1',
        pass: total >= MINIMUM_BASELINE_SHINGLES && steps.length > 0 && measuresPass,
        kept,
        total,
        longestRun,
        newWords,
    };
}
