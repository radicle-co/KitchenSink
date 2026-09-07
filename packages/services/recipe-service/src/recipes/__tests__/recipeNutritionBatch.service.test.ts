/**
 * Unit tests for `RecipesService.getNutritionForRecipes` — the deferred calorie lookup's orchestration.
 *
 * The classification rule itself is pinned in `../domain/__tests__/nutritionState.test.ts` and the wire
 * shape in `./recipeNutritionState.test.ts`; what is proven HERE is what only the orchestration can get
 * wrong:
 *
 *  1. **ONE food lookup for the whole batch.** This is the entire reason the endpoint is a batch. A
 *     per-recipe assembly would still return correct answers, so nothing but a call-count assertion can
 *     catch it — and the cost of missing it is a fan-out proportional to the page size, against a service
 *     the recipe read now depends on at runtime.
 *  2. **Authorization by ABSENCE, all the way down.** The service must answer for exactly the recipes the
 *     visibility-filtered read returned, and must never manufacture a state for an id it did not get back.
 *     A `no_resolved_ingredients` emitted for someone else's recipe would confirm the id exists.
 *  3. **The degrade paths are distinguishable.** Food down with a warm cache is `known{stale}`; food down
 *     with a cold cache is `unaccounted{food_unavailable}`. Serving the first as the second throws away a
 *     usable number; serving the second as the first fabricates one.
 */
import { describe, expect, it, vi } from 'vitest';

import { RecipesService } from '../recipes.service.js';
import type { RecipesDal, RecipeNutritionInput } from '../dal/recipes.dal.js';
import type { IngredientsDal } from '../../ingredients/dal/ingredients.dal.js';
import type { FoodNutritionEntry } from '../../ingredients/foodNutrition.gateway.js';
import { makeRecipeIngredientRow } from '../../__fixtures__/index.js';
import { makeIngredient } from '../../ingredients/__fixtures__/ingredients.fixtures.js';
import { makeFakeVersionsService } from '../__fixtures__/versions.fixture.js';
import { fakePhotosDal, RECIPE_PHOTOS_CDN } from '../__fixtures__/photosDal.fixture.js';
import { fakeRatingsDal } from '../__fixtures__/ratingsDal.fixture.js';
import { fakeVerificationQueue } from '../__fixtures__/verificationQueue.fixture.js';
import { verificationKey } from '@kitchensink/recipe-core/resolution/verification-key';
import { sha256Hex } from '../../common/sha256.js';
import type { VerificationBand } from '../domain/lineVerification.js';
import { fakeLineVerificationsDal } from '../__fixtures__/lineVerificationsDal.fixture.js';

const VIEWER = '01J000000000000000000FREE0';
const FLOUR_INGREDIENT = '00000000-0000-4000-8000-0000000000aa';
const FLOUR_FOOD = '01JFOODFLOUR00000000000001';
const FREEFORM_INGREDIENT = '00000000-0000-4000-8000-0000000000bb';

/** The raw line a cook's source stated, as migration 0024 admits it. */
const SOURCE_LINE = '200 g of plain flour, sifted';

/** Food's per-100g projection for the flour fixture: 350 kcal, 12 g protein, 70 g carbs, 2 g fat. */
const FLOUR_NUTRITION: Omit<FoodNutritionEntry, 'freshness'> = {
    caloriesPer100g: 350,
    proteinGPer100g: 12,
    carbsGPer100g: 70,
    fatGPer100g: 2,
    portions: [{ unit: 'cup', gramsPerUnit: 125 }],
};

/** One recipe's nutrition inputs as the DAL returns them. */
function input(recipeId: string, lines: RecipeNutritionInput['lines'], servings = 2): RecipeNutritionInput {
    return { recipeId, servings, lines };
}

/** A catalog line: 200 g of the food-backed flour ingredient. */
function flourLine(recipeId: string) {
    return makeRecipeIngredientRow({
        recipeId,
        ingredientId: FLOUR_INGREDIENT,
        ingredientName: 'Flour',
        quantity: '200',
        unit: 'g',
        sortOrder: 0,
    });
}

/** A freeform line with no food and no user override — nothing can account for it. */
function freeformLine(recipeId: string) {
    return makeRecipeIngredientRow({
        recipeId,
        ingredientId: FREEFORM_INGREDIENT,
        ingredientName: 'A pinch of something',
        quantity: '1',
        unit: 'pinch',
        sortOrder: 0,
        isUserEntered: true,
    });
}

/** A DAL double whose `findNutritionInputs` returns exactly `inputs` (the visibility-filtered read). */
function fakeDal(inputs: RecipeNutritionInput[]): { dal: RecipesDal; findNutritionInputs: ReturnType<typeof vi.fn> } {
    const findNutritionInputs = vi.fn().mockResolvedValue(inputs);

    return { dal: { findNutritionInputs } as unknown as RecipesDal, findNutritionInputs };
}

/** A catalog DAL that resolves the flour ingredient to a food and the freeform one to nothing. */
function fakeIngredientsDal(): IngredientsDal {
    return {
        findByIds: vi
            .fn()
            .mockImplementation((ids: readonly string[]) =>
                Promise.resolve(
                    ids.map((id) =>
                        id === FLOUR_INGREDIENT
                            ? makeIngredient({ id, name: 'Flour', foodId: FLOUR_FOOD })
                            : makeIngredient({ id, name: 'Freeform', isUserEntered: true }),
                    ),
                ),
            ),
    } as unknown as IngredientsDal;
}

/** A `FoodNutritionGateway` double answering a fixed lookup, with the spy so call COUNT is assertable. */
/**
 * A gateway stub in the tests' vocabulary — `fresh` | `stale` | `absent` — over the gateway's real
 * contract, where freshness rides on each ENTRY and `absent` is simply an id missing from the map.
 * Keeping the sugar here means each test still reads as one sentence while the production type stays
 * honest about partial failure.
 */
function fakeGateway(byFoodId: Map<string, Omit<FoodNutritionEntry, 'freshness'>>, mode: 'fresh' | 'stale' | 'absent') {
    const stamped = new Map(
        [...byFoodId].map(([id, data]) => [id, { ...data, freshness: mode === 'stale' ? 'stale' : 'fresh' }] as const),
    );

    return vi.fn().mockResolvedValue({
        byFoodId: mode === 'absent' ? new Map() : stamped,
        degraded: mode !== 'fresh',
    });
}

/** A source-transcribed catalog line: 200 g of flour, carrying the raw line the cook's book stated. */
function transcribedFlourLine(recipeId: string, lineId: string) {
    return makeRecipeIngredientRow({
        id: lineId,
        recipeId,
        ingredientId: FLOUR_INGREDIENT,
        ingredientName: 'Flour',
        quantity: '200',
        unit: 'g',
        sourceLine: SOURCE_LINE,
        sortOrder: 0,
    });
}

/**
 * The verdict key the SERVICE will compute for {@link transcribedFlourLine} — derived exactly as production
 * does, never hand-written.
 *
 * ⛔ This is what makes the withholding cases real assertions rather than restatements of a mock. If the
 * service ever spelled the identity differently — the classic trap being the unitless `''`/`null` mismatch —
 * it would compute a key that matches nothing, silently report "no verdict", and these tests would fail.
 */
const WITHHELD_KEY = verificationKey(
    {
        sourceLine: SOURCE_LINE,
        foodId: FLOUR_FOOD,
        quantityLow: 200,
        quantityHigh: null,
        statedMeasure: null,
        unit: 'g',
    },
    sha256Hex,
);

/** The service under test, wired to the given DAL + gateway (the other collaborators are off-path here). */
function newService(
    dal: RecipesDal,
    lookup: ReturnType<typeof vi.fn>,
    verdicts: ReadonlyMap<string, VerificationBand> = new Map(),
): RecipesService {
    return new RecipesService(
        dal,
        fakeIngredientsDal(),
        makeFakeVersionsService(),
        fakePhotosDal(),
        RECIPE_PHOTOS_CDN,
        fakeRatingsDal(),
        { lookup } as never,
        fakeVerificationQueue(),
        fakeLineVerificationsDal(verdicts),
    );
}

describe('RecipesService.getNutritionForRecipes', () => {
    it('⛔ issues exactly ONE food lookup for a 20-recipe batch', async () => {
        // The assertion the whole batching design exists for. 20 recipes, each referencing the same food:
        // one lookup, one deduplicated id list.
        const inputs = Array.from({ length: 20 }, (_value, index) => input(`r-${index}`, [flourLine(`r-${index}`)]));
        const lookup = fakeGateway(new Map([[FLOUR_FOOD, FLOUR_NUTRITION]]), 'fresh');
        const { dal } = fakeDal(inputs);

        const result = await this_getNutrition(
            newService(dal, lookup),
            inputs.map((entry) => entry.recipeId),
        );

        expect(lookup).toHaveBeenCalledTimes(1);
        expect(lookup.mock.calls[0]?.[1]).toStrictEqual([FLOUR_FOOD]);
        expect(Object.keys(result.nutrition)).toHaveLength(20);
    });

    it('computes a per-serving figure per recipe from the shared lookup', async () => {
        // 200 g at 350 kcal/100 g = 700 kcal; ÷ 2 servings → 350.
        const lookup = fakeGateway(new Map([[FLOUR_FOOD, FLOUR_NUTRITION]]), 'fresh');
        const { dal } = fakeDal([input('r-1', [flourLine('r-1')])]);

        const result = await this_getNutrition(newService(dal, lookup), ['r-1']);

        expect(result.nutrition['r-1']).toStrictEqual({
            state: 'known',
            caloriesPerServing: 350,
            proteinG: 12,
            carbsG: 70,
            fatG: 2,
            isComplete: true,
            freshness: 'fresh',
        });
    });

    it('⛔ OMITS a recipe the visibility-filtered read did not return — never invents a state for it', async () => {
        // The authorization signal. The DAL answers with only the readable recipe; the service must not
        // "helpfully" fill the other id in with `unaccounted`, which would confirm the id exists.
        const lookup = fakeGateway(new Map([[FLOUR_FOOD, FLOUR_NUTRITION]]), 'fresh');
        const { dal, findNutritionInputs } = fakeDal([input('mine', [flourLine('mine')])]);

        const result = await this_getNutrition(newService(dal, lookup), ['mine', 'someone-elses']);

        expect(Object.keys(result.nutrition)).toStrictEqual(['mine']);
        expect(findNutritionInputs).toHaveBeenCalledWith(['mine', 'someone-elses'], VIEWER);
    });

    it('⛔ scopes the read to the VIEWER — authorization is the query, not a filter afterwards', async () => {
        const lookup = fakeGateway(new Map(), 'fresh');
        const { dal, findNutritionInputs } = fakeDal([]);

        await this_getNutrition(newService(dal, lookup), ['r-1']);

        expect(findNutritionInputs.mock.calls[0]?.[1]).toBe(VIEWER);
    });

    it('de-duplicates the requested ids before reading', async () => {
        const lookup = fakeGateway(new Map(), 'fresh');
        const { dal, findNutritionInputs } = fakeDal([]);

        await this_getNutrition(newService(dal, lookup), ['r-1', 'r-1', 'r-2']);

        expect(findNutritionInputs.mock.calls[0]?.[0]).toStrictEqual(['r-1', 'r-2']);
    });

    it('reports `no_resolved_ingredients` for a recipe whose lines map to no food', async () => {
        const lookup = fakeGateway(new Map(), 'fresh');
        const { dal } = fakeDal([input('r-1', [freeformLine('r-1')])]);

        const result = await this_getNutrition(newService(dal, lookup), ['r-1']);

        expect(result.nutrition['r-1']).toStrictEqual({ state: 'unaccounted', reason: 'no_resolved_ingredients' });
    });

    it('⛔ food down + WARM cache → known, marked stale (KTD-3b serves the number, and says so)', async () => {
        const lookup = fakeGateway(new Map([[FLOUR_FOOD, FLOUR_NUTRITION]]), 'stale');
        const { dal } = fakeDal([input('r-1', [flourLine('r-1')])]);

        const result = await this_getNutrition(newService(dal, lookup), ['r-1']);

        expect(result.nutrition['r-1']).toMatchObject({
            state: 'known',
            caloriesPerServing: 350,
            freshness: 'stale',
        });
    });

    it('⛔ food down + COLD cache → unaccounted{food_unavailable}, with no figure at all', async () => {
        const lookup = fakeGateway(new Map(), 'absent');
        const { dal } = fakeDal([input('r-1', [flourLine('r-1')])]);

        const result = await this_getNutrition(newService(dal, lookup), ['r-1']);

        expect(result.nutrition['r-1']).toStrictEqual({ state: 'unaccounted', reason: 'food_unavailable' });
    });

    it('⛔ a recipe whose lines sum to a GENUINE zero is known with 0, never unaccounted', async () => {
        // Water: food answers, the per-100g energy really is 0. The card must be able to render "0 cal".
        const lookup = fakeGateway(new Map([[FLOUR_FOOD, { caloriesPer100g: 0, portions: [] }]]), 'fresh');
        const { dal } = fakeDal([input('r-1', [flourLine('r-1')], 4)]);

        const result = await this_getNutrition(newService(dal, lookup), ['r-1']);

        expect(result.nutrition['r-1']).toStrictEqual({
            state: 'known',
            caloriesPerServing: 0,
            proteinG: 0,
            carbsG: 0,
            fatG: 0,
            isComplete: true,
            freshness: 'fresh',
        });
    });

    it('⛔ WITHHOLDS a contradicted line and reports the disagreement, not an outage (U14)', async () => {
        // The end-to-end property this unit exists for: a verdict recorded by `recipe-workers` reaches a
        // cook. Food answered, the catalog HAD the figure, and the recipe reports `verification_disagreement`
        // — which is a different sentence from "try again shortly".
        const lookup = fakeGateway(new Map([[FLOUR_FOOD, FLOUR_NUTRITION]]), 'fresh');
        const { dal } = fakeDal([input('r-1', [transcribedFlourLine('r-1', 'line-1')])]);
        const service = newService(dal, lookup, new Map([[WITHHELD_KEY, 'contradicted']]));

        const result = await this_getNutrition(service, ['r-1']);

        expect(result.nutrition['r-1']).toStrictEqual({
            state: 'unaccounted',
            reason: 'verification_disagreement',
        });
    });

    it('⛔ PUBLISHES the same line when the gate AGREED — only a contradiction withholds', async () => {
        const lookup = fakeGateway(new Map([[FLOUR_FOOD, FLOUR_NUTRITION]]), 'fresh');
        const { dal } = fakeDal([input('r-1', [transcribedFlourLine('r-1', 'line-1')])]);
        const service = newService(dal, lookup, new Map([[WITHHELD_KEY, 'verified']]));

        expect((await this_getNutrition(service, ['r-1'])).nutrition['r-1']).toMatchObject({
            state: 'known',
            caloriesPerServing: 350,
        });
    });

    it('⛔ PUBLISHES when the gate has judged nothing — absence of a verdict means publish (0023)', async () => {
        const lookup = fakeGateway(new Map([[FLOUR_FOOD, FLOUR_NUTRITION]]), 'fresh');
        const { dal } = fakeDal([input('r-1', [transcribedFlourLine('r-1', 'line-1')])]);

        expect((await this_getNutrition(newService(dal, lookup), ['r-1'])).nutrition['r-1']).toMatchObject({
            state: 'known',
            caloriesPerServing: 350,
        });
    });

    it('⛔ withholds ONE line without deleting the recipe’s figure — the survivor still accounts', async () => {
        // A second line, same food, DIFFERENT quantity: a different judgement, and deliberately not covered
        // by the first line's verdict. Keying the verdict on the ingredient rather than the judgement would
        // badge both and wipe the recipe's figure out entirely.
        const secondLine = makeRecipeIngredientRow({
            id: 'line-2',
            recipeId: 'r-1',
            ingredientId: FLOUR_INGREDIENT,
            ingredientName: 'Flour',
            quantity: '100',
            unit: 'g',
            sourceLine: 'a further 100 g of flour',
            sortOrder: 1,
        });
        const lookup = fakeGateway(new Map([[FLOUR_FOOD, FLOUR_NUTRITION]]), 'fresh');
        const { dal } = fakeDal([input('r-1', [transcribedFlourLine('r-1', 'line-1'), secondLine])]);
        const service = newService(dal, lookup, new Map([[WITHHELD_KEY, 'contradicted']]));

        expect((await this_getNutrition(service, ['r-1'])).nutrition['r-1']).toMatchObject({
            state: 'known',
            // 100 g at 350 kcal/100 g = 350 kcal, ÷ 2 servings = 175. The withheld 200 g contributes nothing.
            caloriesPerServing: 175,
            isComplete: false,
        });
    });

    it('⛔ does NOT read verdicts at all when no line was transcribed — there is nothing to judge', async () => {
        // `flourLine` carries `sourceLine: null` (an AUTHORED line). The verdict read is skipped entirely
        // rather than issued with an empty predicate, mirroring the food lookup's own short circuit.
        const lookup = fakeGateway(new Map([[FLOUR_FOOD, FLOUR_NUTRITION]]), 'fresh');
        const { dal } = fakeDal([input('r-1', [flourLine('r-1')])]);
        const verificationsDal = fakeLineVerificationsDal();
        const service = new RecipesService(
            dal,
            fakeIngredientsDal(),
            makeFakeVersionsService(),
            fakePhotosDal(),
            RECIPE_PHOTOS_CDN,
            fakeRatingsDal(),
            { lookup } as never,
            fakeVerificationQueue(),
            verificationsDal,
        );

        await service.getNutritionForRecipes(VIEWER, ['r-1']);

        expect(verificationsDal.findBandsByKeys).not.toHaveBeenCalled();
    });

    it('does not call food at all when no requested recipe is readable', async () => {
        const lookup = fakeGateway(new Map(), 'fresh');
        const { dal } = fakeDal([]);

        const result = await this_getNutrition(newService(dal, lookup), ['nope']);

        expect(result.nutrition).toStrictEqual({});
        expect(lookup).not.toHaveBeenCalled();
    });
});

/** Invoke the method under test with the fixed viewer and no caller credential. */
async function this_getNutrition(service: RecipesService, recipeIds: readonly string[]) {
    return service.getNutritionForRecipes(VIEWER, recipeIds);
}
