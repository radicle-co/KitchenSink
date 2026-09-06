/**
 * The impure half: read the signer's library, and carry out a {@link WorldResetPlan}.
 *
 * Everything here goes through `RecipeServiceClient` — the typed client that already owns URL shape, token
 * attachment, zod parsing and status mapping for this API. It IS the adapter; nothing here invents a port
 * over it, because a port with one implementation and one test double is a seam nothing crosses.
 *
 * ⚠️ WRITES ARE ISSUED SERIALLY AND BOUNDED. The recipe service throttles writes at 30/min PER USER
 * (`throttle.config.ts`), and the worst reset — the one after `collections-pagination` leaves 21
 * collections — is a burst of two dozen deletes. Discovering that ceiling on a fifty-minute emulator job is
 * the kind of failure that reads like an app defect, so the pacing is explicit rather than hopeful.
 */
import type { RecipeServiceClient } from '@kitchensink/recipe-service-client';

import type { FixtureRecipe } from './fixtureManifest.js';
import type { WorldResetPlan, WorldSnapshot } from './worldResetPlan.js';

/** How many recipes/collections to ask for per page when snapshotting. */
const PAGE_SIZE = 100;

/**
 * Everything the signer currently owns.
 *
 * Paged deliberately: `collections-pagination` leaves 21 collections and a flow that created more would go
 * unseen by a single unpaged read, so the reset would leave them behind and the NEXT run would inherit them.
 *
 * @sideEffect Two paged reads against the recipe service.
 */
export async function readWorld(client: RecipeServiceClient): Promise<WorldSnapshot> {
    const recipes: { id: string; title: string }[] = [];
    const collections: { id: string }[] = [];

    for (let page = 1; ; page += 1) {
        const answer = await client.listRecipes({ page, pageSize: PAGE_SIZE });
        recipes.push(...answer.data.map((recipe) => ({ id: recipe.id, title: recipe.title })));

        if (!answer.hasMore) {
            break;
        }
    }

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
 * Resolve every ingredient name in the given recipes to a catalog id, creating what is missing.
 *
 * `POST /api/v1/ingredients` is get-or-create and ownerless, so this is idempotent and safe to run
 * concurrently with another run doing the same — which matters, because two runs on one PR share a
 * database.
 *
 * @sideEffect Creates ingredient rows.
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
            name: line.name,
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
export const WRITE_SPACING_MS = 250;

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
    const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
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
