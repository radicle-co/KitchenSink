/**
 * HTTP integration suite for `GET /api/v1/foods/search/live` — the ON-DEMAND source search behind the
 * ingredient picker's "Search USDA for '…'" affordance (plan U29), driven over the booted Nest app against
 * a REAL Postgres.
 *
 * ⛔ **The case this suite exists for is that a live search is admitted on the INTERACTIVE lane, by the real
 * rate-limited transport, against the real `source_call_log` and `source_backoff` (ADR-0053 §3, §5).** A mocked
 * limiter returns whatever it was told and would pass either way.
 *
 * `@kitchensink/clerk-verify` is mocked so auth is deterministic. USDA is a loopback stub server
 * (`support/usdaStubServer.ts`) that a case steers — hits, nothing, a 429, a 5xx, a dropped connection — so the
 * REAL client sends real requests through the REAL transport, and "the source was not called" means no request
 * crossed the wire. The limiter, the ledger, the crosswalk, the routing, the guard and the exception filter are the
 * real stack.
 *
 * Boot config sets `FOOD_SOURCE_LIMIT_OVERRIDES` to 10 calls an hour, so the 90% ceiling is 9 — every boundary
 * below is one row apart.
 *
 * @implements FR-010a FR-019 FR-020 FR-026 FR-IDN-2
 */
import 'reflect-metadata';

import type { AddressInfo } from 'node:net';

import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import pg from 'pg';
import { ulid } from 'ulidx';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@kitchensink/clerk-verify', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@kitchensink/clerk-verify')>();

    return { ...actual, verifyClerkToken: vi.fn() };
});

import { ClerkVerificationError, verifyClerkToken } from '@kitchensink/clerk-verify';

import { foodErrorSchema } from '../src/foods/foods.schema.js';
import { makeCatalogFood } from './__fixtures__/catalogFood.js';
import { makePool } from './support/db.js';
import { foodDb, hasTestDatabase } from './support/roleDb.js';
import { startUsdaStubServer, type UsdaStubServer } from './support/usdaStubServer.js';

const mockVerify = vi.mocked(verifyClerkToken);

/** The overridden limit for this suite; its 90% ceiling is 9. */
const HARD_CAP = 10;
const WORKER_CEILING = 9;

const USER_ULID = '01J9ZK8N7QF3B2X4M6T0V5C1AB';

describe.skipIf(!hasTestDatabase)('GET /api/v1/foods/search/live (booted Nest + real Postgres)', () => {
    let app: INestApplication;
    let pool: pg.Pool;
    let baseUrl: string;
    let upstream: UsdaStubServer;

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
        pool = makePool();
        upstream = await startUsdaStubServer();
        // The schema is built ONCE per run by `tests/globalSetup.ts`, with the service's own production runner.
        await foodDb().truncate();

        // The app reads this at boot: the SUBJECT connects as `food_app`, exactly as a deployed task does.
        foodDb().applySubjectEnv();
        process.env['USDA_API_KEY'] = 'integration-dummy-key';
        process.env['USDA_API_BASE_URL'] = upstream.baseUrl;
        process.env['FOOD_SOURCE_LIMIT_OVERRIDES'] = JSON.stringify({
            usda: { requests: HARD_CAP, windowSeconds: 3600 },
        });
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
        await upstream?.close();
        delete process.env['USDA_API_BASE_URL'];
        delete process.env['FOOD_SOURCE_LIMIT_OVERRIDES'];
    });

    beforeEach(async () => {
        // As the OWNER: `food_app` holds DML and no TRUNCATE, which is the difference this tier now proves.
        await foodDb().truncate();
        upstream.mode = 'hits';
        upstream.reset();
        mockVerify.mockReset();
        mockVerify.mockImplementation((async (_token: unknown, options: unknown) => {
            const raw = (options as { token?: string } | undefined)?.token;
            void raw;

            return { sub: 'user_1', userId: USER_ULID, scopes: [], permissions: [] };
        }) as unknown as typeof verifyClerkToken);
    });

    describe('the reserved interactive lane, end to end (F-W1, FR-019)', () => {
        /**
         * ⛔ REWRITTEN for the FR-019 amendment of 2026-09-15 (owner ruling "Up to 900"). It used to assert
         * a `200` at the drain's ceiling — an interactive call spending into the source's final 10%. That
         * is exactly what the ruling retired: our usage of a published limit stops at 90% whoever is
         * spending, because reaching 100% of a third party's cap is how the 429 the reserve exists to
         * avoid gets earned.
         *
         * What survives — and is what this case now proves end to end — is the LANE ATTRIBUTION. The
         * budget is shared, so the cook is served from the headroom below the ceiling and the ledger
         * records which lane spent it. Compose the API's registry on `'worker'` (`foods.module.ts`) and the
         * final two assertions invert; no mocked limiter can catch that, because the verdict comes from
         * real SQL over the real enum.
         */
        it('is admitted BELOW the shared ceiling and the ledger attributes it to the interactive lane', async () => {
            await seedWindow('worker', WORKER_CEILING - 1);

            const response = await search('broccoli');

            expect(response.status).toBe(200);
            expect(upstream.searches).toEqual(['broccoli']);
            expect(await laneCount('interactive')).toBe(1);
            expect(await laneCount('worker')).toBe(WORKER_CEILING - 1);
        });

        /**
         * The other side of the same ruling: at the 90% ceiling the cook is refused too. The hard cap still
         * has a tenth of the key unspent and it STAYS unspent — that headroom is the source's, not ours to
         * dip into because the caller is a human.
         */
        it('⛔ is REFUSED at the 90% ceiling — the last tenth of the key is never ours to spend (FR-019)', async () => {
            await seedWindow('worker', WORKER_CEILING);

            const response = await search('broccoli');

            expect(response.status).toBe(503);
            expect(foodErrorSchema.parse(response.body)).toMatchObject({ code: 'FETCH_UNAVAILABLE' });
            expect(upstream.searches).toEqual([]);
            expect(await laneCount('interactive')).toBe(0);
        });

        /** ⚠️ The BINDING boundary is now the 90% ceiling above, not this one; a window at the hard cap is
         *  a state the limiter no longer lets our own traffic reach. The case is kept because it proves the
         *  refusal holds for a window filled by anything — an operator import, a replayed backlog — not
         *  only by our own accounting. */
        it('is REFUSED at the hard cap with a 503 + Retry-After, and does not call the source', async () => {
            await seedWindow('worker', HARD_CAP);

            const response = await search('broccoli');

            expect(response.status).toBe(503);
            expect(foodErrorSchema.parse(response.body)).toMatchObject({ code: 'FETCH_UNAVAILABLE' });
            // Charging BEFORE the call is what makes this true: a denied charge spends no quota.
            expect(upstream.searches).toEqual([]);
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
            const { id: foodId, itemId } = await makeCatalogFood(pool, { id: ulid(), name: 'Broccoli, raw' });
            await pool.query(
                `INSERT INTO food_sources (id, item_id, source, external_key) VALUES ($1, $2, 'usda', '171688')`,
                [ulid(), itemId],
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
            expect(upstream.searches).toEqual([]);
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
     * FR-026 as ADR-0053 §5 amends it: ONE source `429` writes a block to `source_backoff`, which every task reads at
     * admission, so no caller rediscovers the refusal one request at a time. The block is a row, so `truncate()`
     * clears it between cases; its duration is asserted in `tests/e2e/sourceAdmission.e2e.test.ts`.
     */
    describe('a source 429 (FR-026)', () => {
        it('answers 503 FETCH_UNAVAILABLE, not the 502 a dead source gets', async () => {
            upstream.mode = 'throttled';

            const response = await search('broccoli');

            expect(response.status).toBe(503);
            expect(foodErrorSchema.parse(response.body)).toMatchObject({ code: 'FETCH_UNAVAILABLE' });
        });

        it('then refuses the NEXT caller WITHOUT calling the source again', async () => {
            upstream.mode = 'throttled';
            await search('broccoli');

            upstream.reset();
            const second = await search('cabbage');

            expect(second.status).toBe(503);
            expect(upstream.searches).toEqual([]);
            const { rows } = await pool.query<{ reason: string }>(`SELECT reason FROM source_backoff`);
            expect(rows).toEqual([{ reason: 'rateLimited' }]);
        });
    });
});
