/**
 * The k6 load suite's recipe payload must be a body the service accepts.
 *
 * `tests/load/lib/common.js` builds every write scenario's create body, and k6 runs it outside every test tier, so
 * a contract change reaches it only as a run of `400`s — which is how the suite once measured nothing but refusals
 * (`UNKNOWN_INGREDIENT`, run 34045472743), and how plan 002's removal of a request line's `name` would have repeated
 * it. This parses the real payload against the published request schema.
 *
 * The same holds for the food-nutrition body `ingredientFoodNutrition.load.js` sends: a body the schema refuses is a
 * run of `400`s, and a body that stops repeating refs leaves that scenario's one-entry-per-distinct-ref check unable to
 * tell de-duplication from an echo.
 */
import { describe, expect, it, vi } from 'vitest';

import {
    ingredientFoodNutritionRequestSchema,
    MAX_FOOD_NUTRITION_REFS,
} from '../../src/ingredients/ingredients.schema.js';
import { createRecipeRequestSchema } from '../../src/recipes/recipes.schema.js';

// The k6 built-ins do not exist outside the k6 binary; the payload builder touches neither.
vi.mock('k6/http', () => ({ default: {} }));
vi.stubGlobal('__ENV', {});

/** The k6 module, typed by what this test reads: it is plain JavaScript with no declarations. */
interface K6Common {
    readonly makeRecipePayload: (label: string, ingredients: { flour: string; sugar: string }) => unknown;
    readonly makeFoodNutritionRequest: () => unknown;
}

// A path held in a variable, so the compiler does not look for declarations of a k6-only JavaScript module.
const k6CommonPath = '../../tests/load/lib/common.js';
const { makeRecipePayload, makeFoodNutritionRequest } = (await import(k6CommonPath)) as K6Common;

describe('the k6 create payload', () => {
    it('parses under the published create-recipe request schema', () => {
        const body = makeRecipePayload('k6-contract', {
            flour: '00000000-0000-4000-8000-000000000001',
            sugar: '00000000-0000-4000-8000-000000000002',
        });

        const parsed = createRecipeRequestSchema.safeParse(body);

        expect(parsed.error?.issues ?? []).toStrictEqual([]);
    });
});

describe('the k6 food-nutrition request', () => {
    it('parses under the published food-nutrition request schema', () => {
        const parsed = ingredientFoodNutritionRequestSchema.safeParse(makeFoodNutritionRequest());

        expect(parsed.error?.issues ?? []).toStrictEqual([]);
    });

    it('sends exactly the published ref cap, so a run proves the service accepts the cap', () => {
        const { refs } = ingredientFoodNutritionRequestSchema.parse(makeFoodNutritionRequest());

        expect(refs).toHaveLength(MAX_FOOD_NUTRITION_REFS);
    });

    it('repeats refs, and keys them by kind AND id, as the service de-duplicates them', () => {
        const { refs } = ingredientFoodNutritionRequestSchema.parse(makeFoodNutritionRequest());
        const distinctKeys = new Set(refs.map((ref) => `${ref.kind}:${ref.id}`));
        const distinctIds = new Set(refs.map((ref) => ref.id));

        expect(distinctKeys.size, 'no ref repeats, so de-duplication is invisible').toBeLessThan(refs.length);
        expect(distinctIds.size, 'no root and variant share an id, so a key on id alone looks right').toBeLessThan(
            distinctKeys.size,
        );
    });
});
