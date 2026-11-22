/**
 * @module @kitchensink/difference-check/normalise: v1's pipeline, frozen with the version (KTD-2). Each stage is a pure
 * function with its own test, and a stage is named so a test can leave one out and see the answer flip.
 *
 * @pattern Pipeline — the stages in a fixed order, each a pure function
 */
import { NUMBER_TOKEN, UNIT_TOKEN, foldQuantities } from './foldQuantities.js';
import { compatibilityFold, lowerCase, stripInvisible } from './foldCompatibility.js';
import { skeletonTokens } from './skeleton.js';
import { stemTokens } from './stemTokens.js';
import { tokenise } from './tokenise.js';

/** A stage over text. */
export type TextStage = (text: string) => string;

/** A stage over tokens. */
export type TokenStage = (tokens: readonly string[]) => string[];

/** v1's text stages, in order: stage 1 in three parts. */
export const V1_TEXT_STAGES = {
    nfkc: compatibilityFold,
    strip: stripInvisible,
    lowerCase,
} as const satisfies Record<string, TextStage>;

/** v1's token stages after the tokeniser, in order. */
export const V1_TOKEN_STAGES = {
    foldQuantities,
    skeleton: skeletonTokens,
    stem: stemTokens,
} as const satisfies Record<string, TokenStage>;

/**
 * A pipeline of the given stages. v1 is {@link normaliseV1}; tests build others to see what one stage buys.
 *
 * @param textStages - Stages over text, in order.
 * @param tokenStages - Stages over tokens, in order, after the tokeniser.
 * @returns The function from text to tokens.
 */
export function normaliseWith(
    textStages: readonly TextStage[],
    tokenStages: readonly TokenStage[],
): (text: string) => string[] {
    return (text) => {
        const folded = textStages.reduce((current, stage) => stage(current), text);

        return tokenStages.reduce<readonly string[]>((current, stage) => stage(current), tokenise(folded)).slice();
    };
}

/**
 * v1's normalisation.
 *
 * @param text - Steps text.
 * @returns The tokens the measures read.
 */
export const normaliseV1: (text: string) => string[] = normaliseWith(
    Object.values(V1_TEXT_STAGES),
    Object.values(V1_TOKEN_STAGES),
);

export { NUMBER_TOKEN, UNIT_TOKEN };
