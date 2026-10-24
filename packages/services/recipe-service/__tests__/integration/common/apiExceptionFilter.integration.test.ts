/**
 * Integration — {@link ApiExceptionFilter} over a REAL booted Nest app and REAL HTTP, with the database MOCKED: the
 * routes throw the errors the database layer throws, built from the REAL driver classes (`pg`'s `DatabaseError`,
 * drizzle's `DrizzleQueryError`), so no pool exists (§7.1a).
 *
 * The subject is the filter's contract with the framework for text PostgreSQL refuses (SQLSTATE `22021` for a NUL in
 * a `text` parameter, `22P05` for one in a `jsonb` parameter): a `400 VALIDATION_FAILED` the typed contract parses,
 * no SQL and no caller text echoed, and NO Sentry issue. The LOCAL e2e (`tests/e2e/unstorableText.e2e.test.ts`)
 * proves the same answer from a real PostgreSQL.
 */
import 'reflect-metadata';

import { Controller, Get, HttpStatus, Module, type INestApplication } from '@nestjs/common';
import { APP_FILTER, NestFactory } from '@nestjs/core';
import { DrizzleQueryError } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const { mockCaptureException } = vi.hoisted(() => ({ mockCaptureException: vi.fn() }));

vi.mock('@sentry/nestjs', () => ({ captureException: mockCaptureException }));

import { recipeApiErrorSchema } from '../../../src/common/apiError.schema.js';
import { ApiExceptionFilter } from '../../../src/common/filters/apiException.filter.js';

/** The caller's text inside the rejected parameter, which must never come back to the caller. */
const CALLER_TEXT = 'Weeknight dinners';

/**
 * `pg`'s driver error carrying a SQLSTATE, as the protocol parser builds it.
 *
 * @param code - The SQLSTATE PostgreSQL answered with.
 * @returns The error.
 */
function makeDriverError(code: string): pg.DatabaseError {
    const error = new pg.DatabaseError('invalid byte sequence for encoding "UTF8": 0x00', 0, 'error');
    error.code = code;

    return error;
}

/** Routes that throw what the database layer throws. */
@Controller('api/v1/probe')
class ThrowingController {
    /** A NUL in a `text` parameter, through drizzle: the driver error is the query error's `cause`. */
    @Get('text')
    public text(): string {
        throw new DrizzleQueryError(
            'insert into "collections" ("name") values ($1)',
            [`${CALLER_TEXT}\u0000`],
            makeDriverError('22021'),
        );
    }

    /** A NUL escape in a `jsonb` parameter, from a raw `pool.query`: the driver error is thrown bare. */
    @Get('jsonb')
    public jsonb(): string {
        throw makeDriverError('22P05');
    }

    /** A genuine bug, the positive control for the reporter spy. */
    @Get('bug')
    public bug(): string {
        throw new TypeError('a genuine bug');
    }
}

@Module({
    controllers: [ThrowingController],
    // Registered exactly as `AppModule` registers it.
    providers: [{ provide: APP_FILTER, useClass: ApiExceptionFilter }],
})
class FilterTestModule {}

describe('ApiExceptionFilter — text PostgreSQL refuses (integration, database mocked)', () => {
    let app: INestApplication;
    let baseUrl: string;

    beforeAll(async () => {
        app = await NestFactory.create(FilterTestModule, { logger: false, abortOnError: false });
        await app.listen(0);
        baseUrl = await app.getUrl();
    });

    afterAll(async () => {
        await app.close();
    });

    afterEach(() => {
        mockCaptureException.mockClear();
    });

    it.each(['text', 'jsonb'])(
        '⛔ answers the %s rejection with a 400 VALIDATION_FAILED and reports nothing',
        async (route) => {
            const response = await fetch(`${baseUrl}/api/v1/probe/${route}`);
            const body: unknown = await response.json();

            expect(response.status).toBe(HttpStatus.BAD_REQUEST);
            expect(recipeApiErrorSchema.parse(body)).toMatchObject({ code: 'VALIDATION_FAILED' });
            expect(JSON.stringify(body)).not.toContain(CALLER_TEXT);
            expect(JSON.stringify(body)).not.toContain('insert into');
            expect(mockCaptureException).not.toHaveBeenCalled();
        },
    );

    it('reports the unclassified 500 to Sentry, so the spy above is known to be live', async () => {
        const response = await fetch(`${baseUrl}/api/v1/probe/bug`);

        expect(response.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
        expect(mockCaptureException).toHaveBeenCalledTimes(1);
    });
});
