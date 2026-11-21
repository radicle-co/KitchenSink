/**
 * @module @kitchensink/difference-check: the difference check, version 1 (board P4a, plan paidSiteAdaptedUnlock KTD-1 to
 * KTD-4). It decides whether a cook's new steps are different enough from the stored original to earn "Adapted by you".
 * No AI is involved.
 *
 * SERVER ONLY. It carries Unicode's confusables map (200 kB), so it must never reach a client bundle: a guard in
 * `repoGuards` fails when any package that reaches a client declares or imports it. Not in `recipe-core`, which both apps
 * bundle.
 *
 * v1 is frozen: its normalisation, its measures, its units and its minimum size never change. A different answer is a new
 * sibling `differenceCheckV2`, never an edit here. It records the Unicode version it was frozen at and throws on another,
 * because `\p{L}`, NFKC and lower case follow the runtime's ICU.
 *
 * v1 limit, stated: scripts written without spaces between words (Chinese, Japanese, Thai) tokenise into long runs, miss
 * the minimum and never earn the fact. Accent-insensitive matching is deliberate.
 *
 * @pattern Strategy — one frozen version of the check, keyed by its version
 */
import { runCheck, MINIMUM_BASELINE_SHINGLES, type DifferenceCheckResult } from './checkV1.js';
import { DifferenceCheckError } from './differenceCheckError.js';
import { shinglesOf } from './measures/measures.js';
import { normaliseV1 } from './normalise/normaliseV1.js';

export type { DifferenceCheckResult } from './checkV1.js';
export { DifferenceCheckError, isDifferenceCheckError } from './differenceCheckError.js';
export { stepsTextOf, type StepInstruction } from './stepsText.js';

/** The Unicode version of the runtime v1 was frozen at (Node 24, ICU 78.3). */
export const FROZEN_UNICODE_VERSION = '17.0';

/** The part of the runtime v1 reads; injected so a test can state another. */
export interface CheckRuntime {
    readonly unicode: string;
}

/**
 * v1 on this runtime.
 *
 * @param runtime - The Unicode version in force.
 * @throws {DifferenceCheckError} On a Unicode version v1 was not frozen at.
 */
function assertFrozenRuntime(runtime: CheckRuntime): void {
    if (runtime.unicode !== FROZEN_UNICODE_VERSION) {
        throw new DifferenceCheckError(
            'runtime-unicode',
            `difference check v1 was frozen at Unicode ${FROZEN_UNICODE_VERSION}; this runtime has "${runtime.unicode}"`,
        );
    }
}

/**
 * Whether new steps text is different enough from the baseline text.
 *
 * @param baselineText - The stored original steps text (from `stepsTextOf`).
 * @param stepsText - The cook's new steps text (from `stepsTextOf`).
 * @param runtime - The runtime's Unicode version; defaults to this process.
 * @returns The decision and the numbers behind it.
 * @throws {DifferenceCheckError} On a runtime v1 was not frozen at. The caller treats it as a failed check.
 */
export function differenceCheckV1(
    baselineText: string,
    stepsText: string,
    runtime: CheckRuntime = { unicode: process.versions.unicode ?? '' },
): DifferenceCheckResult {
    assertFrozenRuntime(runtime);

    return runCheck(normaliseV1, baselineText, stepsText);
}

/**
 * Whether a baseline text is big enough to judge against: at least 20 distinct normalised three-token shingles (KTD-4).
 *
 * @param text - The steps text to store as a baseline.
 * @param runtime - The runtime's Unicode version; defaults to this process.
 * @throws {DifferenceCheckError} On a runtime v1 was not frozen at.
 */
export function baselineQualifiesV1(
    text: string,
    runtime: CheckRuntime = { unicode: process.versions.unicode ?? '' },
): boolean {
    assertFrozenRuntime(runtime);

    return shinglesOf(normaliseV1(text), 3).size >= MINIMUM_BASELINE_SHINGLES;
}
