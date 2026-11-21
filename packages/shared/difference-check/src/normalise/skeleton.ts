/**
 * @module @kitchensink/difference-check/normalise: stage 4 of v1 (KTD-2): the UTS #39 skeleton (section 4: NFD, map, NFD),
 * then lower case again, because the map's targets include capitals.
 *
 * The map is Unicode's `confusables.txt` at the pinned version, through the generated module. A digit inside a word is
 * mapped with it (`0nion` is `onion`). The number and unit tokens are left alone.
 *
 * Pure.
 */
import { CONFUSABLES_V1 } from '../confusables/confusablesV1.generated.js';

import { NUMBER_TOKEN, UNIT_TOKEN } from './foldQuantities.js';

/**
 * The skeleton of one word.
 *
 * @param word - A word token.
 * @returns Its skeleton, lower case.
 */
export function skeletonOf(word: string): string {
    const mapped = Array.from(word.normalize('NFD'), (character) => CONFUSABLES_V1[character] ?? character).join('');

    return mapped.normalize('NFD').toLowerCase();
}

/**
 * Stage 4.
 *
 * @param tokens - Tokens from stage 3.
 * @returns The tokens with every word folded to its skeleton.
 */
export function skeletonTokens(tokens: readonly string[]): string[] {
    return tokens.map((token) => (token === NUMBER_TOKEN || token === UNIT_TOKEN ? token : skeletonOf(token)));
}
