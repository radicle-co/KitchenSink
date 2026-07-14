import type { Page } from '@playwright/test';
import type { Ingredient, PaginatedResponse, Recipe, RecipeDetail, RecipeVisibility } from '@kitchensink/recipe-core';

/**
 * Recipe-service route mocks for the web E2E specs (T079/T080). The recipe pages are auth-gated server
 * shells that render CLIENT containers fetching the recipe service via TanStack Query in the browser, so a
 * `page.route` glob over the `/v1/` API intercepts every call. This installs a small in-memory store so a
 * happy path is
 * coherent across requests (create → the list/detail reflect it, edit bumps the version, delete removes it,
 * clone yields a new recipe, visibility toggles). The real backend is covered separately by the
 * recipe-service's own e2e + k6 tiers; these specs verify the full UI integration against a controlled
 * contract.
 */

const ISO = '2026-01-01T00:00:00.000Z';

/** A fully-valid base recipe; overrides win. */
function makeRecipe(over: Partial<Recipe> = {}): Recipe {
    return {
        id: 'rec_seed',
        ownerId: 'usr_e2e',
        title: 'Seed Recipe',
        description: 'A seeded recipe.',
        prepTimeMinutes: 10,
        cookTimeMinutes: 20,
        totalTimeMinutes: 30,
        servings: 4,
        visibility: 'public',
        sourceType: 'user_created',
        hasSubstantiveEdit: false,
        dietaryFlags: [],
        tags: [],
        hasPartialNutrition: false,
        currentVersion: 1,
        createdAt: ISO,
        updatedAt: ISO,
        ...over,
    };
}

/** A fully-valid recipe detail (base + embedded ingredients/steps/photos/nutrition); overrides win. */
export function makeRecipeDetail(over: Partial<RecipeDetail> = {}): RecipeDetail {
    return {
        ...makeRecipe(over),
        ingredients: over.ingredients ?? [
            { ingredientId: 'ing_salt', name: 'Salt', quantity: 1, unit: 'tsp', isUserEntered: false },
        ],
        steps: over.steps ?? [{ stepNumber: 1, instruction: 'Combine and cook.' }],
        photos: over.photos ?? [],
        nutrition: over.nutrition ?? { calories: 420, proteinG: 12, carbsG: 40, fatG: 18, isComplete: true },
    };
}

const catalogIngredient: Ingredient = {
    id: 'ing_salt',
    name: 'Salt',
    foodId: 'food_salt',
    isUserEntered: false,
    createdAt: ISO,
};

/**
 * Read the authenticated viewer's app-user id from the live Clerk session token's `external_id` claim — the
 * SAME claim the recipe UI uses to gate owner-only actions (delete/edit/visibility). Seed the mock's recipe
 * `ownerId` with this so those controls render for the test user. Falls back to a sentinel when the claim is
 * absent (which would itself hide owner controls — a signal the Clerk JWT template needs `external_id`).
 *
 * @param page - A page with a live Clerk session (call after `signInWithTicket`).
 * @returns The viewer's app-user id, or `'usr_e2e'` if the claim is unavailable.
 * @sideEffect Reads the Clerk session token in the page context.
 */
export async function readViewerAppId(page: Page): Promise<string> {
    const jwt = await page.evaluate(async () => {
        const clerk = (window as unknown as { Clerk?: { session?: { getToken(): Promise<string | null> } } }).Clerk;

        return clerk?.session ? await clerk.session.getToken() : null;
    });

    if (jwt === null) {
        return 'usr_e2e';
    }

    try {
        const [, payload] = jwt.split('.');
        const claims = JSON.parse(Buffer.from(payload as string, 'base64').toString('utf8')) as Record<string, unknown>;

        return typeof claims['external_id'] === 'string' ? (claims['external_id'] as string) : 'usr_e2e';
    } catch {
        return 'usr_e2e';
    }
}

/** Options for {@link mockRecipeApi}. */
export interface MockRecipeApiOptions {
    /** Recipes to seed the store with (defaults to one public "Seed Recipe" owned by the viewer). */
    readonly recipes?: readonly RecipeDetail[];
    /** The viewer's subscription tier surfaced at `/v1/users/me` (defaults to premium so private is enabled). */
    readonly tier?: 'free' | 'premium';
    /** The app-user id the viewer owns recipes as (matches the recipe `ownerId` so owner controls show). */
    readonly viewerId?: string;
}

/**
 * Install the recipe-service route mocks on `page`. Returns the live store so a spec can assert server state.
 *
 * @param page - The Playwright page.
 * @param options - Seed data + viewer identity/tier.
 * @returns The in-memory recipe store (id → detail).
 * @sideEffect Registers a `page.route` handler.
 */
export async function mockRecipeApi(
    page: Page,
    options: MockRecipeApiOptions = {},
): Promise<Map<string, RecipeDetail>> {
    const viewerId = options.viewerId ?? 'usr_e2e';
    const tier = options.tier ?? 'premium';
    const store = new Map<string, RecipeDetail>();
    let nextId = 1;

    const seed = options.recipes ?? [makeRecipeDetail({ id: 'rec_seed', ownerId: viewerId, title: 'Seed Recipe' })];

    for (const recipe of seed) {
        store.set(recipe.id, recipe);
    }

    const page_ = {
        data: (recipes: RecipeDetail[]): PaginatedResponse<Recipe> => ({
            data: recipes,
            total: recipes.length,
            page: 1,
            pageSize: 20,
            hasMore: false,
        }),
    };

    await page.route('**/v1/**', async (route) => {
        const request = route.request();
        const method = request.method();
        const path = new URL(request.url()).pathname;
        const body = (): Record<string, unknown> =>
            request.postData() ? JSON.parse(request.postData() as string) : {};

        // Identity profile → drives the premium visibility gate.
        if (path.endsWith('/v1/users/me')) {
            return route.fulfill({
                json: {
                    user: { id: viewerId, displayName: 'E2E', email: 'e2e@example.com', status: 'active' },
                    account: { subscriptionTier: tier },
                },
            });
        }

        // Ingredient typeahead + freeform create.
        if (path.endsWith('/v1/ingredients/search')) {
            return route.fulfill({ json: [catalogIngredient] });
        }

        if (path.endsWith('/v1/ingredients') && method === 'POST') {
            return route.fulfill({ status: 201, json: catalogIngredient });
        }

        // Photos (edit surface mounts the uploader): empty list.
        if (/\/v1\/recipes\/[^/]+\/photos$/.test(path)) {
            return route.fulfill({ json: [] });
        }

        // Clone → a new recipe owned by the viewer, attributed to the source.
        const clone = path.match(/\/v1\/recipes\/([^/]+)\/clone$/);

        if (clone && method === 'POST') {
            const source = store.get(clone[1] as string);
            const created = makeRecipeDetail({
                id: `rec_clone_${nextId++}`,
                ownerId: viewerId,
                title: `${source?.title ?? 'Recipe'} (copy)`,
                visibility: 'private',
                clonedFromId: clone[1] as string,
                sourceAttribution: source?.title,
            });
            store.set(created.id, created);

            return route.fulfill({ status: 201, json: created });
        }

        // Visibility toggle.
        const visibility = path.match(/\/v1\/recipes\/([^/]+)\/visibility$/);

        if (visibility && method === 'PATCH') {
            const id = visibility[1] as string;
            const current = store.get(id);

            if (!current) {
                return route.fulfill({ status: 404, json: { code: 'NOT_FOUND', message: 'no recipe' } });
            }

            const updated = {
                ...current,
                visibility: (body()['visibility'] as RecipeVisibility) ?? current.visibility,
            };
            store.set(id, updated);

            return route.fulfill({ json: updated });
        }

        // Single recipe: get / update / delete.
        const single = path.match(/\/v1\/recipes\/([^/]+)$/);

        if (single) {
            const id = single[1] as string;
            const current = store.get(id);

            if (method === 'GET') {
                return current
                    ? route.fulfill({ json: current })
                    : route.fulfill({ status: 404, json: { code: 'NOT_FOUND', message: 'no recipe' } });
            }

            if (method === 'PATCH') {
                if (!current) {
                    return route.fulfill({ status: 404, json: { code: 'NOT_FOUND', message: 'no recipe' } });
                }

                const input = body();
                const updated = makeRecipeDetail({
                    ...current,
                    ...(typeof input['title'] === 'string' ? { title: input['title'] } : {}),
                    currentVersion: current.currentVersion + 1,
                });
                store.set(id, updated);

                return route.fulfill({ json: updated });
            }

            if (method === 'DELETE') {
                store.delete(id);

                return route.fulfill({ status: 204, body: '' });
            }
        }

        // Collection: list + create.
        if (path.endsWith('/v1/recipes')) {
            if (method === 'GET') {
                return route.fulfill({ json: page_.data([...store.values()]) });
            }

            if (method === 'POST') {
                const input = body();
                const created = makeRecipeDetail({
                    id: `rec_new_${nextId++}`,
                    ownerId: viewerId,
                    title: typeof input['title'] === 'string' ? input['title'] : 'New Recipe',
                    servings: typeof input['servings'] === 'number' ? input['servings'] : 4,
                });
                store.set(created.id, created);

                return route.fulfill({ status: 201, json: created });
            }
        }

        return route.fulfill({ status: 404, json: { code: 'NOT_FOUND', message: `unmocked ${method} ${path}` } });
    });

    return store;
}
