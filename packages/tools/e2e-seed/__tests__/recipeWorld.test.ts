/**
 * The pure request builder and the probe's decision logic, against a fake client.
 *
 * What only the integration tier proves (`tests/recipeWorld.integration.test.ts`) is that the bodies satisfy the
 * SHIPPED schemas and the client parses the answers. What only this tier proves cheaply is every ARM of the
 * probe's logic, including the refusals, without standing up a server for each.
 */
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import { describe, expect, it, vi } from 'vitest';

import { deriveFixtureManifest } from '../src/fixtureManifest.js';
import {
    ensurePrivateFoodRecipe,
    ensureProbeFood,
    PROBE_FOOD_MACROS,
    toCreateRequest,
    type ProbeFoodClient,
} from '../src/recipeWorld.js';

const manifest = deriveFixtureManifest('gh42-1-maestro', 1);

/** A binding id the way the service mints one: a uuid. */
const BINDING = '00000000-0000-4000-8000-0000000000b1';
const CREATED_AT = '2026-01-01T00:00:00.000Z';

type Binding = Awaited<ReturnType<ProbeFoodClient['addIngredientByFood']>>;

/** A bound binding: the only shape that carries a `foodId`. */
const bound = (overrides: Partial<Binding> = {}): Binding => ({
    id: BINDING,
    name: manifest.probeIngredient,
    foodId: 'food_probe',
    foodResolutionStatus: 'RESOLVED',
    isUserEntered: false,
    createdAt: CREATED_AT,
    ...overrides,
});

/** A fake of the two routes the probe uses, recording what it was asked. */
function fakeClient(authored: Awaited<ReturnType<ProbeFoodClient['createAuthoredFoodViaPicker']>>, byFood = bound()) {
    const calls = { authored: [] as unknown[], byFood: [] as string[] };
    const client: ProbeFoodClient = {
        createAuthoredFoodViaPicker: async (input) => {
            calls.authored.push(input);

            return authored;
        },
        addIngredientByFood: async (foodId) => {
            calls.byFood.push(foodId);

            return byFood;
        },
    };

    return { client, calls };
}

describe('toCreateRequest', () => {
    const lamb = manifest.recipes.find((recipe) => recipe.key === 'lamb');
    const ids = new Map(lamb?.ingredients.map((line, index) => [line.name, `id-${index}`]));

    /**
     * ⛔ Plan 002 R9: a line's name is DERIVED from its binding, and the create schema is strict, so a line that
     * still carries `name` is a `400` that refuses the whole recipe — on a deployed run, a reset that fails and
     * SKIPS the flow behind it.
     */
    it('⛔ sends no line `name` — the service derives it from the binding', () => {
        const request = toCreateRequest(lamb!, ids);

        expect(request.ingredients.length).toBeGreaterThan(0);
        expect(request.ingredients.filter((line) => 'name' in line)).toEqual([]);
    });

    it('points every line at the binding the memo holds for its declared name', () => {
        const request = toCreateRequest(lamb!, ids);

        expect(request.ingredients.map((line) => line.ingredientId)).toEqual(
            lamb!.ingredients.map((line) => ids.get(line.name)),
        );
    });
});

describe('ensureProbeFood', () => {
    it('authors the probe as the caller’s own food and returns the binding the route made for it', async () => {
        const { client, calls } = fakeClient({ created: true, ingredient: bound() });

        const probe = await ensureProbeFood(client, manifest.probeIngredient);

        expect(calls.authored).toEqual([{ name: manifest.probeIngredient, macros: PROBE_FOOD_MACROS }]);
        expect(calls.byFood).toEqual([]);
        expect(probe.foodId).toBe('food_probe');
    });

    /**
     * The per-author dedup answers a name the caller already authored with the EXISTING food's id, not an error.
     * A run whose reset did not reach food-service (or a hand re-run) lands here, and the probe must still be a
     * bound food — so the existing one is bound through `by-food`, which converges on its shared binding.
     */
    it('binds the caller’s EXISTING food through by-food when the name is already theirs', async () => {
        const { client, calls } = fakeClient({ created: false, reason: 'duplicate', existingFoodId: 'food_old' });

        const probe = await ensureProbeFood(client, manifest.probeIngredient);

        expect(calls.byFood).toEqual(['food_old']);
        expect(probe.id).toBe(BINDING);
    });

    /**
     * ⛔ R45: the discovery filter keys on a FOOD id. A binding with none (a declared name, a failure record) can
     * never be picked in the filter, so `searchNavigation` would fail on a tap that reads like an app defect.
     * Provision refuses it instead, naming the cause.
     */
    it('⛔ refuses a probe that is not bound to a food', async () => {
        const declared = { ...bound(), foodId: undefined, foodResolutionStatus: undefined, isUserEntered: true };
        const { client } = fakeClient({ created: true, ingredient: declared });

        await expect(ensureProbeFood(client, manifest.probeIngredient)).rejects.toThrow(/food id/u);
    });

    /**
     * The flow taps `Filter by ${E2E_PROBE_INGREDIENT}`, and the typeahead names a hit from FOOD. An existing food
     * the caller authored under another spelling dedups onto this name and keeps ITS display name — so the tap
     * would find nothing. Refused here, where the mismatch can be named.
     */
    it('⛔ refuses a probe whose name is not the one the flow taps', async () => {
        const { client } = fakeClient(
            { created: false, reason: 'duplicate', existingFoodId: 'food_old' },
            bound({ name: 'flour' }),
        );

        await expect(ensureProbeFood(client, 'Flour')).rejects.toThrow(/"flour"/u);
    });
});

/**
 * The applier's ORDER and its refusals. Which rows it keeps or replaces is the pure planner's job
 * (`worldResetPlan.test.ts`), and the whole round trip over the real wire is the integration tier's.
 *
 * The client is the package's own fake: a real `RecipeServiceClient` whose transport rejects, so a method this code
 * reaches without a stub fails the test instead of passing it.
 */
describe('ensurePrivateFoodRecipe', () => {
    const recipe = manifest.privateFoodRecipe;
    const name = manifest.privateFoodName;

    /** A fake client with every route this code may call spied, and the food route answering `authored`. */
    function spiedClient(
        authored: Awaited<ReturnType<ProbeFoodClient['createAuthoredFoodViaPicker']>>,
        byFood = bound({ name }),
    ) {
        const client = createFakeRecipeServiceClient();
        const spies = {
            authored: vi.spyOn(client, 'createAuthoredFoodViaPicker').mockResolvedValue(authored),
            byFood: vi.spyOn(client, 'addIngredientByFood').mockResolvedValue(byFood),
            list: vi.spyOn(client, 'listRecipes').mockRejectedValue(new Error('the library was read')),
            read: vi.spyOn(client, 'getRecipeById'),
            remove: vi.spyOn(client, 'deleteRecipe'),
            create: vi.spyOn(client, 'createRecipe'),
        };

        return { client, spies };
    }

    /**
     * ⛔ THE FOOD COMES FIRST. The planner judges a row by the binding the food has NOW. Read the library before the
     * food is authored or re-bound and there is no current binding to judge by — a title check is all that is left,
     * and a title check keeps a recipe whose food a purge removed.
     */
    it('authors or re-binds the food BEFORE it reads the library', async () => {
        const { client, spies } = spiedClient({ created: true, ingredient: bound({ name }) });

        await expect(ensurePrivateFoodRecipe(client, recipe, name)).rejects.toThrow('the library was read');

        expect(spies.authored).toHaveBeenCalledWith({ name, macros: PROBE_FOOD_MACROS });
        expect(spies.authored.mock.invocationCallOrder[0]).toBeLessThan(
            spies.list.mock.invocationCallOrder[0] ?? Number.NEGATIVE_INFINITY,
        );
    });

    it('⛔ refuses a private food that is not bound to a food, and touches no recipe', async () => {
        const declared = {
            ...bound({ name }),
            foodId: undefined,
            foodResolutionStatus: undefined,
            isUserEntered: true,
        };
        const { client, spies } = spiedClient({ created: true, ingredient: declared });

        await expect(ensurePrivateFoodRecipe(client, recipe, name)).rejects.toThrow(/food id/u);

        expect(spies.list).not.toHaveBeenCalled();
        expect(spies.create).not.toHaveBeenCalled();
        expect(spies.remove).not.toHaveBeenCalled();
    });

    /**
     * The flow checks that THIS name never reaches the screen. A food the co-author already had under another
     * spelling dedups onto this name and keeps its own — so the check would look for the wrong words and pass.
     */
    it('⛔ refuses a private food whose name is not the one the flow checks for', async () => {
        const { client, spies } = spiedClient(
            { created: false, reason: 'duplicate', existingFoodId: 'food_old' },
            bound({ name: name.toLowerCase() }),
        );

        await expect(ensurePrivateFoodRecipe(client, recipe, name)).rejects.toThrow(`"${name.toLowerCase()}"`);

        expect(spies.list).not.toHaveBeenCalled();
        expect(spies.create).not.toHaveBeenCalled();
    });
});
