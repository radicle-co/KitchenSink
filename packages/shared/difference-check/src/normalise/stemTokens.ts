/**
 * @module @kitchensink/difference-check/normalise: stage 5 of v1 (KTD-2): the Porter stem, with `stemmer` pinned to an exact
 * version, so a library update cannot move an answer.
 *
 * Pure.
 */
import { stemmer } from 'stemmer';

import { NUMBER_TOKEN, UNIT_TOKEN } from './foldQuantities.js';

/**
 * Stage 5.
 *
 * @param tokens - Tokens from stage 4.
 * @returns The tokens with every word stemmed; the number and unit tokens are left alone.
 */
export function stemTokens(tokens: readonly string[]): string[] {
    return tokens.map((token) => (token === NUMBER_TOKEN || token === UNIT_TOKEN ? token : stemmer(token)));
}
