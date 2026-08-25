/**
 * HTTP integration suite for `GET /api/v1/foods/search/live` — the ON-DEMAND source search behind the
 * ingredient picker's "Search USDA for '…'" affordance (plan U29), driven over the booted Nest app against
 * a REAL Postgres.
 *
 * ⛔ **The case this suite exists for is `charges the RESERVED interactive lane, not the drain's budget`.**
 * The unit suite proves the service asks for the right lane; only this tier can prove the request is
 * actually ADMITTED where the drain would have been refused, because that verdict is produced by real SQL
 * against the real `source_call_log` — the aggregate windowed count compared against a per-lane ceiling.
 * A mocked limiter returns whatever it was told and would pass either way.
 *
 * `@kitchensink/clerk-verify` is mocked so auth is deterministic. `@kitchensink/usda-client` is mocked so a
 * case can steer the upstream — hits, nothing, a 429, a 5xx, a timeout — without a real network call. The
 * limiter, the ledger, the crosswalk, the routing, the guard and the exception filter are the real stack.
 *
 * Boot config pins `FOOD_SOURCE_RATE_LIMIT_PER_HOUR=10`, so the 90% pause threshold is 9 and FR-019's
 * reserved lane is exactly one call wide — every boundary below is one row apart.
 *
 * @implements FR-010a FR-019 FR-020 FR-026 FR-IDN-2
 */
import 'reflect-metadata';

import { readdirSync, readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import pg from 'pg';
import { ulid } from 'ulidx';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/** How the fake upstream should behave for the next call. Steered per case. */
const upstream: {
    mode: 'hits' | 'empty' | 'throttled' | 'server-error' | 'timeout';
    calls: string[];
} = { mode: 'hits', calls: [] };

vi.mock('@kitchensink/clerk-verify', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@kitchensink/clerk-verify')>();

    return { ...actual, verifyClerkToken: vi.fn() };
});

vi.mock('@kitchensink/usda-client', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@kitchensink/usda-client')>();

    /**
     * A steerable double for the USDA HTTP client. It throws the SAME error types the real client throws,
     * so the adapter's own `classifyError` runs for real — the branch that decides busy-vs-unavailable.
     */
    class SteerableUsdaApiClient {
        public async searchFoods(query: string): Promise<{ foods: unknown[] }> {
            upstream.calls.push(query);

            switch (upstream.mode) {
                case 'empty':
                    return { foods: [] };
                case 'throttled':
                    throw new actual.UsdaRateLimitError('Too Many Requests');
                case 'server-error':
                    throw new actual.UsdaServerError(503, 'Service Unavailable');
                case 'timeout':
                    throw new actual.UsdaTimeoutError('timed out');
                default:
                    return {
                        foods: [
                            { fdcId: 171688, description: 'Broccoli, raw' },
                            { fdcId: 170379, description: 'Broccoli, cooked, boiled' },
                        ],
                    };
            }
        }

        public async getFood(): Promise<Record<string, unknown>> {
            throw new Error('not used by the live-search suite');
        }

        public async getFoodsBatch(): Promise<unknown[]> {
            return [];
        }
    }

    return { ...actual, UsdaApiClient: SteerableUsdaApiClient };
});

import { ClerkVerificationError, verifyClerkToken } from '@kitchensink/clerk-verify';

import { foodErrorSchema } from '../src/foods/foods.schema.js';

const mockVerify = vi.mocked(verifyClerkToken);

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../src/db/migrations');

/** The configured hard cap for this suite; the 90% worker ceiling is 9, so the reserve is one call. */
const HARD_CAP = 10;
const WORKER_CEILING = 9;

const USER_ULID = '01J9ZK8N7QF3B2X4M6T0V5C1AB';

describe.skipIf(!DATABASE_URL)('GET /api/v1/foods/search/live (booted Nest + real Postgres)', () => {
    let app: INestApplication;
    let pool: pg.Pool;
    let baseUrl: string;

    /** Issue a live search; omit `token` for an unauthenticated call. */
    async function search(
        query: string,
        token: string | undefined = 'user',
    ): Promise<{ status: number; body: unknown }> {
        const headers: Record<string, string> = {};

        if (token !== undefined) {
            headers['authorization'] = `Bearer ${token}`;
        }

        const response = await fetch(`${baseUrl}/api/v1/foods/search/live?query=${encodeURIComponent(query)}`, {
            headers,
        });
        const text = await response.text();

        return { status: response.status, body: text ? JSON.parse(text) : undefined };
    }

    /** Fill the trailing window with rows attributed to a lane. */
    async function seedWindow(channel: 'interactive' | 'worker', count: number): Promise<void> {
        await pool.query(
            `INSERT INTO source_call_log (source, channel, called_at)
             SELECT 'usda', $1::source_call_channel, now() FROM generate_series(1, $2)`,
            [channel, count],
        );
    }

    /** The trailing-window row count for one lane. */
    async function laneCount(channel: 'interactive' | 'worker'): Promise<number> {
        const { rows } = await pool.query<{ n: string }>(
            `SELECT count(*) AS n FROM source_call_log
              WHERE source = 'usda' AND channel = $1 AND called_at > now() - interval '60 minutes'`,
            [channel],
        );

        return Number(rows[0]?.n ?? 0);
    }

    beforeAll(async () => {
        pool = new pg.Pool({ connectionString: DATABASE_URL });
        await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');

        // Discovered, never a hardcoded list — a hardcoded one has silently rotted twice in this service.
        for (const file of readdirSync(migrationsDir)
            .filter((name) => name.endsWith('.sql'))
            .sort()) {
            await pool.query(readFileSync(join(migrationsDir, file), 'utf-8'));
        }

        process.env['DATABASE_URL'] = DATABASE_URL;
        process.env['USDA_API_KEY'] = 'integration-dummy-key';
        process.env['FOOD_SOURCE_RATE_LIMIT_PER_HOUR'] = String(HARD_CAP);
        process.env['CLERK_JWT_KEY'] = 'PEM';
        process.env['CLERK_AUTHORIZED_PARTIES'] = 'https://app.example.com';
        process.env['NODE_ENV'] = 'test';

        const { AppModule } = await import('../src/app.module.js');
        // `abortOnError: false` so a DI failure is a test failure rather than "Worker exited unexpectedly".
        app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
        await app.listen(0);
        baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    });

    afterAll(async () => {
        await app?.close();
        await pool?.end();
    });

    beforeEach(async () => {
        await pool.query('TRUNCATE food, food_sources, source_call_log RESTART IDENTITY CASCADE');
        upstream.mode = 'hits';
        upstream.calls = [];
        mockVerify.mockReset();
        mockVerify.mockImplementation((async (_token: unknown, options: unknown) => {
            const raw = (options as { token?: string } | undefined)?.token;
            void raw;

            return { sub: 'user_1', userId: USER_ULID, scopes: [], permissions: [] };
        }) as unknown as typeof verifyClerkToken);
    });

    describe('the reserved interactive lane, end to end (F-W1, FR-019)', () => {
        it('is ADMITTED at the drain’s ceiling — the reserve is real, and the call lands on the right lane', async () => {
            // The window sits exactly at the 90% pause threshold, spent entirely by the background drain.
            await seedWindow('worker', WORKER_CEILING);

            const response = await search('broccoli');

            // ⛔ THE mutation. Charge `'worker'` in `LiveFoodSearchService.attemptSource` and this is a 503:
            // the cook is refused with a tenth of the key unspent. No mocked limiter can catch that — the
            // verdict comes from real SQL comparing the aggregate window against a per-lane ceiling.
            expect(response.status).toBe(200);
            expect(upstream.calls).toEqual(['broccoli']);
            // ...and the ledger ATTRIBUTES it, which is the other half: a reserve nobody can measure is a
            // claim rather than a guarantee.
            expect(await laneCount('interactive')).toBe(1);
            expect(await laneCount('worker')).toBe(WORKER_CEILING);
        });

        it('is REFUSED at the hard cap with a 503 + Retry-After, and does not call the source', async () => {
            await seedWindow('worker', HARD_CAP);

            const response = await search('broccoli');

            expect(response.status).toBe(503);
            expect(foodErrorSchema.parse(response.body)).toMatchObject({ code: 'FETCH_UNAVAILABLE' });
            // Charging BEFORE the call is what makes this true: a denied charge spends no quota.
            expect(upstream.calls).toEqual([]);
            expect(await laneCount('interactive')).toBe(0);
        });

        it('charges exactly one call per search, so the lane cannot be drained by one request', async () => {
            await search('broccoli');
            await search('broccoli');

            expect(await laneCount('interactive')).toBe(2);
        });
    });

    describe('the three outcomes a cook must be able to tell apart', () => {
        it('200 with hits — the source found something', async () => {
            const response = await search('broccoli');

            expect(response.status).toBe(200);
            expect(response.body).toEqual({
                results: [{ name: 'Broccoli, raw' }, { name: 'Broccoli, cooked, boiled' }],
            });
        });

        it('200 with an EMPTY list — the source has nothing, which is a success', async () => {
            upstream.mode = 'empty';

            const response = await search('nosuchfoodanywhere');

            // ⛔ Distinct from both failures below. This cook should stop looking; the other two should
            // try again. One status for all three would strand the first.
            expect(response.status).toBe(200);
            expect(response.body).toEqual({ results: [] });
        });

        it('502 SOURCE_UNAVAILABLE on a source 5xx — the source did not answer', async () => {
            upstream.mode = 'server-error';

            const response = await search('broccoli');

            expect(response.status).toBe(502);
            expect(foodErrorSchema.parse(response.body)).toMatchObject({ code: 'SOURCE_UNAVAILABLE' });
        });

        it('502 SOURCE_UNAVAILABLE on a transport timeout', async () => {
            upstream.mode = 'timeout';

            const response = await search('broccoli');

            expect(response.status).toBe(502);
            expect(foodErrorSchema.parse(response.body)).toMatchObject({ code: 'SOURCE_UNAVAILABLE' });
        });

        it('a failed call still SPENT its charge — the source was contacted, so the window must say so', async () => {
            upstream.mode = 'server-error';

            await search('broccoli');

            // Refunding a failed call would let a broken upstream be retried without limit, which is exactly
            // how a client hammering a degraded source burns the shared per-IP key.
            expect(await laneCount('interactive')).toBe(1);
        });
    });

    describe('the identity boundary and the crosswalk (FR-IDN-2)', () => {
        it('never puts the source-native key on the wire', async () => {
            const response = await search('broccoli');

            expect(JSON.stringify(response.body)).not.toContain('171688');
        });

        it('carries OUR internal id for a hit already admitted to the catalog', async () => {
            const foodId = ulid();
            await pool.query(
                `INSERT INTO food (id, name, normalized_name, status) VALUES ($1, 'Broccoli, raw', 'broccoli, raw', 'RESOLVED')`,
                [foodId],
            );
            await pool.query(
                `INSERT INTO food_sources (id, food_id, source, external_key) VALUES ($1, $2, 'usda', '171688')`,
                [ulid(), foodId],
            );

            const response = await search('broccoli');

            expect(response.body).toEqual({
                results: [{ name: 'Broccoli, raw', id: foodId }, { name: 'Broccoli, cooked, boiled' }],
            });
        });
    });

    describe('the boundary', () => {
        it('rejects a query below the search minimum WITHOUT spending the lane', async () => {
            const response = await search('br');

            // ⛔ 400, not an empty 200. An empty page here is indistinguishable from "the source has
            // nothing", and this route spends a shared external quota it must not waste on an unhonourable
            // request (003-FR-010a).
            expect(response.status).toBe(400);
            expect(foodErrorSchema.parse(response.body)).toMatchObject({ code: 'VALIDATION_FAILED' });
            expect(upstream.calls).toEqual([]);
            expect(await laneCount('interactive')).toBe(0);
        });

        it('rejects an unauthenticated caller before it can spend anything', async () => {
            mockVerify.mockImplementation((() => {
                throw new ClerkVerificationError();
            }) as unknown as typeof verifyClerkToken);

            const response = await search('broccoli');

            expect(response.status).toBe(401);
            expect(await laneCount('interactive')).toBe(0);
        });

        it('is routed as its own path, not swallowed by the by-id route', async () => {
            // Declared after `:id`, Nest would bind `search` as a food ULID and answer 400 INVALID_ID.
            const response = await search('broccoli');

            expect(response.status).toBe(200);
        });
    });

    /**
     * ⚠️ **Deliberately the LAST block in this file, and that is not a style choice.** FR-026's 429 failsafe is
     * IN-PROCESS state on the limiter singleton (`markWindowFull` sets a `windowFullUntil` map entry for a
     * 60-second back-off) — `TRUNCATE source_call_log` cannot clear it, and neither can anything else short of
     * waiting out the back-off or rebooting the app. So a case that trips it refuses every later request in
     * the same process.
     *
     * That is the behaviour under test, not a defect: the point of the failsafe is that ONE source `429` backs
     * the whole process off rather than letting each caller rediscover the refusal. It is asserted here at the
     * transport level (a caller sees `503`, not `502`); the back-off's EXPIRY is asserted where the clock is
     * injectable, in `RollingWindowLimiter.integration.test.ts`.
     */
    describe('a source 429 (FR-026) — runs last, because it poisons the process-scoped failsafe', () => {
        it('answers 503 FETCH_UNAVAILABLE, not the 502 a dead source gets', async () => {
            upstream.mode = 'throttled';

            const response = await search('broccoli');

            expect(response.status).toBe(503);
            expect(foodErrorSchema.parse(response.body)).toMatchObject({ code: 'FETCH_UNAVAILABLE' });
        });

        it('then refuses the NEXT caller WITHOUT calling the source again', async () => {
            upstream.mode = 'throttled';
            await search('broccoli');

            upstream.calls = [];
            const second = await search('cabbage');

            expect(second.status).toBe(503);
            expect(upstream.calls).toEqual([]);
        });
    });
});
