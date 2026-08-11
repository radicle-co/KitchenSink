/**
 * Integration tests for {@link ApiExceptionFilter} over a REAL booted Nest app and a REAL HTTP request
 * (T-151). No database: the subject is the filter's contract with the framework, not the food domain.
 *
 * This tier exists because the unit specs necessarily FAKE the Express request, and every interesting
 * claim in the fix is a claim about the real one:
 *
 * - the filter is constructible by Nest's injector as an `APP_FILTER` `useClass` provider even though its
 *   logging port is an interface with no provider (`@Optional()` + a default) — get that wrong and the
 *   whole API fails to BOOT, which no unit test of the class can notice;
 * - `request.originalUrl` on a real request really does carry the query string (so stripping it is load
 *   bearing, not decorative), and `request.method` / the correlation headers really are where the filter
 *   looks for them;
 * - a genuine `TypeError` thrown inside a handler really does reach the unclassified branch and really
 *   does leave ONE parseable JSON line on stdout — the whole point of the change.
 *
 * @implements FR-051
 */
import 'reflect-metadata';

import type { AddressInfo } from 'node:net';

import { BadRequestException, Controller, Get, HttpStatus, Module } from '@nestjs/common';
import { APP_FILTER, NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiExceptionFilter, FoodErrorCode } from '../src/common/filters/api-exception.filter.js';
import { FetchUnavailableError, FoodPendingError } from '../src/foods/foods.errors.js';

const PENDING_ID = '01J9ZZZZZZZZZZZZZZZZZZZZZZ';

/** Routes that throw one representative of each branch the filter resolves. */
@Controller('api/v1/foods')
class ThrowingController {
    /** A genuine bug: the exact shape (`TypeError` from a bad property read) the fix was written for. */
    @Get('bug')
    public bug(): string {
        const rows = undefined as unknown as Array<{ nutrients: string }>;

        return rows[0].nutrients;
    }

    /** A classified 5xx — the sibling path that had the identical no-log hole. */
    @Get('unavailable')
    public unavailable(): string {
        throw new FetchUnavailableError(30);
    }

    /** A classified sub-400 outcome (the normal first read of a queued food). */
    @Get('pending')
    public pending(): string {
        throw new FoodPendingError(PENDING_ID, 'PENDING', 15);
    }

    /** A framework 4xx. */
    @Get('bad')
    public bad(): string {
        throw new BadRequestException('bad id');
    }
}

@Module({
    controllers: [ThrowingController],
    // Registered exactly as `app.module.ts` registers it, so this exercises the real injector path.
    providers: [{ provide: APP_FILTER, useClass: ApiExceptionFilter }],
})
class FilterTestModule {}

/** One structured record parsed off the captured stdout/stderr lines. */
interface ParsedRecord {
    level?: string;
    component?: string;
    message?: string;
    [key: string]: unknown;
}

describe('ApiExceptionFilter over a booted Nest app', () => {
    let app: INestApplication;
    let baseUrl: string;
    let lines: string[];

    beforeAll(async () => {
        // `logger: false` silences Nest's own bootstrap chatter so the only lines captured below are the
        // filter's — the assertions can then be about presence AND absence.
        app = await NestFactory.create(FilterTestModule, { logger: false });
        await app.listen(0);

        const address = app.getHttpServer().address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${address.port}`;
    });

    afterAll(async () => {
        await app.close();
    });

    beforeEach(() => {
        lines = [];
        vi.spyOn(console, 'error').mockImplementation((line: unknown) => {
            lines.push(String(line));
        });
        vi.spyOn(console, 'info').mockImplementation((line: unknown) => {
            lines.push(String(line));
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    /** Every captured line, parsed as JSON (a non-JSON line would fail the parse and the test). */
    function records(): ParsedRecord[] {
        return lines.map((line) => JSON.parse(line) as ParsedRecord);
    }

    it('logs a real TypeError from a handler as ONE parseable JSON line, and answers 500', async () => {
        const response = await fetch(`${baseUrl}/api/v1/foods/bug?query=broccoli&api_key=NOT-A-REAL-KEY`, {
            headers: { authorization: 'Bearer eyJhbGciOiJSUzI1NiJ9.not-a-real-token', 'x-request-id': 'req-int-1' },
        });

        expect(response.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
        await expect(response.json()).resolves.toEqual({
            code: FoodErrorCode.INTERNAL_ERROR,
            message: 'Internal server error',
        });

        const parsed = records();
        expect(parsed).toHaveLength(1);
        expect(parsed[0]).toMatchObject({
            level: 'error',
            component: 'food-api',
            message: 'api-request-failed',
            status: HttpStatus.INTERNAL_SERVER_ERROR,
            code: FoodErrorCode.INTERNAL_ERROR,
            method: 'GET',
            // The real `originalUrl` DID carry `?query=…&api_key=…`; the record must not.
            path: '/api/v1/foods/bug',
            requestId: 'req-int-1',
            errorName: 'TypeError',
        });
        expect(String(parsed[0]['stack'])).toContain('ThrowingController');

        const serialized = JSON.stringify(parsed);
        expect(serialized).not.toContain('not-a-real-token');
        expect(serialized).not.toContain('NOT-A-REAL-KEY');
        expect(serialized).not.toContain('broccoli');
    });

    it('logs a classified 503 at error and a framework 400 at warn', async () => {
        const unavailable = await fetch(`${baseUrl}/api/v1/foods/unavailable`);

        expect(unavailable.status).toBe(HttpStatus.SERVICE_UNAVAILABLE);
        expect(unavailable.headers.get('retry-after')).toBe('30');
        expect(records()).toHaveLength(1);
        expect(records()[0]).toMatchObject({
            level: 'error',
            status: HttpStatus.SERVICE_UNAVAILABLE,
            code: FoodErrorCode.FETCH_UNAVAILABLE,
            path: '/api/v1/foods/unavailable',
        });

        lines = [];
        const bad = await fetch(`${baseUrl}/api/v1/foods/bad`);

        expect(bad.status).toBe(HttpStatus.BAD_REQUEST);
        expect(records()).toHaveLength(1);
        expect(records()[0]).toMatchObject({ level: 'warn', status: HttpStatus.BAD_REQUEST });
        expect(records()[0]['stack']).toBeUndefined();
    });

    it('stays silent for the 202 FOOD_PENDING read path', async () => {
        const response = await fetch(`${baseUrl}/api/v1/foods/pending`);

        expect(response.status).toBe(HttpStatus.ACCEPTED);
        expect(lines).toEqual([]);
    });
});
