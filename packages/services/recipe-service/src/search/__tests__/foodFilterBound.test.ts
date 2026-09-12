/**
 * The recipe search's food filter is BOUNDED (curated plan U9): each root id costs one food read to expand to its
 * live variants, all in one wave, so the wire refuses a filter the expansion could not serve in one.
 */
import { describe, expect, it } from 'vitest';

import { MAX_SEARCH_FOOD_FILTERS, recipeSearchQuerySchema } from '../search.schema.js';

const ids = (count: number): string[] =>
    Array.from({ length: count }, (_, index) => `01JFOODFILTER00000000000${index}`);

describe('recipeSearchQuerySchema.foodIds', () => {
    it('is bounded at six', () => {
        expect(MAX_SEARCH_FOOD_FILTERS).toBe(6);
    });

    it('admits the bound — the positive control', () => {
        expect(recipeSearchQuerySchema.parse({ foodIds: ids(MAX_SEARCH_FOOD_FILTERS) }).foodIds).toHaveLength(6);
    });

    it('⛔ refuses one past it', () => {
        expect(recipeSearchQuerySchema.safeParse({ foodIds: ids(MAX_SEARCH_FOOD_FILTERS + 1) }).success).toBe(false);
    });
});
