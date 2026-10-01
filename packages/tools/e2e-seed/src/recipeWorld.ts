/**
 * The impure half: read the signer's library, and carry out a {@link WorldResetPlan}.
 *
 * Everything here goes through `RecipeServiceClient` — the typed client that already owns URL shape, token
 * attachment, zod parsing and status mapping for this API. It IS the adapter; nothing here invents a port
 * over it. `ensureProbeFood` takes a `Pick` of it — the client's own signatures, no new shape — so its refusals
 * can be unit-tested against a fake.
 *
 * ⚠️ WRITES ARE ISSUED SERIALLY AND BOUNDED. The recipe service throttles writes at 30/min PER USER
 * (`throttle.config.ts`), and the worst reset — the one after `collectionsPagination` leaves 21
 * collections — is a burst of two dozen deletes. Discovering that ceiling on a fifty-minute emulator job is
 * the kind of failure that reads like an app defect, so the pacing is explicit rather than hopeful.
 */
import { setTimeout as delay } from 'node:timers/promises';

import type { RecipeServiceClient } from '@kitchensink/recipe-service-client';

import type { FixtureRecipe } from './fixtureManifest.js';
import {
    isIntactPrivateFoodRecipe,
    planPrivateFoodRecipe,
    type PrivateFoodRecipePlan,
    type PrivateFoodRecipeRow,
    type WorldResetPlan,
    type WorldSnapshot,
} from './worldResetPlan.js';

/** How many recipes/collections to ask for per page when snapshotting. */
const PAGE_SIZE = 100;

/**
 * Everything the signer currently owns.
 *
 * Paged deliberately: `collectionsPagination` leaves 21 collections and a flow that created more would go
 * unseen by a single unpaged read, so the reset would leave them behind and the NEXT run would inherit them.
 *
 * @sideEffect Two paged reads against the recipe service.
 */
export async function readWorld(client: RecipeServiceClient): Promise<WorldSnapshot> {
    const recipes = await readRecipes(client);
    const collections: { id: string }[] = [];

    for (let page = 1; ; page += 1) {
        const answer = await client.listCollections({ page, pageSize: PAGE_SIZE });
        collections.push(...answer.data.map((collection) => ({ id: collection.id })));

        if (!answer.hasMore) {
            break;
        }
    }

    return { recipes, collections };
}

/**
 * Every recipe the caller owns, every page of it.
 *
 * @sideEffect One paged read against the recipe service.
 */
export async function readRecipes(client: Pick<RecipeServiceClient, 'listRecipes'>): Promise<WorldSnapshot['recipes']> {
    const recipes: WorldSnapshot['recipes'][number][] = [];

    for (let page = 1; ; page += 1) {
        const answer = await client.listRecipes({ page, pageSize: PAGE_SIZE });
        recipes.push(
            ...answer.data.map((recipe) => ({ id: recipe.id, title: recipe.title, visibility: recipe.visibility })),
        );

        if (!answer.hasMore) {
            return recipes;
        }
    }
}

/**
 * Declare every ingredient name in the given recipes, once per name, and return the binding each one got.
 *
 * ⛔ THE MAP IS A PER-CALL MEMO, AND IT IS THE ONLY DEDUP THERE IS. `POST /api/v1/ingredients` declares a name as
 * the cook wrote it, and declared names NEVER converge (plan 002): two calls with one name answer two different
 * ids. So a name three recipes share is declared once and all three lines point at that one binding — and a
 * second call (the next reset) declares it again, under a new id. Nothing here is idempotent across calls, and
 * nothing needs to be: a recipe only ever needs SOME binding that carries its line's name.
 *
 * The seeded recipes use declared names on purpose — their lines render the names the flows assert, and a
 * declared name has no food id, so no seeded recipe can ever match the food-keyed discovery filter.
 *
 * @sideEffect Declares one ingredient per distinct name.
 */
export async function ensureIngredients(
    client: RecipeServiceClient,
    recipes: readonly FixtureRecipe[],
): Promise<ReadonlyMap<string, string>> {
    const names = [...new Set(recipes.flatMap((recipe) => recipe.ingredients.map((line) => line.name)))];
    const resolved = new Map<string, string>();

    for (const name of names) {
        const ingredient = await client.createIngredient(name);
        resolved.set(name, ingredient.id);
    }

    return resolved;
}

/** The two recipe-service routes an authored fixture food needs. */
export type ProbeFoodClient = Pick<RecipeServiceClient, 'createAuthoredFoodViaPicker' | 'addIngredientByFood'>;

/**
 * The per-100g macros every fixture food is authored with: USDA's white all-purpose wheat flour, rounded. The route
 * requires macros; nothing a flow asserts reads them.
 */
export const PROBE_FOOD_MACROS: Parameters<RecipeServiceClient['createAuthoredFoodViaPicker']>[0]['macros'] = {
    calories: 364,
    proteinG: 10.3,
    carbsG: 76.3,
    fatG: 1,
};

/**
 * Make the discovery probe a FOOD the caller can filter by, and return its binding.
 *
 * ⛔ WHY A FOOD, and why the caller's OWN food. The discovery filter keys on a food id (plan 002 R45), and a
 * declared name has none, so it can never be picked. The probe is authored rather than taken from the USDA
 * catalog because the flow taps it by its exact NAME (`Filter by ${E2E_PROBE_INGREDIENT}`) and the typeahead
 * names a hit from food: an authored food keeps the name it was given, while a catalog food carries USDA's
 * description. Authoring it also keeps it private to the signer — so no other user's recipe can ever bind it,
 * which is what keeps the flow's "No matching recipes" true — and inside the slot's own data, which `resetPool`
 * purges before and after the run. A catalog food is kept by owner ruling and cannot be reclaimed.
 *
 * @param client - A client authenticated as the identity the device signs in as.
 * @param name - The probe's name, exactly as the flow types and taps it (`Filter by ${name}`).
 * @returns The food-backed binding.
 * @throws {Error} As {@link ensureAuthoredFood} does.
 * @sideEffect May author one food, and binds it.
 */
export async function ensureProbeFood(
    client: ProbeFoodClient,
    name: string,
): Promise<Awaited<ReturnType<ProbeFoodClient['addIngredientByFood']>>> {
    return ensureAuthoredFood(client, name, 'the discovery probe');
}

/**
 * Author a food as the caller, or bind the one they already authored under `name`, and return its binding.
 *
 * The route answers a name the caller already authored with the EXISTING food's id; that food is bound through
 * `by-food`, which converges on its one shared binding.
 *
 * @param client - A client authenticated as the food's author.
 * @param name - The food's name, exactly as a flow looks for it.
 * @param label - What the food is for, to name it in an error (`the discovery probe`).
 * @returns The food-backed binding.
 * @throws {Error} When the result carries no food id, or a name other than `name`. A flow finds these foods by their
 *   exact name, so either would fail it on a step that reads like an app defect.
 * @sideEffect May author one food, and binds it.
 */
async function ensureAuthoredFood(
    client: ProbeFoodClient,
    name: string,
    label: string,
): Promise<Awaited<ReturnType<ProbeFoodClient['addIngredientByFood']>>> {
    const authored = await client.createAuthoredFoodViaPicker({ name, macros: PROBE_FOOD_MACROS });
    const food = authored.created ? authored.ingredient : await client.addIngredientByFood(authored.existingFoodId);

    if (food.foodId === undefined) {
        throw new Error(`e2e-seed: ${label} "${name}" came back with no food id, so it is not a food`);
    }

    if (food.name !== name) {
        throw new Error(
            `e2e-seed: ${label} is named "${food.name}", not "${name}" — a flow looks for it by that exact name`,
        );
    }

    return food;
}

/** The recipe-service routes the private-food recipe needs. */
export type PrivateFoodRecipeClient = ProbeFoodClient &
    Pick<RecipeServiceClient, 'listRecipes' | 'getRecipeById' | 'deleteRecipe' | 'createRecipe'>;

/**
 * Make the co-author's private-food recipe exist TOGETHER WITH its food, and return the recipe's id.
 *
 * ⛔ THE FOOD FIRST, THEN THE RECIPE, AND NEVER A CHECK ON THE TITLE ALONE. The food is authored (or re-bound)
 * before the library is read, so its binding is the one it has NOW; a row is kept only if its line points at that
 * binding (`planPrivateFoodRecipe`). If a purge removed the food but kept the recipe, the old row's line points at a
 * binding whose food is gone — it reads `FOOD_REMOVED`, not private — so the row is deleted and the recipe created
 * again, bound to the food as it is now.
 *
 * Clean-up is not done here: the recipe and the food both belong to the co-author's pool slot, and `resetPool`
 * purges that slot's recipes and authored foods before and after the run. The signer's clone of the recipe is
 * residue to the signer's per-flow reset, which deletes any title the manifest does not name.
 *
 * @param client - A client authenticated as the CO-AUTHOR: the food's author and the recipe's owner.
 * @param recipe - The run-scoped fixture (`manifest.privateFoodRecipe`).
 * @param foodName - The private food its line is bound to (`manifest.privateFoodName`).
 * @returns The recipe's id, and the plan that was carried out.
 * @throws {Error} When the food is not a food or has another name, or when the recipe the service created does not
 *   come back bound to the food. Each would make the flow fail on a line that reads like an app defect.
 * @sideEffect May author a food; may delete and create the co-author's recipes.
 */
export async function ensurePrivateFoodRecipe(
    client: PrivateFoodRecipeClient,
    recipe: FixtureRecipe,
    foodName: string,
): Promise<{ readonly recipeId: string; readonly plan: PrivateFoodRecipePlan }> {
    const binding = await ensureAuthoredFood(client, foodName, 'the private food');
    const rows: PrivateFoodRecipeRow[] = [];

    for (const row of await readRecipes(client)) {
        if (row.title !== recipe.title) {
            continue;
        }

        const detail = await client.getRecipeById(row.id);
        rows.push({
            id: row.id,
            visibility: row.visibility,
            lineBindingIds: detail.ingredients.map((line) => line.ingredientId),
        });
    }

    const plan = planPrivateFoodRecipe(rows, recipe, binding.id);

    for (const id of plan.deleteRecipeIds) {
        await client.deleteRecipe(id);
    }

    if (plan.action === 'keep') {
        return { recipeId: plan.recipeId, plan };
    }

    const created = await client.createRecipe(toCreateRequest(recipe, new Map([[foodName, binding.id]])));
    const lineBindingIds = created.ingredients.map((line) => line.ingredientId);

    if (!isIntactPrivateFoodRecipe({ visibility: created.visibility, lineBindingIds }, recipe, binding.id)) {
        throw new Error(
            `e2e-seed: "${recipe.title}" came back not bound to the private food's binding ${binding.id} ` +
                `(its lines point at: ${lineBindingIds.join(', ') || 'nothing'})`,
        );
    }

    return { recipeId: created.id, plan };
}

/**
 * Turn a manifest recipe into the create request the wire schema accepts.
 *
 * ⛔ `unit` is OMITTED, never `''`. The write schema rejects the empty string so that "unitless" has exactly
 * one representation — which is the asymmetry `seed.ts` deliberately exercises from the database side.
 *
 * Pure.
 */
export function toCreateRequest(
    recipe: FixtureRecipe,
    ingredientIds: ReadonlyMap<string, string>,
): Parameters<RecipeServiceClient['createRecipe']>[0] {
    return {
        title: recipe.title,
        description: recipe.description,
        visibility: recipe.visibility,
        servings: recipe.servings,
        prepTimeMinutes: recipe.prepTimeMinutes,
        cookTimeMinutes: recipe.cookTimeMinutes,
        totalTimeMinutes: recipe.totalTimeMinutes,
        ingredients: recipe.ingredients.map((line) => ({
            ingredientId: ingredientIds.get(line.name) ?? '',
            quantity: { kind: 'exact' as const, value: line.quantity },
            ...(line.unit === undefined ? {} : { unit: line.unit }),
        })),
        steps: recipe.steps.map((step) => ({
            instruction: step.instruction,
            ...(step.timerSeconds === undefined ? {} : { timerSeconds: step.timerSeconds }),
        })),
    };
}

/** Injectable pacing, so a unit test never sleeps and the integration tier can slow down. */
export interface ApplyOptions {
    readonly sleep?: (ms: number) => Promise<void>;
    readonly writeSpacingMs?: number;
}

/**
 * Keeps a burst of writes under the service's per-user limit.
 *
 * 30 writes/min is one every two seconds; 250 ms is comfortably inside the limit's own burst allowance
 * while adding well under a second to a typical reset, which touches a handful of rows.
 */
const WRITE_SPACING_MS = 250;

/**
 * Carry out the plan: deletes first, then creates.
 *
 * Order is load-bearing. A create before its delete can collide with a duplicate title the delete was about
 * to remove, and the library would briefly hold two rows a flow could match either of.
 *
 * @sideEffect Deletes and creates recipes and collections.
 */
export async function applyPlan(
    client: RecipeServiceClient,
    plan: WorldResetPlan,
    options: ApplyOptions = {},
): Promise<void> {
    const sleep = options.sleep ?? ((ms: number) => delay(ms));
    const spacing = options.writeSpacingMs ?? WRITE_SPACING_MS;

    for (const id of plan.deleteCollectionIds) {
        await client.deleteCollection(id);
        await sleep(spacing);
    }

    for (const id of plan.deleteRecipeIds) {
        await client.deleteRecipe(id);
        await sleep(spacing);
    }

    if (plan.create.length === 0) {
        return;
    }

    const ingredientIds = await ensureIngredients(client, plan.create);

    for (const recipe of plan.create) {
        await client.createRecipe(toCreateRequest(recipe, ingredientIds));
        await sleep(spacing);
    }
}
