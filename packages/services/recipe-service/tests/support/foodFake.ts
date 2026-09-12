/**
 * An in-process stand-in for food-service, for recipe-service's LOCAL e2e suites (plan 002).
 *
 * It serves the routes recipe-service calls — names for bound foods (`refs/resolve`), nutrition, add-by-name,
 * the status poll, a root's read with its live variants — from an in-memory table a suite fills. Every answer is
 * PARSED through food's published schemas (`@kitchensink/schema-food`) before it is sent, so the fake cannot drift
 * from the real contract: a fake that answered a shape food never sends would prove nothing about the service that
 * reads it.
 *
 * Curated U9: an entry with `variantOf` is a VARIANT of that root; `forwardedTo` makes an entry retired and forwarded
 * (one hop, as a suite needs); `retired` with no forward is a seed removal with no successor, which still answers for
 * itself (R29, owner 2026-10-01). Ids are one namespace, so the nutrition batch ignores kind, as food's does. Search
 * answers a root with its variant when the query names exactly one live variant (R15, R16).
 *
 * Callers are identified by their bearer, which recipe-service forwards unchanged: a suite sends
 * `Authorization: Bearer <app-user id>` (see {@link bearerFor}), and the fake reads that id as the caller. Food
 * shows a private food to its author only, and answers every other caller exactly as it answers an unknown id.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import {
    addResponseSchema,
    foodNutritionBatchResponseSchema,
    foodResponseSchema,
    pendingResponseSchema,
    resolveFoodRefsRequestSchema,
    resolveFoodRefsResponseSchema,
    searchResponseSchema,
    statusResponseSchema,
    type FoodRef,
    type FoodRefEntry,
    type FoodStatus,
    type VariantPartView,
} from '@kitchensink/schema-food';

/** One food the fake holds: a root, or — with {@link FakeFood.variantOf} — a variant of one. */
export interface FakeFood {
    /** A root's name. A variant's own `name` is unused: food names a variant by its root. */
    readonly name: string | null;
    readonly status: FoodStatus;
    /** The author of a private authored food; absent for a shared catalog food. */
    readonly ownerId?: string;
    /** Energy, kcal per 100 g. */
    readonly caloriesPer100g?: number;
    /** Present for a VARIANT: its root's id and its label's parts. */
    readonly variantOf?: { readonly rootId: string; readonly parts: readonly VariantPartView[] };
    /** A retired entry forwarded to another, as the seed forwards one it removes with a successor. */
    readonly forwardedTo?: FoodRef;
    /** A retired entry: absent from its root's live variants and from search, but it still answers (R29). */
    readonly retired?: boolean;
}

/** One request the fake received. */
export interface FakeFoodRequest {
    readonly method: string;
    readonly path: string;
    /** The caller the bearer named, or `undefined` for a request with none. */
    readonly callerId: string | undefined;
}

/** A running fake, and the knobs a suite turns. */
export interface FoodFake {
    /** The origin to set as `FOOD_SERVICE_URL`. */
    readonly origin: string;
    /** The foods the fake holds, by id. */
    readonly foods: Map<string, FakeFood>;
    /**
     * What add-by-name answers for a name, by lower-cased name: the food's id, under that food's own status. An
     * unlisted name answers `NOT_FOUND`.
     */
    readonly names: Map<string, string>;
    /** Every request received, in order. */
    readonly requests: FakeFoodRequest[];
    /** While `true`, every food route answers `503`, standing in for a food service that is down. */
    down: boolean;
    /** Stop the server. */
    close(): Promise<void>;
}

/**
 * The `Authorization` header a suite sends to act as `userId`. Recipe-service forwards it to food unchanged.
 *
 * @param userId - The app-user id.
 * @returns The header value. Pure.
 */
export function bearerFor(userId: string): string {
    return `Bearer ${userId}`;
}

/** The caller a forwarded bearer names. */
function callerOf(req: IncomingMessage): string | undefined {
    const header = req.headers['authorization'];

    return typeof header === 'string' && header.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
}

/** Read and JSON-parse a request body. */
async function bodyOf(req: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];

    for await (const chunk of req) {
        chunks.push(chunk as Buffer);
    }

    return chunks.length === 0 ? undefined : JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** Whether `callerId` may read `food`: a shared food, or the caller's own. */
function readable(food: FakeFood | undefined, callerId: string | undefined): food is FakeFood {
    return food !== undefined && (food.ownerId === undefined || food.ownerId === callerId);
}

/** The entry the fake holds under `ref`, of the ref's own kind. */
function entryOf(foods: ReadonlyMap<string, FakeFood>, ref: FoodRef): FakeFood | undefined {
    const food = foods.get(ref.id);

    return food !== undefined && (food.variantOf === undefined) === (ref.kind === 'root') ? food : undefined;
}

/**
 * Food's refs answer for one ref: the entry its one forward ends at, named by its root and authorized on its root.
 *
 * @returns The published entry.
 */
function refEntryOf(foods: ReadonlyMap<string, FakeFood>, ref: FoodRef, callerId: string | undefined): FoodRefEntry {
    const absent: FoodRefEntry = { outcome: 'absent', ref: { kind: ref.kind, id: ref.id } };
    const own = entryOf(foods, ref);
    const target = own?.forwardedTo ?? ref;
    const end = own === undefined ? undefined : entryOf(foods, target);
    const root = end?.variantOf === undefined ? end : foods.get(end.variantOf.rootId);

    if (end === undefined || !readable(root, callerId)) {
        return absent;
    }

    return {
        outcome: 'found',
        ref: { kind: ref.kind, id: ref.id },
        name: root.name,
        status: root.status,
        ...(root.ownerId === undefined ? {} : { visibility: 'private' as const }),
        ...(end.variantOf === undefined
            ? {}
            : { variant: { rootId: end.variantOf.rootId, parts: [...end.variantOf.parts] } }),
        ...(own?.forwardedTo === undefined ? {} : { forwardedTo: own.forwardedTo }),
    };
}

/**
 * Start a fake on an ephemeral port.
 *
 * @returns The running fake.
 * @sideEffect Opens an HTTP listener.
 */
export async function startFoodFake(): Promise<FoodFake> {
    const foods = new Map<string, FakeFood>();
    const names = new Map<string, string>();
    const requests: FakeFoodRequest[] = [];
    let pendingCount = 0;

    const fake = {
        origin: '',
        foods,
        names,
        requests,
        down: false,
        close: async (): Promise<void> => undefined,
    } satisfies FoodFake as FoodFake;

    const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
        void (async () => {
            const url = new URL(req.url ?? '/', 'http://food-fake');
            const path = url.pathname;
            const callerId = callerOf(req);

            const send = (status: number, body: unknown): void => {
                res.writeHead(status, { 'content-type': 'application/json' });
                res.end(JSON.stringify(body));
            };

            requests.push({ method: req.method ?? 'GET', path, callerId });

            if (path === '/health') {
                send(200, { status: 'ok', service: 'food' });

                return;
            }

            if (fake.down) {
                send(503, { code: 'NOT_READY', message: 'food fake is down' });

                return;
            }

            if (req.method === 'POST' && path === '/api/v1/foods/refs/resolve') {
                const { refs } = resolveFoodRefsRequestSchema.parse(await bodyOf(req));
                const seen = new Set<string>();
                const entries: FoodRefEntry[] = [];

                for (const ref of refs) {
                    const key = `${ref.kind}:${ref.id}`;

                    if (seen.has(key)) {
                        continue;
                    }

                    seen.add(key);
                    entries.push(refEntryOf(foods, ref, callerId));
                }

                send(200, resolveFoodRefsResponseSchema.parse({ entries }));

                return;
            }

            if (
                req.method === 'GET' &&
                (path === '/api/v1/foods/nutrition' || path === '/api/v1/foods/authored-nutrition')
            ) {
                const ids = (url.searchParams.get('ids') ?? '').split(',').filter((id) => id.length > 0);
                const ownOnly = path.endsWith('authored-nutrition');
                const known = ids.filter((id) => {
                    const food = foods.get(id);

                    return ownOnly
                        ? food?.ownerId !== undefined && food.ownerId === callerId
                        : food?.ownerId === undefined && food !== undefined;
                });

                send(
                    200,
                    foodNutritionBatchResponseSchema.parse({
                        foods: known.map((id) => {
                            // A forwarded id answers its target's numbers under the requested id, as food's does.
                            const own = foods.get(id);
                            const food = own?.forwardedTo === undefined ? own : foods.get(own.forwardedTo.id);
                            const liveVariants = [...foods.values()].some(
                                (other) => other.variantOf?.rootId === id && other.retired !== true,
                            );

                            return {
                                id,
                                status: food?.status ?? 'RESOLVED',
                                ...(food?.caloriesPer100g === undefined
                                    ? {}
                                    : { caloriesPer100g: food.caloriesPer100g }),
                                portions: [],
                                ...(ownOnly || food?.variantOf !== undefined ? {} : { hasLiveVariants: liveVariants }),
                            };
                        }),
                        unknownIds: ids.filter((id) => !known.includes(id)),
                    }),
                );

                return;
            }

            if (req.method === 'POST' && path === '/api/v1/foods') {
                const body = (await bodyOf(req)) as { name?: string } | undefined;
                const foodId = names.get((body?.name ?? '').toLowerCase());

                if (foodId !== undefined) {
                    // The food's own status: a name food is still working on answers `PENDING`, which leaves the
                    // recipe side waiting on its source. A catalog add never answers `WITHDRAWN`.
                    const status = foods.get(foodId)?.status ?? 'RESOLVED';

                    send(
                        202,
                        addResponseSchema.parse({ id: foodId, status: status === 'WITHDRAWN' ? 'NOT_FOUND' : status }),
                    );

                    return;
                }

                pendingCount += 1;
                send(202, addResponseSchema.parse({ id: `food-fake-unknown-${pendingCount}`, status: 'NOT_FOUND' }));

                return;
            }

            const byId = /^\/api\/v1\/foods\/([^/]+)$/.exec(path);

            if (req.method === 'GET' && byId !== null && !['search', 'nutrition'].includes(byId[1] ?? '')) {
                // The ROOT read (`GET /{id}`): 200 with its live variants, 202 while pending, 404 otherwise.
                const id = decodeURIComponent(byId[1] ?? '');
                const food = foods.get(id);

                if (!readable(food, callerId) || food.variantOf !== undefined) {
                    send(404, { code: 'FOOD_NOT_FOUND', message: 'not found', details: { id } });

                    return;
                }

                if (food.status === 'PENDING' || food.status === 'UNRESOLVED') {
                    send(202, pendingResponseSchema.parse({ id, status: food.status }));

                    return;
                }

                send(
                    200,
                    foodResponseSchema.parse({
                        id,
                        name: food.name,
                        description: null,
                        kind: 'generic',
                        status: food.status,
                        nutrients: [],
                        portions: [],
                        provenance: {},
                        variants: [...foods.entries()].flatMap(([variantId, variant]) =>
                            variant.variantOf?.rootId === id && variant.retired !== true
                                ? [
                                      {
                                          id: variantId,
                                          parts: [...variant.variantOf.parts],
                                          ...(variant.caloriesPer100g === undefined
                                              ? {}
                                              : { caloriesPer100g: variant.caloriesPer100g }),
                                      },
                                  ]
                                : [],
                        ),
                    }),
                );

                return;
            }

            const status = /^\/api\/v1\/foods\/([^/]+)\/status$/.exec(path);

            if (req.method === 'GET' && status !== null) {
                const id = decodeURIComponent(status[1] ?? '');
                const food = foods.get(id);

                if (!readable(food, callerId)) {
                    send(404, { code: 'FOOD_NOT_FOUND', message: 'not found' });

                    return;
                }

                send(200, statusResponseSchema.parse({ id, status: food.status }));

                return;
            }

            if (req.method === 'GET' && path === '/api/v1/foods/search') {
                // A name match over the foods the caller may read, standing in for food's ranked search: a
                // stranger never receives another cook's authored food, as on the real route.
                const query = (url.searchParams.get('query') ?? '').toLowerCase();
                // R15/R16: a query that contains a root's name and names exactly ONE of its live variants (every
                // part's words) answers that root with the variant, ranked first, as food's ranked search does.
                const variantHits = [...foods.entries()].flatMap(([id, food]) => {
                    if (
                        !readable(food, callerId) ||
                        food.variantOf !== undefined ||
                        food.retired === true ||
                        food.name === null ||
                        !query.includes(food.name.toLowerCase())
                    ) {
                        return [];
                    }

                    const named = [...foods.entries()].filter(
                        ([, variant]) =>
                            variant.variantOf?.rootId === id &&
                            variant.retired !== true &&
                            variant.variantOf.parts.every((part) => query.includes(part.text.toLowerCase())),
                    );
                    const [only] = named;

                    return named.length === 1 && only?.[1].variantOf !== undefined
                        ? [
                              {
                                  id,
                                  name: food.name,
                                  score: 0.9,
                                  variant: { id: only[0], parts: [...only[1].variantOf.parts] },
                              },
                          ]
                        : [];
                });
                const plainHits = [...foods.entries()].flatMap(([id, food]) =>
                    readable(food, callerId) &&
                    food.variantOf === undefined &&
                    food.retired !== true &&
                    food.name !== null &&
                    food.name.toLowerCase().includes(query)
                        ? [
                              {
                                  id,
                                  name: food.name,
                                  score: 0.5,
                                  ...(food.ownerId === undefined ? {} : { visibility: 'private' as const }),
                              },
                          ]
                        : [],
                );

                send(200, searchResponseSchema.parse({ results: [...variantHits, ...plainHits] }));

                return;
            }

            send(404, { code: 'NOT_FOUND', message: `the food fake does not serve ${req.method} ${path}` });
        })().catch((error: unknown) => {
            res.writeHead(500, { 'content-type': 'application/json' });
            res.end(
                JSON.stringify({
                    code: 'FAKE_FAILED',
                    message: error instanceof Error ? error.message : String(error),
                }),
            );
        });
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

    const { port } = server.address() as AddressInfo;

    Object.assign(fake, {
        origin: `http://127.0.0.1:${port}`,
        close: () =>
            new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
    });

    return fake;
}
