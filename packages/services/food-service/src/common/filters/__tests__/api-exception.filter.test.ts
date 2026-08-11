/**
 * Unit tests for {@link ApiExceptionFilter} (food service, ARCH-PS-2). Pins the one consistent
 * `{ code, message, details? }` envelope shared with identity/recipe:
 *
 * - each food domain error → its mapped status + `{ code, message, details? }` (and `Retry-After` for
 *   `FetchUnavailableError`);
 * - a framework `HttpException` passes through untouched (the controller's FR-051 wire contract);
 * - any other throwable collapses to a generic 500 whose body leaks no internal detail.
 *
 * **And that the failure is OBSERVABLE (T-151).** The filter used to log NOTHING, so a genuine 500 —
 * a `TypeError` in a DAO, say — reached the caller as an opaque `INTERNAL_ERROR` and left no line on the
 * container's stdout at all. The food API has no Sentry SDK and no log-drain subscription, so that stdout
 * line is the ONLY diagnostic channel there is: it is the fix, not a nicety. These specs pin the whole
 * policy — which statuses log at which level, what the record must carry, and above all what it must
 * NEVER carry (the `Authorization` header, a bearer token, the request body, the query string).
 */
import { BadRequestException, HttpException, HttpStatus, type ArgumentsHost } from '@nestjs/common';
import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    CandidateMismatchError,
    FetchUnavailableError,
    FoodNotFoundError,
    FoodPendingError,
    NotResolvableError,
} from '../../../foods/foods.errors.js';
import type { LogContext, WorkerLogger } from '../../../worker/worker-logger.js';
import { ApiExceptionFilter, FoodErrorCode } from '../api-exception.filter.js';

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
            message: `Food '${VALID_ID}' not found`,
            details: { status: 'NOT_FOUND' },
        });
    });

    it('maps CandidateMismatchError / NotResolvableError → 409', () => {
        const a = makeHost();
        filter.catch(new CandidateMismatchError(VALID_ID), a.host);
        expect(a.captured.status).toBe(HttpStatus.CONFLICT);
        expect((a.captured.body as { code: string }).code).toBe(FoodErrorCode.CANDIDATE_MISMATCH);

        const b = makeHost();
        filter.catch(new NotResolvableError(VALID_ID, 'PENDING'), b.host);
        expect(b.captured.status).toBe(HttpStatus.CONFLICT);
        expect(b.captured.body).toEqual({
            code: FoodErrorCode.NOT_RESOLVABLE,
            message: `Food '${VALID_ID}' is PENDING, not UNRESOLVED`,
            details: { status: 'PENDING' },
        });
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
            details: { status: 'PENDING', estimatedWaitSeconds: 15 },
        });
    });

    it('passes a framework HttpException through untouched', () => {
        const { host, captured } = makeHost();
        const exception = new BadRequestException({ error: 'Invalid id' });

        filter.catch(exception, host);

        expect(captured.status).toBe(HttpStatus.BAD_REQUEST);
        expect(captured.body).toEqual({ error: 'Invalid id' });
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

    it('does not treat a plain HttpException-subclass status as a food domain error', () => {
        // A raw HttpException (e.g. a 418) must fall to the passthrough branch, never the 500 bucket.
        const { host, captured } = makeHost();
        filter.catch(new HttpException('teapot', 418), host);
        expect(captured.status).toBe(418);
        expect(captured.body).toBe('teapot');
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
            expect(records[0].context['stack']).toContain('api-exception.filter.test');
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
            // `emf-metrics.ts` writeLine lesson), so a spy installed after construction still sees it.
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
