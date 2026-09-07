/**
 * Unit tests for {@link ApiExceptionFilter} (food service, ARCH-PS-2). Pins the one consistent
 * `{ code, message, details? }` envelope shared with identity/recipe:
 *
 * - each food domain error → its mapped status + `{ code, message, details? }` (and `Retry-After` for
 *   `FetchUnavailableError`);
 * - **EVERY `HttpException` is NORMALIZED into the envelope — there is no passthrough.** This is the
 *   load-bearing case of the 2026-08-12 convergence: the filter used to return `exception.getResponse()`
 *   unchanged, which is how Nest's `{ statusCode, message, error }` and the controller's `{ error, …extras }`
 *   both reached the wire alongside the envelope. Because the guarantee lives HERE and not at the throw sites,
 *   it holds for exceptions this service does not raise itself — a bare string `401` from `FoodAuthGuard`, a
 *   framework `404` on an unrouted path, a `413` from the body parser.
 * - any other throwable collapses to a generic 500 whose body leaks no internal detail.
 *
 * **And that the failure is OBSERVABLE (T-151).** The filter used to log NOTHING, so a genuine 500 —
 * a `TypeError` in a DAO, say — reached the caller as an opaque `INTERNAL_ERROR` and left no line on the
 * container's stdout at all. The food API has no Sentry SDK and no log-drain subscription, so that stdout
 * line is the ONLY diagnostic channel there is: it is the fix, not a nicety. These specs pin the whole
 * policy — which statuses log at which level, what the record must carry, and above all what it must
 * NEVER carry (the `Authorization` header, a bearer token, the request body, the query string).
 */
import {
    BadRequestException,
    HttpException,
    HttpStatus,
    UnauthorizedException,
    type ArgumentsHost,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ZodValidationPipe } from 'nestjs-zod';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AddFoodBodyDto } from '../../../foods/dto/foods.dto.js';
import { IllegalStatusTransitionError } from '../../../foods/dao/dao.errors.js';
import {
    CandidateMismatchError,
    FetchUnavailableError,
    FoodNotFoundError,
    FoodPendingError,
    NotResolvableError,
} from '../../../foods/foods.errors.js';
import { foodErrorCodeSchema, foodErrorSchema } from '../../../foods/foods.schema.js';
import type { LogContext, WorkerLogger } from '../../../worker/workerLogger.js';
import { apiErrorSchema } from '../../apiError.schema.js';
import { ApiExceptionFilter } from '../apiException.filter.js';

/** The published codes, by name — the discriminant a consumer branches on. */
const FoodErrorCode = foodErrorCodeSchema.enum;

const VALID_ID = '01J9ZZZZZZZZZZZZZZZZZZZZZZ';

interface Captured {
    status?: number;
    body?: unknown;
    headers: Record<string, string>;
}

/** One captured structured log record: its level, event name, and context. */
interface CapturedLog {
    level: 'info' | 'warn' | 'error';
    message: string;
    context: LogContext;
}

/** A recording {@link WorkerLogger} — the seam the filter logs through. */
function makeLogger(): { logger: WorkerLogger; records: CapturedLog[] } {
    const records: CapturedLog[] = [];

    const record =
        (level: CapturedLog['level']) =>
        (message: string, context: LogContext = {}): void => {
            records.push({ level, message, context });
        };

    return { logger: { info: record('info'), warn: record('warn'), error: record('error') }, records };
}

/** Shape of the inbound request the filter is allowed to see. */
interface RequestOptions {
    method?: string;
    originalUrl?: string;
    headers?: Record<string, string | undefined>;
}

function makeHost(request: RequestOptions = {}): { host: ArgumentsHost; captured: Captured } {
    const captured: Captured = { headers: {} };
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
            captured.headers[name] = value;

            return res as unknown as Response;
        },
    };

    const req = {
        method: request.method ?? 'GET',
        originalUrl: request.originalUrl ?? '/api/v1/foods/search',
        url: request.originalUrl ?? '/api/v1/foods/search',
        headers: request.headers ?? {},
        // Present on a real Express request and deliberately NOT read by the filter: a leak of either
        // would put a caller's payload / bearer token on stdout.
        body: { secretName: 'hunter2' },
        query: { query: 'a-users-search-text' },
    } as unknown as Request;

    const host = {
        switchToHttp: () => ({ getResponse: <T>() => res as unknown as T, getRequest: <T>() => req as unknown as T }),
    } as unknown as ArgumentsHost;

    return { host, captured };
}

describe('ApiExceptionFilter (food)', () => {
    let records: CapturedLog[];
    let filter: ApiExceptionFilter;

    beforeEach(() => {
        const made = makeLogger();
        records = made.records;
        filter = new ApiExceptionFilter(made.logger);
    });

    it('maps FoodNotFoundError → 404 with a { code, message, details } envelope', () => {
        const { host, captured } = makeHost();

        filter.catch(new FoodNotFoundError(VALID_ID, 'NOT_FOUND'), host);

        expect(captured.status).toBe(HttpStatus.NOT_FOUND);
        expect(captured.body).toEqual({
            code: FoodErrorCode.FOOD_NOT_FOUND,
            message: 'No source has this food; tombstoned until TTL (default 30 days)',
            // `id` is in the body because the CONTROLLER used to put it there, in its own `{ error, id, status }`
            // shape. Converging the envelope must not lose information a consumer had.
            details: { id: VALID_ID, status: 'NOT_FOUND' },
        });
    });

    it('maps CandidateMismatchError / NotResolvableError → 409, distinguishable by code alone', () => {
        const a = makeHost();
        filter.catch(new CandidateMismatchError(VALID_ID), a.host);
        expect(a.captured.status).toBe(HttpStatus.CONFLICT);
        expect(a.captured.body).toEqual({
            code: FoodErrorCode.CANDIDATE_MISMATCH,
            message: `A picked candidate is not in food '${VALID_ID}' candidate set`,
            details: { id: VALID_ID },
        });

        const b = makeHost();
        filter.catch(new NotResolvableError(VALID_ID, 'PENDING'), b.host);
        expect(b.captured.status).toBe(HttpStatus.CONFLICT);
        expect(b.captured.body).toEqual({
            code: FoodErrorCode.NOT_RESOLVABLE,
            message: `Food '${VALID_ID}' is PENDING, not UNRESOLVED`,
            details: { id: VALID_ID, status: 'PENDING' },
        });

        // THE REGRESSION GUARD. Both are 409s; the status cannot tell them apart, and the old client told them
        // apart with `/candidate/i.test(body.error)`. The codes must differ, and each body must satisfy the
        // PUBLISHED typed union — otherwise a consumer is back to reading prose.
        expect((a.captured.body as { code: string }).code).not.toBe((b.captured.body as { code: string }).code);
        expect(foodErrorSchema.safeParse(a.captured.body).success).toBe(true);
        expect(foodErrorSchema.safeParse(b.captured.body).success).toBe(true);
    });

    it('maps FetchUnavailableError → 503 and sets Retry-After', () => {
        const { host, captured } = makeHost();

        filter.catch(new FetchUnavailableError(30), host);

        expect(captured.status).toBe(HttpStatus.SERVICE_UNAVAILABLE);
        expect(captured.headers['Retry-After']).toBe('30');
        expect(captured.body).toEqual({
            code: FoodErrorCode.FETCH_UNAVAILABLE,
            message: 'Fetch temporarily unavailable',
            details: { retryAfterSeconds: 30 },
        });
    });

    it('maps FoodPendingError → 202 with the status in details', () => {
        const { host, captured } = makeHost();

        filter.catch(new FoodPendingError(VALID_ID, 'PENDING', 15), host);

        expect(captured.status).toBe(HttpStatus.ACCEPTED);
        expect(captured.body).toEqual({
            code: FoodErrorCode.FOOD_PENDING,
            message: `Food '${VALID_ID}' is PENDING`,
            details: { id: VALID_ID, status: 'PENDING', estimatedWaitSeconds: 15 },
        });
    });

    /**
     * ⛔ THE DELIBERATE NON-MAPPING. `IllegalStatusTransitionError` is a DAO invariant raised from several
     * call sites whose HTTP meanings differ: U9's operator requeue turns it into a `409` at its own service
     * boundary, while the same rejection from the merge/persist path behind `PATCH /{id}` is a server-side
     * lifecycle bug. Giving it an arm HERE would answer that bug with `409 "use the refetch route"` — advice
     * that is nonsense on a resolve route — and would demote its log line from `error` to `warn`, deleting it
     * from the 5xx signal. This case is what makes adding that arm turn a suite red.
     */
    it('does NOT classify a DAO IllegalStatusTransitionError — it stays a 500, logged at error with a stack', () => {
        const { host, captured } = makeHost();

        filter.catch(new IllegalStatusTransitionError(VALID_ID, 'PENDING'), host);

        expect(captured.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
        expect(captured.body).toEqual({ code: FoodErrorCode.INTERNAL_ERROR, message: 'Internal server error' });
        // The DAO message names the rejected transition and never reaches a caller.
        expect(JSON.stringify(captured.body)).not.toContain('Illegal status transition');
        expect(records[0]?.level).toBe('error');
        expect(records[0]?.context['stack']).toContain('IllegalStatusTransitionError');
    });

    it('collapses an unknown throwable to a generic 500 with no leaked detail', () => {
        const { host, captured } = makeHost();
        const leaky = new Error('connect ECONNREFUSED 10.0.3.14:5432 — password=hunter2');

        filter.catch(leaky, host);

        expect(captured.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
        expect(captured.body).toEqual({ code: FoodErrorCode.INTERNAL_ERROR, message: 'Internal server error' });
        expect(JSON.stringify(captured.body)).not.toContain('ECONNREFUSED');
        expect(JSON.stringify(captured.body)).not.toContain('hunter2');
    });

    /**
     * THE CONVERGENCE. Each case below is a body shape that used to reach the wire verbatim, and the point of
     * every one is the same: the envelope guarantee is the FILTER's, so no throw site can opt out of it.
     */
    describe('normalizes every HttpException into the one envelope', () => {
        it('turns a bare STRING body into { code, message } — how the auth guard raises every 401', () => {
            // `FoodAuthGuard` (not this agent's territory, and not required to change) throws
            // `new UnauthorizedException('Valid Clerk session or M2M token required')`. Nest renders that as
            // `{ statusCode: 401, message: '…', error: 'Unauthorized' }` — shape #2 of the old three.
            const { host, captured } = makeHost();

            filter.catch(new UnauthorizedException('Valid Clerk session or M2M token required'), host);

            expect(captured.status).toBe(HttpStatus.UNAUTHORIZED);
            expect(captured.body).toEqual({
                code: FoodErrorCode.UNAUTHORIZED,
                message: 'Valid Clerk session or M2M token required',
            });
        });

        it("turns Nest's own { statusCode, message, error } object body into the envelope", () => {
            const { host, captured } = makeHost();

            // What `new HttpException()` with no message produces: Nest fills the body itself.
            filter.catch(new BadRequestException(), host);

            expect(captured.status).toBe(HttpStatus.BAD_REQUEST);
            expect(captured.body).toEqual({ code: 'BAD_REQUEST', message: 'Bad Request' });
            expect(JSON.stringify(captured.body)).not.toContain('statusCode');
        });

        it('turns the legacy { error, …extras } controller body into the envelope, losing no extras', () => {
            // Shape #3. No controller in this service raises it any more, but a MISSED site — or a new one added
            // by someone who has not read this — must still leave as the envelope rather than as a fourth shape.
            const { host, captured } = makeHost();

            filter.catch(new BadRequestException({ error: 'Batch too large', maxNames: 100 }), host);

            expect(captured.status).toBe(HttpStatus.BAD_REQUEST);
            expect(captured.body).toEqual({
                code: 'BAD_REQUEST',
                message: 'Batch too large',
                details: { maxNames: 100 },
            });
        });

        it('PRESERVES an explicit code, message and details rather than re-deriving from the status', () => {
            // This is what `apiError()` produces, and it is also how `IDENTITY_SYNC_PENDING` survives: two
            // distinct 401s that a status-derived code would flatten into one.
            const { host, captured } = makeHost();
            const body = {
                code: FoodErrorCode.IDENTITY_SYNC_PENDING,
                message: 'App-user identity (external_id) not yet available.',
                details: { retryWithRefreshedToken: true },
            };

            filter.catch(new HttpException(body, HttpStatus.UNAUTHORIZED), host);

            expect(captured.status).toBe(HttpStatus.UNAUTHORIZED);
            expect(captured.body).toEqual(body);
        });

        it('renders a REAL ZodValidationPipe rejection as VALIDATION_FAILED with the offending fields', () => {
            // Driven through the actual pipe, not a hand-shaped body: a `nestjs-zod` change to where the issues
            // live fails this test instead of quietly degrading the wire to `message: 'Validation failed'`.
            const pipe = new ZodValidationPipe();
            const { host, captured } = makeHost();
            let rejection: unknown;

            try {
                pipe.transform({ name: '   ' }, { type: 'body', metatype: AddFoodBodyDto } as never);
            } catch (error) {
                rejection = error;
            }

            filter.catch(rejection, host);

            expect(captured.status).toBe(HttpStatus.BAD_REQUEST);
            const body = captured.body as { code: string; message: string; details: { fields: string[] } };
            expect(body.code).toBe(FoodErrorCode.VALIDATION_FAILED);
            expect(body.details.fields[0]).toContain('name');
            expect(body.message).not.toBe('Validation failed');
        });

        it('normalizes an unmapped status too, without leaking the framework body', () => {
            const { host, captured } = makeHost();

            filter.catch(new HttpException('teapot', 418), host);

            expect(captured.status).toBe(418);
            expect(captured.body).toEqual({ code: 'HTTP_418', message: 'teapot' });
        });

        it('produces a body that satisfies the published envelope for EVERY branch', () => {
            // The mutation-lens assertion for the whole convergence: one shape means one shape. A branch that
            // emitted anything else — a raw string, `{ statusCode }`, `{ error }` — fails here.
            const throwables: unknown[] = [
                new FoodNotFoundError(VALID_ID, 'FAILED'),
                new CandidateMismatchError(VALID_ID),
                new NotResolvableError(VALID_ID, 'PENDING'),
                new FetchUnavailableError(30),
                new FoodPendingError(VALID_ID, 'UNRESOLVED'),
                new UnauthorizedException('nope'),
                new BadRequestException({ error: 'Invalid id' }),
                new HttpException('teapot', 418),
                new HttpException(['an', 'array', 'body'], 400),
                // A non-object, non-string body: the types forbid it, JavaScript does not, and this filter is
                // the last thing between it and a caller. The cast reproduces runtime reality on purpose.
                new HttpException(42 as unknown as string, 400),
                new Error('boom'),
                'a bare string',
                undefined,
            ];

            for (const throwable of throwables) {
                const { host, captured } = makeHost();
                filter.catch(throwable, host);

                const parsed = apiErrorSchema.safeParse(captured.body);
                expect(parsed.success, `body for ${String(throwable)} is not the envelope`).toBe(true);
                expect(parsed.success && parsed.data.message.length > 0).toBe(true);
            }
        });
    });

    /**
     * T-151 — the filter's observability contract. The bug this pins was found the hard way: an agent
     * chasing a real `TypeError` behind a 500 could only locate it by temporarily patching a debug log
     * into this file, because the unclassified branch wrote NOTHING anywhere.
     */
    describe('structured logging (T-151)', () => {
        it('logs an unclassified throwable at error with its name, message, stack, and the request', () => {
            const { host, captured } = makeHost({
                method: 'POST',
                originalUrl: '/api/v1/foods/batch',
                headers: { 'x-request-id': 'req-abc123' },
            });
            const bug = new TypeError("Cannot read properties of undefined (reading 'nutrients')");

            filter.catch(bug, host);

            expect(captured.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
            expect(records).toHaveLength(1);
            expect(records[0].level).toBe('error');
            expect(records[0].context).toMatchObject({
                status: HttpStatus.INTERNAL_SERVER_ERROR,
                code: FoodErrorCode.INTERNAL_ERROR,
                method: 'POST',
                path: '/api/v1/foods/batch',
                requestId: 'req-abc123',
                errorName: 'TypeError',
                errorMessage: "Cannot read properties of undefined (reading 'nutrients')",
            });
            expect(records[0].context['stack']).toContain('TypeError');
            expect(records[0].context['stack']).toContain('apiException.filter.test');
        });

        it('never records the Authorization header, a bearer token, the body, or the query string', () => {
            const { host } = makeHost({
                method: 'GET',
                originalUrl: '/api/v1/foods/search?query=a-users-search-text&api_key=NOT-A-REAL-KEY',
                headers: {
                    authorization: 'Bearer eyJhbGciOiJSUzI1NiJ9.not-a-real-token',
                    cookie: '__session=not-a-real-session',
                },
            });

            filter.catch(new Error('boom'), host);

            const serialized = JSON.stringify(records);
            expect(serialized).not.toContain('Bearer');
            expect(serialized).not.toContain('not-a-real-token');
            expect(serialized).not.toContain('__session');
            expect(serialized).not.toContain('hunter2');
            expect(serialized).not.toContain('a-users-search-text');
            expect(serialized).not.toContain('NOT-A-REAL-KEY');
            // The path is kept, but only up to the `?` — a query string is caller-supplied content.
            expect(records[0].context['path']).toBe('/api/v1/foods/search');
        });

        it('logs a CLASSIFIED 5xx (FetchUnavailableError → 503) at error too, not just the unknown branch', () => {
            // The sibling classification path returns a 5xx as well. A sustained 503 wave is the FR-019
            // budget stalling the whole fan-out — the one thing an operator most needs to see.
            const { host, captured } = makeHost();

            filter.catch(new FetchUnavailableError(30), host);

            expect(captured.status).toBe(HttpStatus.SERVICE_UNAVAILABLE);
            expect(records).toHaveLength(1);
            expect(records[0].level).toBe('error');
            expect(records[0].context).toMatchObject({
                status: HttpStatus.SERVICE_UNAVAILABLE,
                code: FoodErrorCode.FETCH_UNAVAILABLE,
            });
        });

        it('logs an HttpException 5xx at error — the passthrough branch is not exempt', () => {
            const { host, captured } = makeHost();

            filter.catch(new HttpException('upstream exploded', HttpStatus.BAD_GATEWAY), host);

            expect(captured.status).toBe(HttpStatus.BAD_GATEWAY);
            expect(records).toHaveLength(1);
            expect(records[0].level).toBe('error');
            expect(records[0].context).toMatchObject({ status: HttpStatus.BAD_GATEWAY });
        });

        it('logs a 4xx at warn, with no stack (expected control flow, not a server fault)', () => {
            const notFound = makeHost();
            filter.catch(new FoodNotFoundError(VALID_ID, 'NOT_FOUND'), notFound.host);

            expect(records).toHaveLength(1);
            expect(records[0].level).toBe('warn');
            expect(records[0].context).toMatchObject({
                status: HttpStatus.NOT_FOUND,
                code: FoodErrorCode.FOOD_NOT_FOUND,
            });
            expect(records[0].context['stack']).toBeUndefined();

            const badRequest = makeHost();
            filter.catch(new BadRequestException('bad id'), badRequest.host);

            expect(records[1].level).toBe('warn');
            expect(records[1].context).toMatchObject({ status: HttpStatus.BAD_REQUEST });
        });

        it('logs NOTHING for a sub-400 outcome — a 202 FOOD_PENDING is the normal read path', () => {
            // Every first read of a newly-requested food raises FoodPendingError. Logging those would
            // bury the failures this change exists to surface (and cost real money at CloudWatch rates).
            const { host, captured } = makeHost();

            filter.catch(new FoodPendingError(VALID_ID, 'PENDING', 15), host);

            expect(captured.status).toBe(HttpStatus.ACCEPTED);
            expect(records).toEqual([]);
        });

        it('falls back to x-amzn-trace-id, and omits requestId when the request carries neither', () => {
            const traced = makeHost({ headers: { 'x-amzn-trace-id': 'Root=1-abc-def' } });
            filter.catch(new Error('boom'), traced.host);
            expect(records[0].context['requestId']).toBe('Root=1-abc-def');

            const untraced = makeHost();
            filter.catch(new Error('boom'), untraced.host);
            expect(records[1].context).not.toHaveProperty('requestId');
        });

        it('describes a non-Error throwable without crashing the filter', () => {
            const { host, captured } = makeHost();

            filter.catch('a bare string was thrown', host);

            expect(captured.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
            expect(records[0].level).toBe('error');
            expect(records[0].context).toMatchObject({
                errorName: 'NonError',
                errorMessage: 'a bare string was thrown',
            });
            expect(records[0].context['stack']).toBeUndefined();
        });

        it('still answers the caller when the logger itself throws', () => {
            // A filter that throws inside `catch()` converts a clean 500 into a dead socket. The log is
            // best-effort BY DESIGN — but it must not fail silently either, hence the fallback line.
            const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
            const exploding: WorkerLogger = {
                info: () => {},
                warn: () => {},
                error: () => {
                    throw new Error('log sink is down');
                },
            };
            const { host, captured } = makeHost();

            new ApiExceptionFilter(exploding).catch(new Error('boom'), host);

            expect(captured.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
            expect(captured.body).toEqual({ code: FoodErrorCode.INTERNAL_ERROR, message: 'Internal server error' });
            expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('api-error-log-failed'));

            consoleError.mockRestore();
        });

        it('defaults to a JSON line on stdout, resolving console per call', () => {
            // The production default has no injected sink. `console` is resolved at CALL time (the
            // `emfMetrics.ts` writeLine lesson), so a spy installed after construction still sees it.
            const defaultFilter = new ApiExceptionFilter();
            const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
            const { host } = makeHost({ method: 'GET', originalUrl: '/api/v1/foods/01J' });

            defaultFilter.catch(new RangeError('out of range'), host);

            expect(consoleError).toHaveBeenCalledTimes(1);
            const line = JSON.parse(consoleError.mock.calls[0][0] as string) as Record<string, unknown>;
            expect(line).toMatchObject({
                level: 'error',
                component: 'food-api',
                message: 'api-request-failed',
                method: 'GET',
                path: '/api/v1/foods/01J',
                errorName: 'RangeError',
            });

            consoleError.mockRestore();
        });
    });
});
