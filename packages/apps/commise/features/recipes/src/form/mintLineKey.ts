/**
 * @module @commise/features-recipes/form — mint the key of an ingredient line added in this session: the impure edge
 * of `mintedLineKey` (`./lineKey.ts`).
 *
 * It mints through the house UUID seam (`../analytics/mintEventId.ts`, with its `.native.ts` sibling over
 * `expo-crypto`, because Hermes ships no `crypto` global) rather than inlining `crypto.randomUUID()`, so the platform
 * split is stated once. The append transition takes the result as a parameter and stays pure (staff-architect REVIEW
 * F1, following `observeServedList`'s `mintId`).
 */
import { mintEventId } from '../analytics/mintEventId.js';
import { mintedLineKey, type IngredientLineKey } from './lineKey.js';

/**
 * A new line key that no line, present or removed, has held.
 *
 * @sideEffect Draws a random UUID.
 * @returns The key.
 */
export function mintLineKey(): IngredientLineKey {
    return mintedLineKey(mintEventId());
}
