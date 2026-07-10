/**
 * Unit tests for {@link ApiExceptionFilter} (food service, ARCH-PS-2). Pins the one consistent
 * `{ code, message, details? }` envelope shared with identity/recipe:
 *
 * - each food domain error → its mapped status + `{ code, message, details? }` (and `Retry-After` for
 *   `FetchUnavailableError`);
 * - a framework `HttpException` passes through untouched (the controller's FR-051 wire contract);
 * - any other throwable collapses to a generic 500 whose body leaks no internal detail.
 */
import { BadRequestException, HttpException, HttpStatus, type ArgumentsHost } from '@nestjs/common';
import type { Response } from 'express';
import { describe, expect, it } from 'vitest';

import {
    CandidateMismatchError,
    FetchUnavailableError,
    FoodNotFoundError,
    FoodPendingError,
    NotResolvableError,
} from '../../../foods/foods.errors.js';
import { ApiExceptionFilter, FoodErrorCode } from '../api-exception.filter.js';

const VALID_ID = '01J9ZZZZZZZZZZZZZZZZZZZZZZ';

interface Captured {
    status?: number;
    body?: unknown;
    headers: Record<string, string>;
}

function makeHost(): { host: ArgumentsHost; captured: Captured } {
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

    const host = {
        switchToHttp: () => ({ getResponse: <T>() => res as unknown as T }),
    } as unknown as ArgumentsHost;

    return { host, captured };
}

describe('ApiExceptionFilter (food)', () => {
    const filter = new ApiExceptionFilter();

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
});
