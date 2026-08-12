/**
 * THE LOCKSTEP TEST — the REAL exception filter's output driven through the REAL
 * `@kitchensink/food-service-client`, in one process, with nothing hand-shaped in between.
 *
 * ── WHY THIS TIER EXISTS, AND WHAT IT CATCHES THAT NOTHING ELSE DOES ──
 *
 * Converging this service's three error shapes into one was a change with two halves, and the halves live in
 * different packages:
 *
 *  - the SERVER stopped emitting `{ error, …extras }` / `{ statusCode, message, error }` and now emits only
 *    `{ code, message, details? }`;
 *  - the CLIENT stopped reading `body.status` on a `404` and stopped selecting `CandidateMismatchError` with
 *    `/candidate/i.test(body.error)`, and now discriminates on the published `code`.
 *
 * Move only one half and **`typecheck` says nothing**. The two sides exchange JSON at runtime, and every
 * per-package test asserts its own side's belief about that JSON: the filter suite asserts the body it writes,
 * the client suite asserts the body it is handed by a `stubFetch` literal *in the client's own repo*. A body
 * literal in a client test is exactly the second, independently-authored representation of the contract that
 * `docs/CODING_STANDARDS.md` §15.1 exists to eliminate — it agrees with the server by the test author's memory.
 *
 * So these cases produce the body with `ApiExceptionFilter` and consume it with `FoodServiceClient`. Break either
 * side and a case here fails naming the outcome that changed. It runs in the DEFAULT unit tier deliberately: no
 * database, no network, no Docker — a gate that needs a container is a gate that gets skipped, and this is the
 * only place the two halves meet before an e2e run against a live deployment.
 *
 * (`@kitchensink/food-service-client` is already a devDependency of this service, for `tests/e2e`. The
 * client → schema → service → client cycle that implies is why the turbo edge is `inputs` and not `dependsOn`;
 * see §15.2.5.)
 *
 * DESIGN PATTERN: Test-double as a REPLAY channel. {@link throughTheWire} is the seam — the filter's captured
 * `(status, body, headers)` triple is replayed verbatim as a `fetch` response, so the client sees bytes the
 * server actually produced rather than bytes a test author typed.
 */
import { HttpStatus, UnauthorizedException, type ArgumentsHost } from '@nestjs/common';
import {
    CandidateMismatchError as ClientCandidateMismatchError,
    ConflictError,
    FetchUnavailableError as ClientFetchUnavailableError,
    ForbiddenError,
    FoodServiceClient,
    NotFoundError as ClientNotFoundError,
    UnauthorizedError,
    UnexpectedResponseError,
    resetContractSkewLatchForTests,
} from '@kitchensink/food-service-client';
import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    CandidateMismatchError,
    FetchUnavailableError,
    FoodNotFoundError,
    FoodPendingError,
    NotResolvableError,
} from '../../foods/foods.errors.js';
import { foodErrorCodeSchema, foodErrorSchema } from '../../foods/foods.schema.js';
import type { WorkerLogger } from '../../worker/worker-logger.js';
import { apiError } from '../api-error.js';
import { apiErrorSchema } from '../api-error.schema.js';
import { ApiExceptionFilter } from '../filters/api-exception.filter.js';

const BASE = 'https://food.example.test';
const FOOD_ID = '01J9ZZZZZZZZZZZZZZZZZZZZZZ';
const CODE = foodErrorCodeSchema.enum;

/** A silent logger: this suite is about the wire, and the log policy is pinned by the filter's own suite. */
const silent: WorkerLogger = { info: () => {}, warn: () => {}, error: () => {} };

/** What the filter actually put on the wire. */
interface WireResponse {
    status: number;
    body: unknown;
    headers: Record<string, string>;
}

/**
 * Run a throwable through the REAL filter and capture the HTTP response it wrote.
 *
 * @param throwable - The value a handler threw.
 * @returns The status, JSON body, and headers the filter emitted.
 * @sideEffect None observable — the "response" is a recorder.
 */
function throughTheFilter(throwable: unknown): WireResponse {
    const captured: WireResponse = { status: 0, body: undefined, headers: {} };
    const res = {
        status(code: number): Response {
            captured.status = code;

            return res as unknown as Response;
        },
        json(body: unknown): Response {
            captured.body = body;

            return res as unknown as Response;
        },
        setHeader(name: string, value: string): Response {
            captured.headers[name.toLowerCase()] = value;

            return res as unknown as Response;
        },
    };
    const request = { method: 'GET', originalUrl: '/api/v1/foods/x', url: '/api/v1/foods/x', headers: {} };
    const host = {
        switchToHttp: () => ({
            getResponse: <T>() => res as unknown as T,
            getRequest: <T>() => request as unknown as Request as T,
        }),
    } as unknown as ArgumentsHost;

    new ApiExceptionFilter(silent).catch(throwable, host);

    return captured;
}

/**
 * Replay a captured wire response to the REAL client and return whatever typed error it threw.
 *
 * @param wire - The response the filter produced (replayed byte-for-byte, headers included).
 * @param call - The client method under test.
 * @returns The error the client threw.
 * @sideEffect Constructs a client whose `fetch` is a double; issues no real request.
 */
async function replayToClient(wire: WireResponse, call: (client: FoodServiceClient) => Promise<unknown>) {
    const body = wire.body === undefined ? undefined : JSON.stringify(wire.body);
    const fetchDouble = vi.fn(async () => new Response(body, { status: wire.status, headers: wire.headers }));
    const client = new FoodServiceClient({
        baseUrl: BASE,
        token: 'tok',
        fetch: fetchDouble as unknown as typeof fetch,
    });

    try {
        await call(client);
    } catch (error) {
        return error;
    }

    return expect.unreachable('the client resolved a response the service sent as a failure');
}

/**
 * Filter → wire → client, in one call: the whole point of this file.
 *
 * @param throwable - What the service threw.
 * @param call - How the client asked for it.
 * @returns The wire response AND the typed error the client produced from it.
 */
async function throughTheWire(throwable: unknown, call: (client: FoodServiceClient) => Promise<unknown>) {
    const wire = throughTheFilter(throwable);

    return { wire, error: await replayToClient(wire, call) };
}

beforeEach(() => {
    // Each request also fires the fire-and-forget `/health` skew probe (§15.2.5), latched once per origin per
    // process. Clearing it keeps these cases order-independent.
    resetContractSkewLatchForTests();
});

describe('the food error contract, end to end through both halves', () => {
    it('404 → NotFoundError carrying the TERMINAL STATUS, read from details.status', async () => {
        const { wire, error } = await throughTheWire(new FoodNotFoundError(FOOD_ID, 'FAILED'), (client) =>
            client.getStatus(FOOD_ID),
        );

        expect(wire.status).toBe(HttpStatus.NOT_FOUND);
        expect(error).toBeInstanceOf(ClientNotFoundError);
        // The lockstep assertion. The status used to be a TOP-LEVEL `body.status` in the legacy controller shape
        // and the client read it from there; it now lives in `details.status`. Move one side only and this fails.
        expect((error as ClientNotFoundError).foodStatus).toBe('FAILED');
        expect((error as ClientNotFoundError).id).toBe(FOOD_ID);
    });

    it('404 with NO row → NotFoundError with no food status (absent, not invented)', async () => {
        const { error } = await throughTheWire(new FoodNotFoundError(FOOD_ID), (client) => client.getStatus(FOOD_ID));

        expect((error as ClientNotFoundError).foodStatus).toBeUndefined();
    });

    /**
     * THE 409 PAIR — the case the whole convergence turns on.
     *
     * Both are `409`s, so the STATUS cannot separate them, and their meanings are genuinely different: "the
     * candidate you picked is not in this food's set" (fix the pick) versus "this food is not awaiting
     * disambiguation at all" (stop resolving, re-read the status). The old client separated them with
     * `/candidate/i.test(body.error)`.
     */
    describe('the two 409s stay distinguishable', () => {
        it('CandidateMismatchError → the client CandidateMismatchError (DSN-14)', async () => {
            const { wire, error } = await throughTheWire(new CandidateMismatchError(FOOD_ID), (client) =>
                client.resolve(FOOD_ID, ['cand_1']),
            );

            expect(wire.status).toBe(HttpStatus.CONFLICT);
            expect((wire.body as { code: string }).code).toBe(CODE.CANDIDATE_MISMATCH);
            expect(error).toBeInstanceOf(ClientCandidateMismatchError);
            expect((error as ClientCandidateMismatchError).id).toBe(FOOD_ID);
        });

        it('NotResolvableError → a plain ConflictError, NOT a CandidateMismatchError', async () => {
            const { wire, error } = await throughTheWire(new NotResolvableError(FOOD_ID, 'RESOLVED'), (client) =>
                client.resolve(FOOD_ID, ['cand_1']),
            );

            expect(wire.status).toBe(HttpStatus.CONFLICT);
            expect((wire.body as { code: string }).code).toBe(CODE.NOT_RESOLVABLE);
            expect(error).toBeInstanceOf(ConflictError);
            expect(error).not.toBeInstanceOf(ClientCandidateMismatchError);
        });

        /**
         * ⛔ THE ANTI-REGRESSION CASE. Reword both messages into prose that a `/candidate/i` regex reads
         * BACKWARDS — the mismatch body loses the word, the not-resolvable body gains it — and assert the
         * discrimination is unmoved.
         *
         * Under the old implementation this test fails twice over: the mismatch becomes a `ConflictError` and the
         * lifecycle conflict becomes a `CandidateMismatchError`. It is the executable form of "a regex over
         * human-readable prose is not a discriminant", and it is why the message is safe to edit for clarity or
         * for a copy review.
         */
        it('survives a full rewording of both messages, in both directions', async () => {
            const mismatch = throughTheFilter(new CandidateMismatchError(FOOD_ID));
            const notResolvable = throughTheFilter(new NotResolvableError(FOOD_ID, 'RESOLVED'));

            const reworded = (wire: WireResponse, message: string): WireResponse => ({
                ...wire,
                body: { ...(wire.body as Record<string, unknown>), message },
            });

            const mismatchError = await replayToClient(
                reworded(mismatch, 'That selection does not belong to this ingredient'),
                (client) => client.resolve(FOOD_ID, ['c']),
            );
            const conflictError = await replayToClient(
                reworded(notResolvable, 'This ingredient has no candidate list to choose from'),
                (client) => client.resolve(FOOD_ID, ['c']),
            );

            expect(mismatchError).toBeInstanceOf(ClientCandidateMismatchError);
            expect(conflictError).toBeInstanceOf(ConflictError);
            expect(conflictError).not.toBeInstanceOf(ClientCandidateMismatchError);
        });
    });

    it('503 → FetchUnavailableError with the Retry-After the FILTER set on the response', async () => {
        const { wire, error } = await throughTheWire(new FetchUnavailableError(45), (client) =>
            client.addByName('Broccoli'),
        );

        expect(wire.status).toBe(HttpStatus.SERVICE_UNAVAILABLE);
        // The header is the contract; the body repeats it. Both come from the one place that publishes them.
        expect(wire.headers['retry-after']).toBe('45');
        expect(error).toBeInstanceOf(ClientFetchUnavailableError);
        expect((error as ClientFetchUnavailableError).retryAfterSeconds).toBe(45);
    });

    it('a coded 400 raised through apiError → BadRequestError carrying the message', async () => {
        const { wire, error } = await throughTheWire(
            apiError(CODE.BATCH_TOO_LARGE, 'At most 100 names per batch', { maxNames: 100 }),
            (client) => client.batch(['a', 'b']),
        );

        expect(wire.status).toBe(HttpStatus.BAD_REQUEST);
        expect((wire.body as { details: unknown }).details).toEqual({ maxNames: 100 });
        expect((error as Error).message).toBe('At most 100 names per batch');
        expect((error as { status?: number }).status).toBe(HttpStatus.BAD_REQUEST);
    });

    it('a coded 403 → ForbiddenError', async () => {
        const { error } = await throughTheWire(
            apiError(CODE.FORBIDDEN, 'Operation requires elevated scope'),
            (client) => client.search('kale'),
        );

        expect(error).toBeInstanceOf(ForbiddenError);
        expect((error as Error).message).toBe('Operation requires elevated scope');
    });

    it("the auth guard's STRING-bodied 401 → UnauthorizedError with the guard's own message", async () => {
        // `FoodAuthGuard` throws `new UnauthorizedException('…')`. Nest renders that as
        // `{ statusCode, message, error }` — legacy shape #2 — and the filter normalizes it. Nothing in the guard
        // changed; the guarantee is the filter's.
        const { wire, error } = await throughTheWire(
            new UnauthorizedException('Valid Clerk session or M2M token required'),
            (client) => client.search('kale'),
        );

        expect(wire.body).toEqual({ code: CODE.UNAUTHORIZED, message: 'Valid Clerk session or M2M token required' });
        expect(error).toBeInstanceOf(UnauthorizedError);
        expect((error as Error).message).toBe('Valid Clerk session or M2M token required');
    });

    it('IDENTITY_SYNC_PENDING stays its own code while still mapping to UnauthorizedError (CR-002/U1)', async () => {
        const { wire, error } = await throughTheWire(
            apiError(CODE.IDENTITY_SYNC_PENDING, 'Retry with a refreshed token'),
            (client) => client.addByName('Broccoli'),
        );

        // Two different 401s. A status-derived code would have flattened them, and the caller's correct action
        // differs: refresh the token and retry, versus sign in.
        expect((wire.body as { code: string }).code).toBe(CODE.IDENTITY_SYNC_PENDING);
        expect(error).toBeInstanceOf(UnauthorizedError);
    });

    it('an unmapped throwable → a 500 the client surfaces as UnexpectedResponseError, leaking nothing', async () => {
        const { wire, error } = await throughTheWire(
            new Error('connect ECONNREFUSED 10.0.3.14:5432 — password=hunter2'),
            (client) => client.search('kale'),
        );

        expect(wire.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
        expect(JSON.stringify(wire.body)).not.toContain('hunter2');
        expect(error).toBeInstanceOf(UnexpectedResponseError);
    });

    it('a 202 FOOD_PENDING escaping a non-read route is surfaced, not silently treated as success', async () => {
        // `getStatus` promises a terminal answer. A `202` there means the service is in a state this method
        // cannot represent, and the honest outcome is a loud unexpected-response error.
        const { wire, error } = await throughTheWire(new FoodPendingError(FOOD_ID, 'UNRESOLVED'), (client) =>
            client.getStatus(FOOD_ID),
        );

        expect(wire.status).toBe(HttpStatus.ACCEPTED);
        expect(error).toBeInstanceOf(UnexpectedResponseError);
    });

    /**
     * ONE SHAPE, asserted over the whole population rather than case by case — including with the PUBLISHED
     * schemas, so a body the service emits that the schema package cannot describe fails here.
     */
    it('emits exactly one body shape, and every domain body narrows through the published typed union', async () => {
        const domainThrowables: unknown[] = [
            new FoodNotFoundError(FOOD_ID, 'NOT_FOUND'),
            new FoodNotFoundError(FOOD_ID),
            new CandidateMismatchError(FOOD_ID),
            new NotResolvableError(FOOD_ID, 'PENDING'),
            new FetchUnavailableError(30),
            new FoodPendingError(FOOD_ID, 'PENDING', 15),
            apiError(CODE.INVALID_ID, 'bad id'),
            apiError(CODE.BATCH_TOO_LARGE, 'too many', { maxNames: 100 }),
            apiError(CODE.FORBIDDEN, 'nope'),
            apiError(CODE.IDENTITY_SYNC_PENDING, 'refresh'),
            new Error('boom'),
        ];

        for (const throwable of domainThrowables) {
            const wire = throughTheFilter(throwable);

            expect(apiErrorSchema.safeParse(wire.body).success, `envelope: ${String(throwable)}`).toBe(true);
            // The typed narrowing a consumer relies on. `safeParse` failing here means the service emitted a
            // published code with `details` its own contract does not describe.
            expect(foodErrorSchema.safeParse(wire.body).success, `typed union: ${String(throwable)}`).toBe(true);
        }
    });
});
