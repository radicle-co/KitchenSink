import { ingredientTickKeysSchema, type IngredientTickKey } from '../ingredientTickKey.js';

/**
 * A tick key for tests that treat keys as opaque: `l1:` and the number as 8 hex chars, ordinal 0. It goes through the
 * real parse boundary, so a test never forges the brand.
 *
 * @param seed - Any whole number; two seeds give two keys.
 * @returns The key.
 */
export function tickKeyOf(seed: number): IngredientTickKey {
    const [key] = ingredientTickKeysSchema.parse([`l1:${seed.toString(16).padStart(8, '0')}#0`]);

    if (key === undefined) {
        throw new RangeError(`tickKeyOf: ${seed} does not make a key`);
    }

    return key;
}
