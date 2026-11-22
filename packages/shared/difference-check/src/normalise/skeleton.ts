/**
 * @module @kitchensink/difference-check/normalise: stage 4 of v1 (KTD-2): the UTS #39 skeleton (section 4: NFD, map, NFD),
 * then lower case again, because the map's targets include capitals.
 *
 * A digit inside a word is mapped with it (`0nion` is `onion`). The number and unit tokens are left alone.
 *
 * Pure.
 */
import { NUMBER_TOKEN, UNIT_TOKEN } from './foldQuantities.js';
import { skeletonOf } from './skeletonOf.js';

/**
 * Stage 4.
 *
 * @param tokens - Tokens from stage 3.
 * @returns The tokens with every word folded to its skeleton.
 */
export function skeletonTokens(tokens: readonly string[]): string[] {
    return tokens.map((token) => (token === NUMBER_TOKEN || token === UNIT_TOKEN ? token : skeletonOf(token)));
}
