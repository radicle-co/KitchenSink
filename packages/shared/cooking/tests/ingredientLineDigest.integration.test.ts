import { recipeIngredientViewSchema } from '@kitchensink/recipe-core';
import { describe, expect, it } from 'vitest';

import { ingredientLineDigest } from '@kitchensink/cooking-core';

/**
 * The digest of a line read off the wire. The unit tests hand `ingredientLineDigest` plain objects. This one parses
 * JSON through recipe-core's own zod, in two key orders and with the food's name missing as it is during a food-service
 * outage, because the digest must not depend on object key order or on any derived field.
 */

const A =
    '{"ingredientId":"01JINGREDIENT0000000000000A","name":"Butter","quantity":{"kind":"exact","value":2},' +
    '"unit":"tbsp","displayText":"butter","note":"softened","isUserEntered":false}';
const B =
    '{"isUserEntered":false,"note":"softened","displayText":"butter","unit":"tbsp",' +
    '"quantity":{"value":2,"kind":"exact"},"ingredientId":"01JINGREDIENT0000000000000A"}';

describe('ingredientLineDigest over parsed wire lines', () => {
    it('is equal for two key orders, one with the name absent', () => {
        const first = recipeIngredientViewSchema.parse(JSON.parse(A));
        const second = recipeIngredientViewSchema.parse(JSON.parse(B));

        expect(second.name).toBeUndefined();
        expect(ingredientLineDigest(first)).toBe(ingredientLineDigest(second));
    });
});
