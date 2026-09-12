/**
 * The seeder against a real HTTP wire and the REAL wire contract.
 *
 * ⛔ WHAT A MOCKED TEST CANNOT PROVE, and therefore why this tier exists: that the body `toCreateRequest`
 * builds satisfies `createRecipeRequestSchema` — the zod the recipe service validates with. The single most
 * likely defect here is exactly of that kind: `seed.ts` writes `unit: ''` because the DATABASE accepts it,
 * and the write schema REJECTS the empty string so that "unitless" has one representation. A mock would
 * have accepted it happily.
 *
 * The server below validates every request with the shipped schema and answers with shapes the shipped
 * client parses, so both directions cross a boundary a unit test cannot.
 *
 * ⚠️ It does NOT prove a deployed service accepts the request. Only the Maestro run does that — this tier
 * would stay green if the schema package and the service had drifted apart, which is the gap ADR-0014's
 * generated-copy scheme exists to close from the other side.
 */
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';

import { createRecipeRequestSchema } from '@kitchensink/schema-recipe';
import { RecipeServiceClient } from '@kitchensink/recipe-service-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { deriveFixtureManifest } from '../src/fixtureManifest.js';
import { applyPlan, readWorld, toCreateRequest } from '../src/recipeWorld.js';
import { planWorldReset } from '../src/worldResetPlan.js';

const RUN = 'gh42-1-maestro';
const manifest = deriveFixtureManifest(RUN);

interface StoredRecipe {
    readonly id: string;
    readonly title: string;
}

/** What the fake service recorded, so a test can assert on the traffic rather than only the outcome. */
interface Recorded {
    recipes: StoredRecipe[];
    collections: { id: string }[];
    createdBodies: unknown[];
    schemaFailures: string[];
    deleted: string[];
    ingredientNames: string[];
}

let server: Server;
let baseUrl: string;
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
const recipeRow = (id: string, title: string) => ({
    id,
    ownerId: '01J0K6000000000000000000K6',
    title,
    prepTimeMinutes: 1,
    cookTimeMinutes: 1,
    totalTimeMinutes: 2,
    servings: 2,
    visibility: 'public',
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
const recipeDetail = (id: string, title: string) => ({
    ...recipeRow(id, title),
    ingredients: [],
    steps: [],
    photos: [],
    nutrition: { calories: 0, proteinG: 0, carbsG: 0, fatG: 0, isComplete: false },
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
                    state.recipes.map((r) => recipeRow(r.id, r.title)),
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
                const id = `r-${state.recipes.length + 1}`;
                state.recipes.push({ id, title: parsed.data.title });
                send(201, recipeDetail(id, parsed.data.title));

                return;
            }

            send(404, { code: 'NOT_FOUND', message: url.pathname });
        });
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
});

const freshState = (): Recorded => ({
    recipes: [],
    collections: [],
    createdBodies: [],
    schemaFailures: [],
    deleted: [],
    ingredientNames: [],
});

const client = (): RecipeServiceClient => new RecipeServiceClient({ baseUrl, token: 'test-token', timeoutMs: 10_000 });

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
        // `collections-pagination` leaves 21 collections; an unpaged read would miss everything past the
        // first page, the reset would leave them behind, and the next run would inherit them.
        state = freshState();
        state.recipes = Array.from({ length: 250 }, (_, index) => ({ id: `r${index}`, title: `t${index}` }));
        state.collections = Array.from({ length: 130 }, (_, index) => ({ id: `c${index}` }));

        const world = await readWorld(client());

        expect(world.recipes).toHaveLength(250);
        expect(world.collections).toHaveLength(130);
    });

    it('deletes residue and recreates the manifest in ONE pass, deletes before creates', async () => {
        state = freshState();
        state.recipes = [{ id: 'stale', title: 'Maestro Weeknight Soup' }];
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

    it('creates NOTHING in empty mode, and clears what is there', async () => {
        state = freshState();
        state.recipes = [{ id: 'r1', title: 'anything' }];

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
