/**
 * Unit tests for the identity {@link ApiExceptionFilter} (ARCH-PS-2). Proves the composed behaviour:
 *
 * - unexpected throwables are captured to Sentry AND rendered as a generic, detail-free 500;
 * - `HttpException` control flow is NOT captured (unchanged capture policy) but IS reshaped into the
 *   shared `{ code, message, details? }` envelope (code derived from the HTTP status);
 * - class-validator message arrays are preserved under `details.fields`.
 *
 * NOTE: identity's vitest config only discovers the tests directory, so this unit test lives here
 * (rather than co-located under src) so it actually runs.
 */
import { BadRequestException, ForbiddenException, HttpException, NotFoundException } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const captureException = vi.fn();
vi.mock('@sentry/nestjs', () => ({ captureException: (...args: unknown[]) => captureException(...args) }));

import { ApiExceptionFilter } from '../src/common/filters/api-exception.filter.js';

interface Captured {
    status?: number;
    body?: unknown;
}

function makeHost(): { host: ArgumentsHost; captured: Captured } {
    const captured: Captured = {};
    const res = {
        status(code: number) {
            captured.status = code;

            return res;
        },
        json(body: unknown) {
            captured.body = body;

            return res;
        },
    };
    const host = {
        switchToHttp: () => ({ getResponse: <T>() => res as unknown as T }),
    } as unknown as ArgumentsHost;

    return { host, captured };
}

describe('ApiExceptionFilter (identity)', () => {
    const filter = new ApiExceptionFilter();

    beforeEach(() => {
        captureException.mockClear();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('maps NotFoundException → 404 { code, message } and does NOT capture to Sentry', () => {
        const { host, captured } = makeHost();

        filter.catch(new NotFoundException('User not found'), host);

        expect(captured.status).toBe(404);
        expect(captured.body).toEqual({ code: 'NOT_FOUND', message: 'User not found' });
        expect(captureException).not.toHaveBeenCalled();
    });

    it('maps ForbiddenException → 403 with the FORBIDDEN code', () => {
        const { host, captured } = makeHost();

        filter.catch(new ForbiddenException('User is suspended'), host);

        expect(captured.status).toBe(403);
        expect(captured.body).toEqual({ code: 'FORBIDDEN', message: 'User is suspended' });
    });

    it('preserves class-validator message arrays under details.fields', () => {
        const { host, captured } = makeHost();
        const validation = new BadRequestException({
            statusCode: 400,
            error: 'Bad Request',
            message: ['name must be a string', 'name should not be empty'],
        });

        filter.catch(validation, host);

        expect(captured.status).toBe(400);
        expect(captured.body).toEqual({
            code: 'BAD_REQUEST',
            message: 'name must be a string, name should not be empty',
            details: { fields: ['name must be a string', 'name should not be empty'] },
        });
    });

    it('derives HTTP_<status> for an unmapped status and reads a string body', () => {
        const { host, captured } = makeHost();

        filter.catch(new HttpException('teapot', 418), host);

        expect(captured.status).toBe(418);
        expect(captured.body).toEqual({ code: 'HTTP_418', message: 'teapot' });
    });

    it('captures an unexpected error to Sentry and returns a generic 500 with no leaked detail', () => {
        const { host, captured } = makeHost();
        const leaky = new Error('connect ECONNREFUSED 10.0.3.14:5432 password=hunter2');

        filter.catch(leaky, host);

        expect(captureException).toHaveBeenCalledWith(leaky);
        expect(captured.status).toBe(500);
        expect(captured.body).toEqual({ code: 'INTERNAL_ERROR', message: 'Internal server error' });
        expect(JSON.stringify(captured.body)).not.toContain('ECONNREFUSED');
        expect(JSON.stringify(captured.body)).not.toContain('hunter2');
    });
});
