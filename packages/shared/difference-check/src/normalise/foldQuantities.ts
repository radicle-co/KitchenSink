/**
 * @module @kitchensink/difference-check/normalise: stage 3 of v1 (KTD-2): a pure number becomes ONE number token, a unit
 * ONE unit token, and a number with its unit (`180c`, `20cm`, `350f`) a number token and a unit token.
 *
 * It runs BEFORE the skeleton, which would otherwise turn `180` into `l8o` and `ml` into `rnl`, and a quantity-only edit
 * would count as new words. The two sentinels hold no letter and no digit, so no word can collide with them.
 *
 * A look-alike quantity folds too (B10a S-1): a unit written with look-alike letters (`сuрs`, Cyrillic с and р) by its
 * skeleton, and a number written with letters for digits (`l8o` for 180) by mapping each letter that is a digit's
 * skeleton image back to the digit. The reverse map is derived from the confusables data, never listed by hand. A number
 * written with letters ONLY (`lo` for 10) stays a word: it collides with real words (the residual in ADR-0100).
 *
 * Pure.
 */
import { CONFUSABLES_V1 } from '../confusables/confusablesV1.generated.js';
import { V1_UNITS } from '../v1Units.js';

import { skeletonOf } from './skeletonOf.js';

/** The token every pure number folds to. */
export const NUMBER_TOKEN = '#';

/** The token every unit folds to. */
export const UNIT_TOKEN = '~';

/** The leading number of a token, with its decimal point, fraction slash or range dash. */
const LEADING_NUMBER = /^\p{N}+(?:[.,/⁄\-–—−]\p{N}+)*/u;

/** The skeleton of every unit: a unit written with look-alike letters has one of these. */
const UNIT_SKELETONS: ReadonlySet<string> = new Set(Array.from(V1_UNITS, skeletonOf));

/** The digit each skeleton letter stands for (`o` for 0, `l` for 1), read from the confusables map's digit entries. */
const DIGIT_OF_IMAGE: ReadonlyMap<string, string> = new Map(
    Object.entries(CONFUSABLES_V1)
        .filter(([source]) => /^\d$/u.test(source))
        .map(([digit, image]) => [image.toLowerCase(), digit]),
);

/**
 * Whether a word is a unit, written plainly or with look-alike letters.
 *
 * @param word - A lower-case word.
 * @returns `true` for a unit. A word the skeleton leaves alone must be a unit as written.
 */
function isUnit(word: string): boolean {
    const skeleton = skeletonOf(word);

    return V1_UNITS.has(word) || (skeleton !== word && UNIT_SKELETONS.has(skeleton));
}

/**
 * Fold a token that holds a digit but does not start with a number: letters standing for digits, and a unit after them.
 *
 * @param token - A token with at least one digit.
 * @returns The folded tokens, or the token itself when it is not a number written with look-alikes.
 */
function foldLookAlikeNumber(token: string): string[] {
    const skeleton = Array.from(skeletonOf(token));
    const digits = skeleton.map((character) => DIGIT_OF_IMAGE.get(character) ?? character).join('');
    const number = LEADING_NUMBER.exec(digits)?.[0];

    if (number === undefined) {
        return [token];
    }

    const tail = skeleton.slice(Array.from(number).length).join('');

    if (tail === '') {
        return [NUMBER_TOKEN];
    }

    return UNIT_SKELETONS.has(tail) ? [NUMBER_TOKEN, UNIT_TOKEN] : [token];
}

/**
 * Fold one token to zero, one or two tokens.
 *
 * @param token - A token from the tokeniser.
 * @returns The folded tokens.
 */
function foldToken(token: string): string[] {
    const number = LEADING_NUMBER.exec(token)?.[0];

    if (number === undefined) {
        if (/\p{N}/u.test(token)) {
            return foldLookAlikeNumber(token);
        }

        return isUnit(token) ? [UNIT_TOKEN] : [token];
    }

    const tail = token.slice(number.length);

    if (tail === '') {
        return [NUMBER_TOKEN];
    }

    return isUnit(tail) ? [NUMBER_TOKEN, UNIT_TOKEN] : foldLookAlikeNumber(token);
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
