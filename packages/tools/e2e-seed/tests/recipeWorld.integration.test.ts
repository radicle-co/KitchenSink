/**
 * The seeder against a real HTTP wire and the REAL wire contract.
 *
 * ⛔ WHAT A MOCKED TEST CANNOT PROVE, and therefore why this tier exists: that the body `toCreateRequest`
 * builds satisfies `createRecipeRequestSchema` — the zod the recipe service validates with. The single most
 * likely defect here is exactly of that kind: `seed.ts` writes `unit: ''` because the DATABASE accepts it,
 * and the write schema REJECTS the empty string so that "unitless" has one representation. A mock would
 * have accepted it happily.
 *
 * The recipe server below validates every request with the shipped schema and answers with shapes the shipped
 * client parses, so both directions cross a boundary a unit test cannot. The food server answers food's own bodies
 * for the one route the seeder calls there; the request side of that route is parsed by `FoodServiceClient` itself,
 * against the shipped food schema, before it is sent.
 *
 * ⚠️ It does NOT prove a deployed service accepts the request. Only the Maestro run does that — this tier
 * would stay green if the schema package and the service had drifted apart, which is the gap ADR-0014's
 * generated-copy scheme exists to close from the other side.
 */
import { createServer, type Server } from 'node:http';
import { text } from 'node:stream/consumers';

import { FoodServiceClient, type FoodError, type FoodResponse } from '@kitchensink/food-service-client';
import { addIngredientByFoodRequestSchema, createRecipeRequestSchema } from '@kitchensink/schema-recipe';
import { RecipeServiceClient } from '@kitchensink/recipe-service-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { deriveFixtureManifest } from '../src/fixtureManifest.js';
import {
    applyPlan,
    ensureCapFoods,
    ensurePrivateFoodRecipe,
    ensureProbeFood,
    PROBE_FOOD_MACROS,
    readWorld,
    toCreateRequest,
} from '../src/recipeWorld.js';
import { planWorldReset } from '../src/worldResetPlan.js';

const RUN = 'gh42-1-maestro';
const manifest = deriveFixtureManifest(RUN, 1);

interface StoredRecipe {
    readonly id: string;
    readonly title: string;
    readonly visibility: 'public' | 'private';
}

/** One stored line: what a create body sent, which a read gives back in the line-view shape. */
interface StoredLine {
    readonly ingredientId: string;
    readonly quantity: unknown;
    readonly unit?: string | undefined;
}

/** What the fake service recorded, so a test can assert on the traffic rather than only the outcome. */
interface Recorded {
    recipes: StoredRecipe[];
    collections: { id: string }[];
    createdBodies: unknown[];
    schemaFailures: string[];
    deleted: string[];
    ingredientNames: string[];
    /**
     * Authored foods by name, each with its food id and the binding recipe's `by-food` makes for it. Shared by the two
     * fake services, because food creates the food and recipe binds it. Deleting an entry is a PURGE: the next
     * authoring of that name makes a NEW food, under a NEW binding, as the two services do.
     */
    authoredFoods: Map<string, { readonly foodId: string; readonly bindingId: string }>;
    /** Every body food's `POST /api/v1/foods/authored` received. */
    foodCreates: unknown[];
    /** Every `by-food` food id asked for. */
    byFoodRequests: string[];
    /** The lines each stored recipe was created with, by recipe id. */
    recipeLines: Map<string, readonly StoredLine[]>;
    /**
     * Ids only ever count up, so a row deleted and re-created never gets its old id back — a test can then tell
     * "kept" from "replaced".
     */
    lastId: number;
    /** When set, a created recipe's lines are stored bound to THIS binding instead of the one the body sent. */
    rebindCreatedLinesTo?: string;
}

let server: Server;
let baseUrl: string;
let foodServer: Server;
let foodUrl: string;
let state: Recorded;

const json = (body: unknown): string => JSON.stringify(body);

/** A paginated envelope in the shape the client's zod expects. */
const page = <T>(all: readonly T[], pageNumber: number, pageSize: number) => ({
    data: all.slice((pageNumber - 1) * pageSize, pageNumber * pageSize),
    total: all.length,
    page: pageNumber,
    pageSize,
    hasMore: pageNumber * pageSize < all.length,
});

/**
 * A recipe row in the shape the SHIPPED read schema requires.
 *
 * ⚠️ Only the required fields, deliberately. The client parses every response with `recipeSchema`, so a
 * fake that invented optional keys would be asserting our idea of the contract; a fake that supplies the
 * required ones and nothing else fails loudly the day the contract gains a requirement.
 */
const recipeRow = (id: string, title: string, visibility: StoredRecipe['visibility'] = 'public') => ({
    id,
    ownerId: '01J0K6000000000000000000K6',
    title,
    prepTimeMinutes: 1,
    cookTimeMinutes: 1,
    totalTimeMinutes: 2,
    servings: 2,
    visibility,
    status: 'published',
    sourceType: 'user_created',
    hasSubstantiveEdit: false,
    dietaryFlags: [],
    tags: [],
    currentVersion: 1,
    ratingCount: 0,
    usesPremiumCapability: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
});

/**
 * A recipe DETAIL, which `POST /api/v1/recipes` answers with and which the client parses with
 * `recipeDetailSchema` — a strictly larger required set than the list row's.
 */
const recipeDetail = (
    id: string,
    title: string,
    visibility: StoredRecipe['visibility'],
    lines: readonly StoredLine[] = [],
) => ({
    ...recipeRow(id, title, visibility),
    // The line-view shape's required fields only, as `recipeRow` does for the row.
    ingredients: lines.map((line) => ({
        ingredientId: line.ingredientId,
        quantity: line.quantity,
        ...(line.unit === undefined ? {} : { unit: line.unit }),
        isUserEntered: false,
    })),
    steps: [],
    photos: [],
    nutrition: { calories: 0, proteinG: 0, carbsG: 0, fatG: 0, isComplete: false, freshness: 'fresh' },
});

/** A collection row, likewise minimal against `collectionResponseSchema`. */
const collectionRow = (id: string) => ({
    id,
    ownerId: '01J0K6000000000000000000K6',
    name: `collection ${id}`,
    visibility: 'private',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
});

/**
 * A CATALOG UUID, not an opaque token.
 *
 * `recipeIngredientInputSchema` requires a uuid for `ingredientId`, so a fake that returned `ing-1` would
 * make every create fail for a reason that has nothing to do with the seeder — and would hide whether the
 * body was otherwise valid.
 */
const ingredientId = (index: number): string => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;

/** A binding id, from the same uuid space the line schema requires. */
const bindingId = ingredientId;

/** A root binding in the shape the SHIPPED `ingredientSchema` requires: the only shape that carries a `foodId`. */
const boundBinding = (id: string, name: string, foodId: string) => ({
    id,
    name,
    foodId,
    foodResolutionStatus: 'RESOLVED',
    isUserEntered: false,
    createdAt: '2026-01-01T00:00:00.000Z',
});

/**
 * The origin a listening server answers on.
 *
 * @throws {Error} When the server is not listening on a TCP port.
 */
function originOf(listening: Server): string {
    const address = listening.address();

    if (address === null || typeof address === 'string') {
        throw new Error('the fake service is not listening on a TCP port');
    }

    return `http://127.0.0.1:${address.port}`;
}

beforeAll(async () => {
    server = createServer((req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost');

        const send = (status: number, body: unknown): void => {
            res.writeHead(status, { 'content-type': 'application/json' });
            res.end(body === undefined ? '' : json(body));
        };

        if (req.method === 'GET' && url.pathname === '/api/v1/recipes') {
            const size = Number(url.searchParams.get('pageSize') ?? '20');
            const number = Number(url.searchParams.get('page') ?? '1');

            send(
                200,
                page(
                    state.recipes.map((r) => recipeRow(r.id, r.title, r.visibility)),
                    number,
                    size,
                ),
            );

            return;
        }

        if (req.method === 'GET' && url.pathname === '/api/v1/collections') {
            const size = Number(url.searchParams.get('pageSize') ?? '20');
            const number = Number(url.searchParams.get('page') ?? '1');
            send(
                200,
                page(
                    state.collections.map((c) => collectionRow(c.id)),
                    number,
                    size,
                ),
            );

            return;
        }

        const byId = /^\/api\/v1\/recipes\/([^/]+)$/u.exec(url.pathname);

        if (req.method === 'GET' && byId !== null) {
            const stored = state.recipes.find((recipe) => recipe.id === byId[1]);

            if (stored === undefined) {
                send(404, { code: 'NOT_FOUND', message: url.pathname });

                return;
            }

            send(200, recipeDetail(stored.id, stored.title, stored.visibility, state.recipeLines.get(stored.id)));

            return;
        }

        if (req.method === 'DELETE') {
            state.deleted.push(url.pathname);
            state.recipes = state.recipes.filter((r) => !url.pathname.endsWith(r.id));
            state.collections = state.collections.filter((c) => !url.pathname.endsWith(c.id));
            send(204, undefined);

            return;
        }

        let raw = '';
        req.on('data', (chunk: Buffer) => {
            raw += chunk.toString();
        });
        req.on('end', () => {
            const body: unknown = raw === '' ? {} : JSON.parse(raw);

            if (url.pathname === '/api/v1/ingredients/by-food') {
                const parsed = addIngredientByFoodRequestSchema.safeParse(body);

                if (!parsed.success) {
                    state.schemaFailures.push(JSON.stringify(parsed.error.issues));
                    send(400, { code: 'INVALID_REQUEST', message: 'schema' });

                    return;
                }

                state.byFoodRequests.push(parsed.data.foodId);
                // Converges: the same food answers the same binding, under the name FOOD holds for it.
                const owned = [...state.authoredFoods.entries()].find(([, food]) => food.foodId === parsed.data.foodId);

                if (owned === undefined) {
                    send(400, { code: 'UNKNOWN_INGREDIENT', message: parsed.data.foodId });

                    return;
                }

                send(200, boundBinding(owned[1].bindingId, owned[0], owned[1].foodId));

                return;
            }

            if (url.pathname === '/api/v1/ingredients') {
                const name = (body as { name?: string }).name ?? '';
                state.ingredientNames.push(name);
                send(201, {
                    id: ingredientId(state.ingredientNames.length),
                    name,
                    isUserEntered: true,
                    createdAt: '2026-01-01T00:00:00.000Z',
                });

                return;
            }

            if (url.pathname === '/api/v1/recipes') {
                // ⛔ THE POINT OF THIS TIER: the SHIPPED schema, not a mock's idea of one.
                const parsed = createRecipeRequestSchema.safeParse(body);

                if (!parsed.success) {
                    state.schemaFailures.push(JSON.stringify(parsed.error.issues));
                    send(400, { code: 'INVALID_REQUEST', message: 'schema' });

                    return;
                }

                state.createdBodies.push(body);
                state.lastId += 1;
                const id = `r-${state.lastId}`;
                const lines = parsed.data.ingredients.map((line) => ({
                    ingredientId: state.rebindCreatedLinesTo ?? line.ingredientId,
                    quantity: line.quantity,
                    unit: line.unit,
                }));
                state.recipeLines.set(id, lines);
                // The fake STORES what was asked for, visibility included — a fake that answered every row as
                // public would make the reset's visibility comparison see drift that never happened.
                const visibility = parsed.data.visibility === 'private' ? 'private' : 'public';
                state.recipes.push({ id, title: parsed.data.title, visibility });
                send(201, recipeDetail(id, parsed.data.title, visibility, lines));

                return;
            }

            send(404, { code: 'NOT_FOUND', message: url.pathname });
        });
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = originOf(server);

    // Food: the one route the seeder calls there, answering food's own bodies.
    foodServer = createServer((req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost');

        const send = (status: number, body: FoodResponse | FoodError): void => {
            res.writeHead(status, { 'content-type': 'application/json' });
            res.end(json(body));
        };

        if (req.method !== 'POST' || url.pathname !== '/api/v1/foods/authored') {
            res.writeHead(404);
            res.end();

            return;
        }

        void text(req).then((raw) => {
            const body: unknown = JSON.parse(raw);
            state.foodCreates.push(body);
            const name =
                typeof body === 'object' && body !== null && 'name' in body && typeof body.name === 'string'
                    ? body.name
                    : '';
            const existing = state.authoredFoods.get(name);

            // The per-author dedup: a name the caller already authored is refused, naming the existing food.
            if (existing !== undefined) {
                send(409, {
                    code: 'DUPLICATE_AUTHORED_NAME',
                    message: 'already authored',
                    details: { existingId: existing.foodId },
                });

                return;
            }

            state.lastId += 1;
            const food = { foodId: `food-${state.lastId}`, bindingId: bindingId(900 + state.lastId) };
            state.authoredFoods.set(name, food);
            send(201, {
                id: food.foodId,
                name,
                description: null,
                kind: 'authored',
                status: 'RESOLVED',
                nutrients: [],
                portions: [],
                provenance: {},
                visibility: 'private',
                variants: [],
            });
        });
    });

    await new Promise<void>((resolve) => foodServer.listen(0, '127.0.0.1', resolve));
    foodUrl = originOf(foodServer);
});

afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await new Promise<void>((resolve) => foodServer.close(() => resolve()));
});

const freshState = (): Recorded => ({
    recipes: [],
    collections: [],
    createdBodies: [],
    schemaFailures: [],
    deleted: [],
    ingredientNames: [],
    authoredFoods: new Map(),
    foodCreates: [],
    byFoodRequests: [],
    recipeLines: new Map(),
    lastId: 0,
});

const client = (): RecipeServiceClient => new RecipeServiceClient({ baseUrl, token: 'test-token', timeoutMs: 10_000 });

/** The seeder's two clients for an authored food: food creates it, recipe binds it. */
const foodClients = () => ({
    food: new FoodServiceClient({ baseUrl: foodUrl, token: 'test-token', timeoutMs: 10_000 }),
    recipe: client(),
});

const noSleep = { sleep: async (): Promise<void> => undefined, writeSpacingMs: 0 };

describe('the seeder over a real wire', () => {
    it('builds create requests the SHIPPED contract accepts', async () => {
        state = freshState();
        const plan = planWorldReset({ recipes: [], collections: [] }, manifest, 'seeded');

        await applyPlan(client(), plan, noSleep);

        // Every seeded recipe parsed against `createRecipeRequestSchema`. A single failure here is the
        // seeder building a body the service would reject — the defect a mocked test cannot see.
        expect(state.schemaFailures).toEqual([]);
        expect(state.createdBodies).toHaveLength(3);
    });

    it('omits `unit` on a unitless line rather than sending the empty string the schema rejects', async () => {
        state = freshState();
        const lamb = manifest.recipes.find((recipe) => recipe.baseTitle === 'Mediterranean Grilled Lamb');
        const request = toCreateRequest(
            lamb!,
            new Map(lamb!.ingredients.map((line, index) => [line.name, ingredientId(index + 1)])),
        );
        const unitless = request.ingredients.filter((line) => !('unit' in line));

        // The lamb has two unitless lines (8 chops, 1 lemon). Both must be ABSENT keys, not empty strings.
        expect(unitless.length).toBeGreaterThan(0);
        expect(createRecipeRequestSchema.safeParse(request).success).toBe(true);

        const withEmpty = {
            ...request,
            ingredients: request.ingredients.map((line) => ({ ...line, unit: '' })),
        };

        // The complement: prove the schema really does reject what `seed.ts` writes to the database, so
        // this assertion is about the contract rather than about our own formatting.
        expect(createRecipeRequestSchema.safeParse(withEmpty).success).toBe(false);
    });

    it('resolves every ingredient name exactly once per reset', async () => {
        state = freshState();

        await applyPlan(client(), planWorldReset({ recipes: [], collections: [] }, manifest, 'seeded'), noSleep);

        expect(new Set(state.ingredientNames).size).toBe(state.ingredientNames.length);
    });

    it('reads a library that spans MORE than one page', async () => {
        // `collectionsPagination` leaves 21 collections; an unpaged read would miss everything past the
        // first page, the reset would leave them behind, and the next run would inherit them.
        state = freshState();
        state.recipes = Array.from({ length: 250 }, (_, index) => ({
            id: `r${index}`,
            title: `t${index}`,
            visibility: 'public' as const,
        }));
        state.collections = Array.from({ length: 130 }, (_, index) => ({ id: `c${index}` }));

        const world = await readWorld(client());

        expect(world.recipes).toHaveLength(250);
        expect(world.collections).toHaveLength(130);
    });

    it('deletes residue and recreates the manifest in ONE pass, deletes before creates', async () => {
        state = freshState();
        state.recipes = [{ id: 'stale', title: 'Maestro Weeknight Soup', visibility: 'private' }];
        state.collections = [{ id: 'c1' }];

        await applyPlan(
            client(),
            planWorldReset({ recipes: state.recipes, collections: state.collections }, manifest, 'seeded'),
            noSleep,
        );

        expect(state.deleted).toContain('/api/v1/recipes/stale');
        expect(state.deleted).toContain('/api/v1/collections/c1');
        expect(state.recipes.map((r) => r.title).sort()).toEqual(
            manifest.recipes
                .filter((r) => r.owner === 'signer')
                .map((r) => r.title)
                .sort(),
        );
    });

    it("reads each row's VISIBILITY off the wire and replaces a seeded recipe a flow left at the wrong one", async () => {
        // `recipes/visibility` flips the private lamb public and back. If it dies between the legs, the next reset
        // must see the drift THROUGH the real list contract, which a pure planner test cannot show.
        state = freshState();
        await applyPlan(client(), planWorldReset({ recipes: [], collections: [] }, manifest, 'seeded'), noSleep);
        const lamb = manifest.recipes.find((recipe) => recipe.key === 'lamb');
        const stored = state.recipes.find((recipe) => recipe.title === lamb?.title);
        expect(stored?.visibility).toBe('private');
        state.recipes = state.recipes.map((recipe) =>
            recipe.id === stored?.id ? { ...recipe, visibility: 'public' as const } : recipe,
        );
        state.deleted = [];
        state.createdBodies = [];

        const world = await readWorld(client());
        await applyPlan(client(), planWorldReset(world, manifest, 'seeded'), noSleep);

        expect(state.deleted).toEqual([`/api/v1/recipes/${stored?.id ?? ''}`]);
        expect(state.createdBodies).toHaveLength(1);
        expect(state.recipes.find((recipe) => recipe.title === lamb?.title)?.visibility).toBe('private');
    });

    it('creates NOTHING in empty mode, and clears what is there', async () => {
        state = freshState();
        state.recipes = [{ id: 'r1', title: 'anything', visibility: 'private' }];

        await applyPlan(
            client(),
            planWorldReset({ recipes: state.recipes, collections: [] }, manifest, 'empty'),
            noSleep,
        );

        expect(state.recipes).toEqual([]);
        expect(state.createdBodies).toEqual([]);
    });

    it('is idempotent — a second reset against a settled world writes nothing at all', async () => {
        state = freshState();

        await applyPlan(client(), planWorldReset({ recipes: [], collections: [] }, manifest, 'seeded'), noSleep);
        const afterFirst = [...state.recipes];
        state.deleted = [];
        state.createdBodies = [];

        await applyPlan(
            client(),
            planWorldReset({ recipes: state.recipes, collections: [] }, manifest, 'seeded'),
            noSleep,
        );

        expect(state.deleted).toEqual([]);
        expect(state.createdBodies).toEqual([]);
        expect(state.recipes).toEqual(afterFirst);
    });
});

/**
 * ⛔ THE DISCOVERY PROBE IS A FOOD (plan 002 R45). The filter keys on a food id, and a declared name has none, so
 * the old `createIngredient(probe)` produced something the filter could never pick. What only this tier proves is
 * that the two requests the probe makes satisfy the SHIPPED schemas and that the client parses both answers.
 */
describe('the discovery probe over a real wire', () => {
    it('authors the probe at food, binds it with a body the SHIPPED contract accepts, and gets a food binding', async () => {
        state = freshState();

        const probe = await ensureProbeFood(foodClients(), manifest.probeIngredient);

        expect(state.schemaFailures).toEqual([]);
        expect(state.foodCreates).toEqual([{ name: manifest.probeIngredient, macros: PROBE_FOOD_MACROS }]);
        expect(state.byFoodRequests).toEqual([probe.foodId]);
        expect(state.authoredFoods.has(manifest.probeIngredient)).toBe(true);
        expect(probe.foodId).toBe(state.authoredFoods.get(manifest.probeIngredient)?.foodId);
        expect(probe.name).toBe(manifest.probeIngredient);
        // Nothing went through the declared-name route: a declared name is exactly what the filter cannot pick.
        expect(state.ingredientNames).toEqual([]);
    });

    /**
     * Food refuses a name the caller already authored with `409 DUPLICATE_AUTHORED_NAME`, naming the existing food,
     * and the client turns that into a result. Both runs bind through by-food, so both land on the same binding.
     */
    it('re-binds the caller’s EXISTING food through by-food on a second run, and lands on the same binding', async () => {
        state = freshState();

        const first = await ensureProbeFood(foodClients(), manifest.probeIngredient);
        const second = await ensureProbeFood(foodClients(), manifest.probeIngredient);

        expect(state.schemaFailures).toEqual([]);
        expect(state.authoredFoods.size).toBe(1);
        expect(state.byFoodRequests).toEqual([first.foodId, first.foodId]);
        expect(second.id).toBe(first.id);
    });
});

/**
 * The foods `recipes/discoverIngredientCap.yaml` fills the filter with. The filter's search lists a food once the
 * caller can see a binding of it, so a bound food is the whole fixture: what this tier proves is that the six bodies
 * pass the SHIPPED contract, that a re-run lands on the same six foods, and that no recipe is written for them.
 */
describe('the cap foods over a real wire', () => {
    const names = manifest.capFoodNames;

    it('authors each one with a body the SHIPPED contract accepts, and gets back a food-backed binding', async () => {
        state = freshState();

        const foods = await ensureCapFoods(foodClients(), names);

        expect(state.schemaFailures).toEqual([]);
        expect([...state.authoredFoods.keys()]).toEqual(names);
        expect(foods.map((food) => food.foodId)).toEqual(names.map((name) => state.authoredFoods.get(name)?.foodId));
        expect(state.ingredientNames).toEqual([]);
        expect(state.createdBodies).toEqual([]);
        expect(state.recipes).toEqual([]);
    });

    it('is idempotent — a second run re-binds the same six foods and authors none', async () => {
        state = freshState();
        const first = await ensureCapFoods(foodClients(), names);

        const second = await ensureCapFoods(foodClients(), names);

        expect(state.schemaFailures).toEqual([]);
        expect(state.authoredFoods.size).toBe(names.length);
        expect(state.byFoodRequests).toEqual([...first, ...first].map((food) => food.foodId));
        expect(second.map((food) => food.id)).toEqual(first.map((food) => food.id));
        expect(state.createdBodies).toEqual([]);
    });
});

/**
 * ⛔ THE CO-AUTHOR'S PRIVATE-FOOD RECIPE IS ONE FIXTURE WITH ITS FOOD. `recipes/privateFoodStandIn.yaml` needs a
 * public recipe whose line is bound to a food the signer may not see. What only this tier proves: the create body
 * passes the SHIPPED contract, the read-back crosses the real client, and a recipe that outlived its food is
 * replaced — found by the binding its line points at, which a title check cannot see.
 */
describe('the private-food recipe over a real wire', () => {
    const recipe = manifest.privateFoodRecipe;
    const name = manifest.privateFoodName;
    const rowsTitled = (): StoredRecipe[] => state.recipes.filter((row) => row.title === recipe.title);

    it('authors the food and publishes ONE public line — 2 tbsp — bound to it, in a body the contract accepts', async () => {
        state = freshState();

        const result = await ensurePrivateFoodRecipe(foodClients(), recipe, name);

        const food = state.authoredFoods.get(name);
        expect(state.schemaFailures).toEqual([]);
        expect(food).toBeDefined();
        expect(rowsTitled()).toEqual([{ id: result.recipeId, title: recipe.title, visibility: 'public' }]);
        expect(state.createdBodies).toHaveLength(1);
        expect((state.createdBodies[0] as { ingredients: unknown }).ingredients).toEqual([
            { ingredientId: food?.bindingId, quantity: { kind: 'exact', value: 2 }, unit: 'tbsp' },
        ]);
        // Nothing went through the declared-name route: a declared name has no food, so every viewer could read it.
        expect(state.ingredientNames).toEqual([]);
    });

    it('writes NOTHING against an intact pair — a re-run keeps the recipe it already made', async () => {
        state = freshState();
        const first = await ensurePrivateFoodRecipe(foodClients(), recipe, name);
        state.createdBodies = [];

        const second = await ensurePrivateFoodRecipe(foodClients(), recipe, name);

        expect(second.recipeId).toBe(first.recipeId);
        expect(state.createdBodies).toEqual([]);
        expect(state.deleted).toEqual([]);
        expect(state.schemaFailures).toEqual([]);
    });

    /**
     * ⛔ THE REASON THE PAIR IS JUDGED AS ONE. A purge removed the food and kept the recipe. Its title still matches,
     * but its line now reads `FOOD_REMOVED` for everyone — the flow would fail on a state the app is right to show.
     */
    it('⛔ replaces the recipe when a purge removed its food but kept it', async () => {
        state = freshState();
        const first = await ensurePrivateFoodRecipe(foodClients(), recipe, name);
        const staleBinding = state.authoredFoods.get(name)?.bindingId;
        state.authoredFoods.delete(name);
        state.createdBodies = [];

        const second = await ensurePrivateFoodRecipe(foodClients(), recipe, name);

        const food = state.authoredFoods.get(name);
        expect(food?.bindingId).not.toBe(staleBinding);
        expect(state.deleted).toEqual([`/api/v1/recipes/${first.recipeId}`]);
        expect(rowsTitled()).toEqual([{ id: second.recipeId, title: recipe.title, visibility: 'public' }]);
        expect(state.recipeLines.get(second.recipeId)?.map((line) => line.ingredientId)).toEqual([food?.bindingId]);
        expect(state.schemaFailures).toEqual([]);
    });

    it('⛔ refuses loudly when the recipe it made does not come back bound to the food', async () => {
        state = freshState();
        state.rebindCreatedLinesTo = bindingId(1);

        await expect(ensurePrivateFoodRecipe(foodClients(), recipe, name)).rejects.toThrow(/not bound to/u);
    });
});
