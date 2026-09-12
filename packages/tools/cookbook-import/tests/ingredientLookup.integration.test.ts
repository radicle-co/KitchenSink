/**
 * Integration tier — one ingredient lookup over a REAL HTTP wire, through the REAL clients (plan 002 S5).
 *
 * | Requirement | Test |
 * | ----------- | ---- |
 * | The lookup searches food's two split routes, as the curator, with the name as written | "asks both of food’s searches" |
 * | The curator's own foods lead, then the catalog, each in food's order, nameless dropped (S5 list contract) | "binds the curator’s own food" |
 * | A catalog result that names a variant binds the variant | "binds the variant" |
 * | Each search fails on its own and is reported apart from a miss (L3) | "a failed search" |
 * | Nothing offered: the "Not listed?" rung | "adds by name" |
 *
 * What only this tier proves: that `FoodServiceClient` reaches the two routes this lookup names and parses their
 * answers, that food's own error bodies become a failed search rather than a crash, and that `RecipeApiClient`'s two
 * binding doors send bodies the SHIPPED recipe schemas accept. The unit tier proves the ladder against fakes that
 * would agree with anything.
 *
 * Self-contained: two in-process `node:http` servers, one per service, the shape `@kitchensink/e2e-seed`'s integration
 * tier uses. ⚠️ It does not prove a deployed food or recipe service answers this way; the linkage tier
 * (`@kitchensink/cross-service-e2e`) drives the deployed pair.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { text } from 'node:stream/consumers';

import {
    FoodServiceClient,
    type AuthoredFoodSearchResponse,
    type CatalogSearchResponse,
    type FoodError,
} from '@kitchensink/food-service-client';
import { makeIngredient } from '@kitchensink/recipe-core/testing';
import {
    addIngredientByFoodRequestSchema,
    addIngredientByFoodVariantRequestSchema,
    createIngredientRequestSchema,
} from '@kitchensink/schema-recipe';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { RecipeApiClient } from '../src/RecipeApiClient.js';
import { resolveIngredientLikeAUser, type IngredientResolutionPorts } from '../src/resolveIngredient.js';

/** The curator's bearer: the same token reaches both services. */
const TOKEN = 'curator-token';

/** How a fake food route answers: food's success body, or one of food's own error bodies. */
type RouteAnswer<B> =
    | { readonly status: 200; readonly body: B }
    | { readonly status: 429 | 503; readonly body: FoodError; readonly retryAfter: string };

/** One request a fake service received. */
interface Received {
    readonly path: string;
    readonly query: string | null;
    readonly authorization: string | undefined;
    readonly body: unknown;
}

/** What the two fake services answer and record. */
interface World {
    authored: RouteAnswer<AuthoredFoodSearchResponse>;
    catalog: RouteAnswer<CatalogSearchResponse>;
    readonly food: Received[];
    readonly recipe: Received[];
    readonly schemaFailures: string[];
}

/** A world where both searches find nothing and nothing has been asked. */
const freshWorld = (): World => ({
    authored: { status: 200, body: { results: [] } },
    catalog: { status: 200, body: { results: [] } },
    food: [],
    recipe: [],
    schemaFailures: [],
});

let world = freshWorld();
let foodServer: Server;
let recipeServer: Server;
let foodUrl = '';
let recipeUrl = '';

/** A uuid for a binding, as recipe mints them. */
const bindingId = (index: number): string => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;

/**
 * Read a request's whole body as JSON, or `undefined` when it sent none.
 *
 * @sideEffect Consumes the request stream.
 */
async function bodyOf(req: IncomingMessage): Promise<unknown> {
    const raw = await text(req);

    return raw === '' ? undefined : JSON.parse(raw);
}

/**
 * The origin a listening server answers on.
 *
 * @throws {Error} When the server is not listening on a TCP port.
 */
function originOf(server: Server): string {
    const address = server.address();

    if (address === null || typeof address === 'string') {
        throw new Error('the fake service is not listening on a TCP port');
    }

    return `http://127.0.0.1:${address.port}`;
}

/** Answer `res` with a JSON body. */
function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(JSON.stringify(body));
}

/** Answer one of food's two split searches from `answer`. */
function answerSearch<B>(res: ServerResponse, answer: RouteAnswer<B>): void {
    if (answer.status === 200) {
        send(res, 200, answer.body);

        return;
    }

    send(res, answer.status, answer.body, { 'retry-after': answer.retryAfter });
}

/**
 * Validate a binding request with the SHIPPED schema, recording a failure instead of answering.
 *
 * @returns Whether the body passed.
 */
function accepts(schema: { safeParse: (value: unknown) => { success: boolean } }, body: unknown): boolean {
    const parsed = schema.safeParse(body);

    if (!parsed.success) {
        world.schemaFailures.push(JSON.stringify(body));
    }

    return parsed.success;
}

/**
 * The fake recipe service: its three binding doors, each validating the body with the SHIPPED schema.
 *
 * @sideEffect Reads the request, records it, and answers it.
 */
async function answerRecipe(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const body = await bodyOf(req);

    world.recipe.push({ path: url.pathname, query: null, authorization: req.headers.authorization, body });

    if (url.pathname === '/api/v1/ingredients/by-food' && accepts(addIngredientByFoodRequestSchema, body)) {
        const { foodId } = addIngredientByFoodRequestSchema.parse(body);
        send(res, 200, makeIngredient({ id: bindingId(1), name: `food ${foodId}`, foodId }));

        return;
    }

    if (
        url.pathname === '/api/v1/ingredients/by-food-variant' &&
        accepts(addIngredientByFoodVariantRequestSchema, body)
    ) {
        const { foodVariantId } = addIngredientByFoodVariantRequestSchema.parse(body);
        send(
            res,
            200,
            makeIngredient({
                id: bindingId(2),
                name: 'beef brisket',
                foodId: 'food_brisket',
                variant: { id: foodVariantId, parts: [{ attribute: 'cut', text: 'flat' }] },
            }),
        );

        return;
    }

    if (url.pathname === '/api/v1/ingredients/by-name' && accepts(createIngredientRequestSchema, body)) {
        const { name } = createIngredientRequestSchema.parse(body);
        send(res, 202, makeIngredient({ id: bindingId(3), name, foodId: undefined, foodResolutionStatus: 'PENDING' }));

        return;
    }

    send(res, 400, { code: 'INVALID_REQUEST', message: url.pathname });
}

beforeAll(async () => {
    foodServer = createServer((req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost');

        // The client's contract-skew probe (`food-service-client` `contractSkew.ts`): unauthenticated, once per origin,
        // and no part of a lookup. A 404 is silence to it.
        if (url.pathname === '/health') {
            send(res, 404, { code: 'NOT_FOUND', message: url.pathname });

            return;
        }

        world.food.push({
            path: url.pathname,
            query: url.searchParams.get('query'),
            authorization: req.headers.authorization,
            body: undefined,
        });

        if (req.method === 'GET' && url.pathname === '/api/v1/foods/authored/search') {
            answerSearch(res, world.authored);

            return;
        }

        if (req.method === 'GET' && url.pathname === '/api/v1/foods/catalog/search') {
            answerSearch(res, world.catalog);

            return;
        }

        send(res, 404, { code: 'NOT_FOUND', message: url.pathname });
    });

    recipeServer = createServer((req, res) => {
        void answerRecipe(req, res);
    });

    for (const server of [foodServer, recipeServer]) {
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    }

    foodUrl = originOf(foodServer);
    recipeUrl = originOf(recipeServer);
});

afterAll(async () => {
    for (const server of [foodServer, recipeServer]) {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
});

beforeEach(() => {
    world = freshWorld();
});

/**
 * The two real clients, authenticated as the curator. A FRESH food client per test: it remembers a `429`'s window per
 * instance, and one test's refusal must not hold the next one's search.
 */
const ports = (): IngredientResolutionPorts => ({
    food: new FoodServiceClient({ baseUrl: foodUrl, token: TOKEN, timeoutMs: 5_000 }),
    recipe: new RecipeApiClient({ baseUrl: recipeUrl, token: TOKEN }),
});

/** The recipe requests, as `path body`. */
const recipeCalls = (): string[] => world.recipe.map((call) => `${call.path} ${JSON.stringify(call.body)}`);

describe('one lookup over the wire', () => {
    it('asks both of food’s searches, as the curator, for the name as written', async () => {
        await resolveIngredientLikeAUser(ports(), 'butter');

        expect(world.food.map((call) => [call.path, call.query]).sort()).toEqual([
            ['/api/v1/foods/authored/search', 'butter'],
            ['/api/v1/foods/catalog/search', 'butter'],
        ]);
        expect(new Set([...world.food, ...world.recipe].map((call) => call.authorization))).toEqual(
            new Set([`Bearer ${TOKEN}`]),
        );
    });

    it('binds the curator’s own food ahead of the catalog’s, skipping a nameless result', async () => {
        world.authored = {
            status: 200,
            body: {
                results: [
                    { id: 'food_nameless', name: null, score: 0.9 },
                    { id: 'food_mine', name: 'my butter', score: 0.4 },
                ],
            },
        };
        world.catalog = { status: 200, body: { results: [{ id: 'food_catalog', name: 'butter', score: 1 }] } };

        const outcome = await resolveIngredientLikeAUser(ports(), 'butter');

        expect(outcome).toMatchObject({
            kind: 'authored_suggestion',
            catalogAvailability: 'ok',
            authoredAvailability: 'ok',
        });
        expect(outcome.ingredient.foodId).toBe('food_mine');
        expect(recipeCalls()).toEqual(['/api/v1/ingredients/by-food {"foodId":"food_mine"}']);
        expect(world.schemaFailures).toEqual([]);
    });

    it('binds the variant a catalog result names, and parses the bound variant back', async () => {
        world.catalog = {
            status: 200,
            body: {
                results: [
                    {
                        id: 'food_brisket',
                        name: 'beef brisket',
                        score: 1,
                        variant: { id: 'variant_flat', parts: [{ attribute: 'cut', text: 'flat' }] },
                    },
                ],
            },
        };

        const outcome = await resolveIngredientLikeAUser(ports(), 'brisket flat');

        expect(outcome.kind).toBe('catalog_suggestion');
        expect(outcome.ingredient.variant?.id).toBe('variant_flat');
        expect(recipeCalls()).toEqual(['/api/v1/ingredients/by-food-variant {"foodVariantId":"variant_flat"}']);
        expect(world.schemaFailures).toEqual([]);
    });

    it('adds by name when neither search offers a food', async () => {
        const outcome = await resolveIngredientLikeAUser(ports(), 'sour grass');

        expect(outcome).toMatchObject({ kind: 'added_by_name', catalogAvailability: 'ok', authoredAvailability: 'ok' });
        expect(outcome.ingredient.foodResolutionStatus).toBe('PENDING');
        expect(recipeCalls()).toEqual(['/api/v1/ingredients/by-name {"name":"sour grass"}']);
        expect(world.schemaFailures).toEqual([]);
    });
});

describe('a failed search, as food itself refuses one', () => {
    const refusals: readonly { readonly scenario: string; readonly answer: RouteAnswer<never> }[] = [
        {
            scenario: 'food answered busy (503)',
            answer: {
                status: 503,
                body: { code: 'FETCH_UNAVAILABLE', message: 'busy', details: { retryAfterSeconds: 5 } },
                retryAfter: '5',
            },
        },
        {
            scenario: 'the per-minute search limit (429)',
            answer: {
                status: 429,
                body: { code: 'SEARCH_RATE_LIMITED', message: 'slow down', details: { retryAfterSeconds: 30 } },
                retryAfter: '30',
            },
        },
    ];

    it.each(refusals)(
        'reports the catalog unavailable when $scenario, and binds the curator’s own food',
        async ({ answer }) => {
            world.authored = { status: 200, body: { results: [{ id: 'food_mine', name: 'my butter', score: 1 }] } };
            world.catalog = answer;

            const outcome = await resolveIngredientLikeAUser(ports(), 'butter');

            expect(outcome).toMatchObject({
                kind: 'authored_suggestion',
                catalogAvailability: 'unavailable',
                authoredAvailability: 'ok',
            });
            expect(recipeCalls()).toEqual(['/api/v1/ingredients/by-food {"foodId":"food_mine"}']);
        },
    );

    it.each(refusals)(
        'reports the curator’s foods unavailable when $scenario, and still adds by name',
        async ({ answer }) => {
            world.authored = answer;

            const outcome = await resolveIngredientLikeAUser(ports(), 'butter');

            expect(outcome).toMatchObject({
                kind: 'added_by_name',
                catalogAvailability: 'ok',
                authoredAvailability: 'unavailable',
            });
        },
    );
});
