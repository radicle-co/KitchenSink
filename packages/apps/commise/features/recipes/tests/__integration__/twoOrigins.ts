/**
 * The integration tier's two origins: a real `RecipeServiceClient` and a real `FoodServiceClient`, each over a `fetch`
 * double that answers from a route the test gives and records every request (owner ruling 2026-09-20: integration
 * tests mock their dependencies). Since plan 002 S5 the apps call both: recipe for the line, food for the search, which
 * since S7.8 is the ONE progressive answer.
 *
 * A route may answer {@link HANG}: the request then never answers, and fails only when its signal aborts it, as a
 * request the browser gave up on does.
 */
import { FoodServiceClient } from '@kitchensink/food-service-client';
import { RecipeServiceClient } from '@kitchensink/recipe-service-client';

/** Which service a request went to. */
export type Origin = 'recipe' | 'food';

/** One request the double received. */
export interface RecordedRequest {
    readonly origin: Origin;
    readonly method: string;
    readonly path: string;
    readonly query: URLSearchParams;
    readonly body: unknown;
}

/** A request that never answers until its signal aborts it. */
export const HANG = Symbol('hang');

/** A route's answer: a response, or {@link HANG}. A route that throws is a transport failure. */
export type RouteAnswer = Response | typeof HANG;

/** Answers one request. */
export type Route = (request: RecordedRequest) => RouteAnswer | Promise<RouteAnswer>;

/** A JSON response. */
export const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const RECIPE_ORIGIN = 'https://recipes.test';
const FOOD_ORIGIN = 'https://food.test';

/**
 * The two clients and what they sent.
 *
 * @param routes - How each origin answers. A request to an origin with no route answers `404`.
 * @returns The clients and the recorded requests, in the order they were sent.
 */
export function twoOrigins(routes: { readonly recipe?: Route; readonly food?: Route }) {
    const requests: RecordedRequest[] = [];

    const fetchFor =
        (origin: Origin, route: Route | undefined) =>
        async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
            const request = input instanceof Request ? input : new Request(input, init);
            const url = new URL(request.url);

            // The clients' contract-skew probes and the analytics transport: not what these suites are about.
            if (url.pathname === '/health' || url.pathname.startsWith('/ingest/')) {
                return json({});
            }

            // The source register every food list names a remote source by: it names none here.
            if (url.pathname === '/api/v1/foods/sources') {
                return json({ sources: [] });
            }

            const text = await request.text();
            const recorded: RecordedRequest = {
                origin,
                method: request.method,
                path: url.pathname,
                query: url.searchParams,
                body: text === '' ? undefined : JSON.parse(text),
            };

            requests.push(recorded);

            const answer =
                route === undefined ? json({ code: 'NOT_FOUND', message: 'no route' }, 404) : await route(recorded);

            if (answer !== HANG) {
                return answer;
            }

            const signal = init?.signal ?? request.signal;

            return new Promise<Response>((_resolve, reject) => {
                signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
            });
        };

    return {
        recipes: new RecipeServiceClient({
            baseUrl: RECIPE_ORIGIN,
            token: 'tok',
            fetch: fetchFor('recipe', routes.recipe),
        }),
        food: new FoodServiceClient({ baseUrl: FOOD_ORIGIN, token: 'tok', fetch: fetchFor('food', routes.food) }),
        requests,
        /** The requests sent to one origin. */
        sentTo: (origin: Origin) => requests.filter((each) => each.origin === origin),
    };
}

/**
 * A food route whose progressive search answers its database part from `answers`: each group as the split search would
 * answer it, a `200` with `{ results }` for an answered group, anything else for an unavailable one, then `complete`
 * (ADR-0055 point 9). A {@link HANG} for either group hangs the whole answer. Any other path is `404`.
 */
export function foodSearches(answers: {
    readonly catalog: (query: string) => RouteAnswer;
    readonly authored: (query: string) => RouteAnswer;
}): Route {
    const groupOf = async (answer: RouteAnswer): Promise<unknown> => {
        if (answer === HANG) {
            return HANG;
        }

        if (!answer.ok) {
            return { outcome: 'unavailable' };
        }

        const body: unknown = await answer.json();

        return {
            outcome: 'answered',
            results: typeof body === 'object' && body !== null && 'results' in body ? body.results : [],
        };
    };

    return async (request) => {
        if (request.path !== '/api/v1/foods/search/progressive') {
            return json({ code: 'FOOD_NOT_FOUND', message: 'no such route', details: {} }, 404);
        }

        const query = request.query.get('query') ?? '';
        const catalog = await groupOf(answers.catalog(query));
        const authored = await groupOf(answers.authored(query));

        return catalog === HANG || authored === HANG
            ? HANG
            : ndjson({ type: 'database', catalog, authored }, { type: 'complete' });
    };
}

/** An ND-JSON `200` whose body is `frames`, one per line, all in one chunk (ADR-0055 point 9). */
export const ndjson = (...frames: readonly unknown[]): Response =>
    new Response(frames.map((frame) => `${JSON.stringify(frame)}\n`).join(''), {
        status: 200,
        headers: { 'content-type': 'application/x-ndjson; charset=utf-8' },
    });

/** An ND-JSON `200` whose body stays open: the test writes each frame, and may never end it. */
export function openStream() {
    const encoder = new TextEncoder();
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    // A body the client cancelled takes no more writes, as a closed socket would carry none.
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
        start(streamController) {
            controller = streamController;
        },
        cancel() {
            cancelled = true;
        },
    });

    return {
        response: new Response(body, {
            status: 200,
            headers: { 'content-type': 'application/x-ndjson; charset=utf-8' },
        }),
        write: (frame: unknown): void => {
            if (!cancelled) {
                controller?.enqueue(encoder.encode(`${JSON.stringify(frame)}\n`));
            }
        },
        end: (): void => {
            if (!cancelled) {
                controller?.close();
            }
        },
    };
}

/**
 * A food route for the progressive search and the remote pick: `search` answers `GET /api/v1/foods/search/progressive`
 * by its query, `adopt` answers `POST /api/v1/foods/remote/adopt` by its reference, and anything else is `404`.
 */
export function foodProgressive(answers: {
    readonly search: (query: string) => RouteAnswer;
    readonly adopt?: (reference: string) => RouteAnswer;
}): Route {
    return (request) => {
        if (request.path === '/api/v1/foods/search/progressive') {
            return answers.search(request.query.get('query') ?? '');
        }

        if (request.path === '/api/v1/foods/remote/adopt' && answers.adopt !== undefined) {
            const body: unknown = request.body;
            const reference =
                typeof body === 'object' && body !== null && 'reference' in body && typeof body.reference === 'string'
                    ? body.reference
                    : '';

            return answers.adopt(reference);
        }

        return json({ code: 'FOOD_NOT_FOUND', message: 'no such route', details: {} }, 404);
    };
}
