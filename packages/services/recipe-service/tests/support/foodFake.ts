/**
 * An in-process stand-in for food-service, for recipe-service's LOCAL e2e suites (plan 002).
 *
 * It serves the routes recipe-service calls — names for bound foods (`refs/resolve`), nutrition, add-by-name,
 * the status poll — from an in-memory table a suite fills. Every answer is PARSED through food's published schemas
 * (`@kitchensink/schema-food`) before it is sent, so the fake cannot drift from the real contract: a fake that
 * answered a shape food never sends would prove nothing about the service that reads it.
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
    resolveFoodRefsRequestSchema,
    resolveFoodRefsResponseSchema,
    searchResponseSchema,
    statusResponseSchema,
    type FoodRefEntry,
    type FoodStatus,
} from '@kitchensink/schema-food';

/** One food the fake holds. */
export interface FakeFood {
    readonly name: string | null;
    readonly status: FoodStatus;
    /** The author of a private authored food; absent for a shared catalog food. */
    readonly ownerId?: string;
    /** Energy, kcal per 100 g. */
    readonly caloriesPer100g?: number;
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

                    const food = ref.kind === 'root' ? foods.get(ref.id) : undefined;

                    entries.push(
                        readable(food, callerId)
                            ? {
                                  outcome: 'found',
                                  ref,
                                  name: food.name,
                                  status: food.status,
                                  ...(food.ownerId === undefined ? {} : { visibility: 'private' as const }),
                              }
                            : { outcome: 'absent', ref },
                    );
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
                            const food = foods.get(id);

                            return {
                                id,
                                status: food?.status ?? 'RESOLVED',
                                ...(food?.caloriesPer100g === undefined
                                    ? {}
                                    : { caloriesPer100g: food.caloriesPer100g }),
                                portions: [],
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
                const results = [...foods.entries()].flatMap(([id, food]) =>
                    readable(food, callerId) && food.name !== null && food.name.toLowerCase().includes(query)
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

                send(200, searchResponseSchema.parse({ results }));

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
