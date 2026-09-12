import { describe, it, expect, vi } from 'vitest';
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
        it("logs the throwable's CAUSE chain, not just the outer stack", () => {
            // The 2026-09-11 k6 500s: `ErasureJobsDal.findActiveJob` threw drizzle's "Failed query" whose `cause`
            // was the Postgres error that explained it, and the log carried only the outer stack.
            const logged = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
            const driver = Object.assign(new Error('Connection terminated unexpectedly'), { code: '57P01' });
            const { host, captured } = makeHost();

            try {
                filter.catch(new Error('Failed query: select 1', { cause: driver }), host);

                expect(captured.statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
                expect(logged).toHaveBeenCalledTimes(1);

                const detail = String(logged.mock.calls[0]?.[1]);

                expect(detail).toContain('Failed query: select 1');
                expect(detail).toContain('Connection terminated unexpectedly');
                expect(detail).toContain('57P01');
            } finally {
                logged.mockRestore();
            }
        });
    });
});
