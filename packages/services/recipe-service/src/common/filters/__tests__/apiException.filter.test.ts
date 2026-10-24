import { beforeEach, describe, it, expect, vi } from 'vitest';

const { mockCaptureException } = vi.hoisted(() => ({ mockCaptureException: vi.fn() }));

vi.mock('@sentry/nestjs', () => ({ captureException: mockCaptureException }));
import { BadRequestException, HttpException, HttpStatus, Logger, type ArgumentsHost } from '@nestjs/common';
import { RecipeErrorCode } from '@kitchensink/recipe-core';
import type { RecipeError } from '@kitchensink/recipe-core';

import { ApiExceptionFilter, RECIPE_ERROR_STATUS } from '../apiException.filter.js';

interface CapturedResponse {
    statusCode: number | undefined;
    body: unknown;
}

const makeHost = (): { host: ArgumentsHost; captured: CapturedResponse } => {
    const captured: CapturedResponse = { statusCode: undefined, body: undefined };
    const response = {
        status: vi.fn((code: number) => {
            captured.statusCode = code;

            return response;
        }),
        json: vi.fn((body: unknown) => {
            captured.body = body;

            return response;
        }),
    };
    const host = {
        switchToHttp: () => ({
            getResponse: () => response,
            getRequest: () => ({}),
        }),
    } as unknown as ArgumentsHost;

    return { host, captured };
};

describe('ApiExceptionFilter', () => {
    const filter = new ApiExceptionFilter();

    describe('RecipeError → HTTP status mapping', () => {
        const cases: ReadonlyArray<readonly [RecipeError['code'], number]> = [
            [RecipeErrorCode.RECIPE_NOT_FOUND, HttpStatus.NOT_FOUND],
            [RecipeErrorCode.RECIPE_TOMBSTONED, HttpStatus.GONE],
            [RecipeErrorCode.NOT_OWNER, HttpStatus.FORBIDDEN],
            [RecipeErrorCode.VERSION_CONFLICT, HttpStatus.CONFLICT],
            [RecipeErrorCode.MAX_PHOTOS_EXCEEDED, HttpStatus.CONFLICT],
            [RecipeErrorCode.INVALID_VISIBILITY, HttpStatus.BAD_REQUEST],
            [RecipeErrorCode.PHOTO_PROCESSING_FAILED, HttpStatus.UNPROCESSABLE_ENTITY],
            [RecipeErrorCode.ARCHIVE_PENDING, HttpStatus.CONFLICT],
            [RecipeErrorCode.ARCHIVE_DLQ, HttpStatus.INTERNAL_SERVER_ERROR],
            [RecipeErrorCode.COLLECTION_NOT_CLONED, HttpStatus.BAD_REQUEST],
            [RecipeErrorCode.COLLECTION_LIMIT_REACHED, HttpStatus.CONFLICT],
            [RecipeErrorCode.ERASURE_IN_PROGRESS, 423],
        ];

        it.each(cases)('maps %s to status %i', (code, expectedStatus) => {
            const { host, captured } = makeHost();
            const error: RecipeError = { code, message: `boom: ${code}` };

            filter.catch(error, host);

            expect(captured.statusCode).toBe(expectedStatus);
            expect(captured.body).toEqual({ code, message: `boom: ${code}` });
        });

        it('covers every RecipeErrorCode in the status map', () => {
            for (const code of Object.values(RecipeErrorCode)) {
                expect(RECIPE_ERROR_STATUS[code]).toBeTypeOf('number');
            }
        });

        it('includes structured details in the body when present', () => {
            const { host, captured } = makeHost();
            const error: RecipeError = {
                code: RecipeErrorCode.VERSION_CONFLICT,
                message: 'Recipe version conflict',
                details: { currentVersion: 3, conflictingVersion: 2 },
            };

            filter.catch(error, host);

            expect(captured.statusCode).toBe(HttpStatus.CONFLICT);
            expect(captured.body).toEqual({
                code: RecipeErrorCode.VERSION_CONFLICT,
                message: 'Recipe version conflict',
                details: { currentVersion: 3, conflictingVersion: 2 },
            });
        });
    });

    describe('unknown-error fallback', () => {
        it('maps an arbitrary Error to 500 without leaking its message', () => {
            const { host, captured } = makeHost();

            filter.catch(new Error('surprise internal detail'), host);

            expect(captured.statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
            expect(captured.body).toEqual({ code: 'INTERNAL_ERROR', message: 'Internal server error' });
        });

        it('maps a non-error thrown value to 500', () => {
            const { host, captured } = makeHost();

            filter.catch('a bare string', host);

            expect(captured.statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
            expect(captured.body).toEqual({ code: 'INTERNAL_ERROR', message: 'Internal server error' });
        });
    });

    describe('HttpException passthrough', () => {
        it('preserves the status of a framework HttpException', () => {
            const { host, captured } = makeHost();

            filter.catch(new BadRequestException('bad input'), host);

            expect(captured.statusCode).toBe(HttpStatus.BAD_REQUEST);
        });

        it('preserves a custom HttpException status', () => {
            const { host, captured } = makeHost();

            filter.catch(new HttpException('teapot', HttpStatus.I_AM_A_TEAPOT), host);

            expect(captured.statusCode).toBe(HttpStatus.I_AM_A_TEAPOT);
        });
    });

    describe('5xx logging', () => {
        /**
         * ⛔ REWRITTEN, not edited to compile. It used to assert that this filter logged
         * `renderThrowable(exception)`'s output — the right renderer applied in the wrong place. A string
         * that reaches the sink already rendered is free text the sink did not produce, and
         * `@kitchensink/service-logging` scrubs what it renders, so pre-rendering here skipped the scrub and
         * put an unredacted `util.inspect` dump onto a stream ADR-0042's drain forwards off-host.
         *
         * This case now proves the filter's half: the throwable goes over WHOLE with its `cause` reachable.
         * ⚠️ The chain's own coverage MOVED rather than vanished — `service-logging`'s `logAttributes.test.ts`
         * asserts a wrapped error renders with its cause, and `logSink.test.ts` asserts that render is
         * scrubbed in place.
         */
        it('hands the throwable over WHOLE, cause attached, for the sink to render', () => {
            const logged = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
            const driver = Object.assign(new Error('Connection terminated unexpectedly'), { code: '57P01' });
            const wrapped = new Error('Failed query: select 1', { cause: driver });
            const { host, captured } = makeHost();

            try {
                filter.catch(wrapped, host);

                expect(captured.statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
                expect(logged).toHaveBeenCalledTimes(1);

                const attributes = logged.mock.calls[0]?.[1] as { error?: unknown };

                expect(attributes.error).toBe(wrapped);
                expect((attributes.error as Error).cause).toBe(driver);
            } finally {
                logged.mockRestore();
            }
        });
    });
});

/**
 * U17 — an unexpected failure REPORTS to Sentry, an expected one does not.
 *
 * ⛔ The log drain carries this filter's log line to Sentry, but a forwarded log line is a log line: it does
 * not group, carries no stack trace Sentry can symbolicate, and nothing alerts on it. A 5xx is a server
 * fault — precisely the class that should raise an issue.
 *
 * ⛔ AND ONLY A 5xx. A 4xx is expected control flow — a 404 for something that does not exist, a 401 for an
 * expired token — and capturing those would create an issue per bad request, which is how a Sentry project
 * becomes unreadable and then ignored, taking the 5xx reports down with it.
 */
describe('Sentry reporting (U17)', () => {
    beforeEach(() => {
        mockCaptureException.mockClear();
    });

    it('⛔ reports an unexpected throwable, which becomes a 500', () => {
        const { host } = makeHost();

        new ApiExceptionFilter().catch(new Error('a database fault'), host);

        expect(mockCaptureException).toHaveBeenCalledTimes(1);
    });

    it('⛔ does NOT report a 4xx — expected control flow must not create an issue per bad request', () => {
        const { host } = makeHost();

        new ApiExceptionFilter().catch(new BadRequestException('bad input'), host);

        expect(mockCaptureException).not.toHaveBeenCalled();
    });
});
