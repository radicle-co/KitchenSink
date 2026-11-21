/**
 * @module @kitchensink/difference-check/normalise: stage 3 of v1 (KTD-2): a pure number becomes ONE number token, a unit
 * ONE unit token, and a number with its unit (`180c`, `20cm`, `350f`) a number token and a unit token.
 *
 * It runs BEFORE the skeleton, which would otherwise turn `180` into `l8o` and `ml` into `rnl`, and a quantity-only edit
 * would count as new words. The two sentinels hold no letter and no digit, so no word can collide with them.
 *
 * Pure.
 */
import { V1_UNITS } from '../v1Units.js';

/** The token every pure number folds to. */
export const NUMBER_TOKEN = '#';

/** The token every unit folds to. */
export const UNIT_TOKEN = '~';

/** The leading number of a token, with its decimal point, fraction slash or range dash. */
const LEADING_NUMBER = /^\p{N}+(?:[.,/⁄\-–—−]\p{N}+)*/u;

/**
 * Fold one token to zero, one or two tokens.
 *
 * @param token - A token from the tokeniser.
 * @returns The folded tokens.
 */
function foldToken(token: string): string[] {
    const number = LEADING_NUMBER.exec(token)?.[0];

    if (number === undefined) {
        return V1_UNITS.has(token) ? [UNIT_TOKEN] : [token];
    }

    const tail = token.slice(number.length);

    if (tail === '') {
        return [NUMBER_TOKEN];
    }

    return V1_UNITS.has(tail) ? [NUMBER_TOKEN, UNIT_TOKEN] : [token];
}

/**
 * Stage 3.
 *
 * @param tokens - Tokens from stage 2.
 * @returns The tokens with every quantity folded.
 */
export function foldQuantities(tokens: readonly string[]): string[] {
    return tokens.flatMap(foldToken);
}
