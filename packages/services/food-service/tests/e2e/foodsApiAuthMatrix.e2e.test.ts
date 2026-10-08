/**
 * Per-endpoint + auth-matrix HTTP integration tests for the source-agnostic `/api/v1/foods/*` API, driven
 * over the booted Nest app against a REAL Postgres, as `food_app` (ADR-0039). Re-added in Phase 3/4 (T-130–T-145)
 * to replace the superseded fdcId-keyed `foods-api.integration.test` parked in the prior slice.
 *
 * `@kitchensink/clerk-verify` is mocked so the auth matrix is deterministic (no real Clerk JWT): a token
 * string maps to a verified principal, an unknown token throws (→ 401). `@kitchensink/usda-client` is
 * mocked so `PATCH`-resolve re-fetches a canned candidate without a real USDA call. Everything else —
 * routing, the guard, the DAOs, the merge/persist, the enqueue — is the real wired stack.
 *
 * Boot config: `FOOD_DEMOTE_THRESHOLD=2` (drain-order demotion),
 * `FOOD_SOURCE_LIMIT_OVERRIDES` (USDA at 5 calls an hour, so the resolve ceiling is 4). The guard reads `CLERK_JWT_KEY` at boot.
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

vi.mock('@kitchensink/usda-client', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@kitchensink/usda-client')>();

    /**
     * A canned USDA client that still sends ONE request per call through the `fetch` it is given, as the real client
     * does: that `fetch` is the rate-limited transport (ADR-0053 §3), so every call is admitted against the real
     * `source_call_log`. The request is a `data:` URL, answered in-process with no network.
     */
    class FakeUsdaApiClient {
        private readonly fetchFn: typeof fetch;

        public constructor(options: { readonly fetchFn: typeof fetch }) {
            this.fetchFn = options.fetchFn;
        }

        public async searchFoods(): Promise<{ foods: unknown[] }> {
            await this.fetchFn('data:application/json,{}');

            return { foods: [] };
        }

        public async getFood(fdcId: number): Promise<Record<string, unknown>> {
            await this.fetchFn('data:application/json,{}');

            return {
                fdcId,
                description: fdcId === 171688 ? 'Broccoli, raw' : 'Broccoli, cooked, boiled',
                dataType: 'Foundation',
                brandOwner: null,
                brandName: null,
                gtinUpc: null,
                foodNutrients: [{ nutrientName: 'Protein', unitName: 'g', value: 2.8 }],
                // Total on the real client's `UsdaFoodDetail`: `[]` when USDA publishes no curated
                // aliases, never absent (U2). A double that omits it lies about the contract it doubles —
                // and did, until `sanitizeCandidates` iterated it and this suite went 500.
                additionalDescriptions: [],
                publicationDate: '2021-05-01',
                raw: {},
            };
        }

        public async getFoodsBatch(): Promise<unknown[]> {
            await this.fetchFn('data:application/json,{}');

            return [];
        }
    }

    return { ...actual, UsdaApiClient: FakeUsdaApiClient };
});

import { ClerkVerificationError, verifyClerkToken } from '@kitchensink/clerk-verify';

// The PUBLISHED typed error union (`@kitchensink/schema-food`'s `foodErrorSchema`, authored in the service). Error
// bodies are parsed against it rather than field-picked, so a shape the contract cannot describe fails here.
import { foodErrorSchema } from '../../src/foods/foods.schema.js';
import { makeCatalogFood } from '../__fixtures__/catalogFood.js';
import { makePool } from '../support/db.js';
import { foodDb } from '../support/roleDb.js';

const mockVerify = vi.mocked(verifyClerkToken);

/**
 * App-user ULIDs (from each user token's `external_id`) — THE requester key post-CR-002/U1. A user
 * principal keys `fetch_requesters` on its ULID; a service (`svc_*`) principal keys on its `svc_*` id.
 */
const USER_ULID = '01J9ZK8N7QF3B2X4M6T0V5C1AB';
const ADMIN_ULID = '01J9ZK8N7QF3B2X4M6T0V5C1AD';
const FLOODER_ULID = '01J9ZK8N7QF3B2X4M6T0V5C1AF';

/** Token → principal map for the deterministic auth matrix; an unknown token throws (→ 401). */
function principalFor(token: string): {
    sub: string;
    userId?: string;
    azp?: string;
    scopes: string[];
    permissions: string[];
    testPrincipal: boolean;
} {
    switch (token) {
        case 'user':
            return { sub: 'user_1', userId: USER_ULID, scopes: [], permissions: [], testPrincipal: false };
        case 'admin':
            return {
                sub: 'admin_1',
                userId: ADMIN_ULID,
                scopes: ['food:admin'],
                permissions: [],
                testPrincipal: false,
            };
        case 'm2m':
            return { sub: 'svc_import', azp: 'svc-client', scopes: [], permissions: [], testPrincipal: false };
        case 'flooder':
            return { sub: 'flooder_clerk', userId: FLOODER_ULID, scopes: [], permissions: [], testPrincipal: false };
        case 'user_nosync':
            // A verified user token whose external_id has not been backfilled yet (first-token race):
            // no `userId`, and the sub is not `svc_*` → the enqueue paths DEFER (CR-002/U1).
            return { sub: 'user_2', scopes: [], permissions: [], testPrincipal: false };
        default:
            throw new ClerkVerificationError();
    }
}

describe('/api/v1/foods/* HTTP API (booted Nest + real Postgres)', () => {
    let app: INestApplication;
    let pool: pg.Pool;
    let baseUrl: string;

    /** Issue a request; omit `token` for an unauthenticated call. */
    async function call(
        method: string,
        path: string,
        opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {},
    ): Promise<{ status: number; body: unknown; headers: Headers }> {
        const headers: Record<string, string> = { ...opts.headers };

        if (opts.token) {
            headers['authorization'] = `Bearer ${opts.token}`;
        }

        if (opts.body !== undefined) {
            headers['content-type'] = 'application/json';
        }

        const response = await fetch(`${baseUrl}${path}`, {
            method,
            headers,
            body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        });
        const text = await response.text();

        return { status: response.status, body: text ? JSON.parse(text) : undefined, headers: response.headers };
    }

    /** Seed a bare `food` row at a given status; returns its id. */
    async function seedFood(status: string, name: string): Promise<string> {
        const { id } = await makeCatalogFood(pool, {
            id: ulid(),
            name,
            status,
            tombstonedAt: status === 'NOT_FOUND' || status === 'FAILED' ? new Date() : null,
        });

        return id;
    }

    /** Seed a full RESOLVED golden record (food + crosswalk + nutrient + value + field provenance). */
    async function seedResolved(name: string, externalKey = '171688'): Promise<string> {
        const id = await seedFood('RESOLVED', name);
        const sourceId = ulid();
        const nutrientId = ulid();
        await pool.query(
            `INSERT INTO food_sources (id, item_id, source, external_key)
             VALUES ($1, (SELECT item_id FROM food WHERE id = $2), 'usda', $3)`,
            [sourceId, id, externalKey],
        );
        // The nutrient dictionary is shared (one row per (name, unit)) and the service only inserts into it
        // (KTD-14): insert when absent, then resolve the id, so seeding several RESOLVED foods does not collide.
        await pool.query(`INSERT INTO nutrient (id, name, unit) VALUES ($1, 'Protein', 'g') ON CONFLICT DO NOTHING`, [
            nutrientId,
        ]);
        const dict = await pool.query<{ id: string }>(`SELECT id FROM nutrient WHERE name = 'Protein' AND unit = 'g'`);
        const nutritionId = ulid();
        const citationId = ulid();
        await pool.query('INSERT INTO food_nutrition (id, food_id) VALUES ($1, $2)', [nutritionId, id]);
        await pool.query(
            `INSERT INTO food_nutrition_citation (id, nutrition_id, dataset, external_key, match)
             VALUES ($1, $2, 'usdaSrFoundation', $3, 'exact')`,
            [citationId, nutritionId, externalKey],
        );
        await pool.query(
            `INSERT INTO food_nutrition_value (nutrition_id, nutrient_id, amount, basis, citation_id)
             VALUES ($1, $2, '2.8', 'per_100g', $3)`,
            [nutritionId, dict.rows[0]!.id, citationId],
        );
        await pool.query(
            `INSERT INTO food_field_provenance (item_id, field, source_id)
             VALUES ((SELECT item_id FROM food WHERE id = $1), 'name', $2)`,
            [id, sourceId],
        );

        return id;
    }

    /** Seed an UNRESOLVED food with a candidate set; returns the food id + candidate ids. */
    async function seedUnresolved(
        name: string,
        keys: readonly [string, string] = ['171688', '170379'],
    ): Promise<{ id: string; candidateIds: string[] }> {
        const id = await seedFood('UNRESOLVED', name);
        const c1 = ulid();
        const c2 = ulid();
        await pool.query(
            `INSERT INTO food_candidates (id, food_id, source, external_key, name, summary) VALUES
             ($1, $2, 'usda', $4, 'Broccoli, raw', '34 kcal/100g'),
             ($3, $2, 'usda', $5, 'Broccoli, cooked, boiled', '35 kcal/100g')`,
            [c1, id, c2, keys[0], keys[1]],
        );

        return { id, candidateIds: [c1, c2] };
    }

    /** Seed `count` pending queue rows all requested by `requesterId` (intake and demotion fixtures). */
    async function seedPendingQueue(count: number, requesterId: string): Promise<void> {
        for (let i = 0; i < count; i += 1) {
            const id = await seedFood('PENDING', `pending food ${requesterId} ${i}`);
            await pool.query(`INSERT INTO fetch_queue (food_id, status) VALUES ($1, 'pending')`, [id]);
            await pool.query(`INSERT INTO fetch_requesters (food_id, requester_id) VALUES ($1, $2)`, [id, requesterId]);
        }
    }

    beforeAll(async () => {
        pool = makePool();
        // The schema is built ONCE per run by `tests/globalSetup.ts`, with the service's own production
        // runner — migration discovery plus the lock, the privilege statements and the ownership audit a
        // hand-rolled replay would skip.
        await foodDb().truncate();

        // The app reads this at boot: the SUBJECT connects as `food_app`, exactly as a deployed task does.
        foodDb().applySubjectEnv();
        process.env['USDA_API_KEY'] = 'integration-dummy-key';
        process.env['FOOD_SOURCE_LIMIT_OVERRIDES'] = JSON.stringify({ usda: { requests: 5, windowSeconds: 3600 } });
        process.env['CLERK_JWT_KEY'] = 'PEM';
        process.env['CLERK_AUTHORIZED_PARTIES'] = 'https://app.example.com';
        process.env['FOOD_DEMOTE_THRESHOLD'] = '2';
        // The test plays the ALB: one trusted hop, so the shedder keys on the rightmost `X-Forwarded-For` entry.
        process.env['FOOD_TRUSTED_PROXY_HOPS'] = '1';
        process.env['NODE_ENV'] = 'test';

        const { AppModule } = await import('../../src/app.module.js');
        // ⚠️ `abortOnError: false` is LOAD-BEARING, not tidiness. Nest's default handler answers a DI
        // failure with `process.abort()`, which vitest can only report as "Worker exited unexpectedly" —
        // so a module that cannot boot AT ALL looks exactly like flake. It hid a missing `FetchQueueDao`
        // provider (U9) through a whole review round. With this flag the boot error is the test failure.
        app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
        await app.listen(0);
        const address = app.getHttpServer().address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${address.port}`;
    });

    afterAll(async () => {
        await app?.close();
        await pool?.end();
        delete process.env['FOOD_SOURCE_LIMIT_OVERRIDES'];
    });

    beforeEach(async () => {
        // As the OWNER: `food_app` holds DML and no TRUNCATE, which is the difference this tier now proves.
        await foodDb().truncate();
        mockVerify.mockReset();
        mockVerify.mockImplementation(async (token: string) => principalFor(token));
    });

    // ── Auth matrix (T-033/T-047/T-048) ───────────────────────────────────────────────────────────
    describe('auth gate', () => {
        it('rejects a request with no token (401) before any work (FR-035)', async () => {
            const res = await call('GET', `/api/v1/foods/${ulid()}`);
            expect(res.status).toBe(401);
        });

        it('rejects an invalid/expired/wrong-azp token (401)', async () => {
            const res = await call('GET', `/api/v1/foods/${ulid()}`, { token: 'garbage' });
            expect(res.status).toBe(401);
        });

        it('does NOT create a row or enqueue for an unauthenticated POST (401, no side effects)', async () => {
            const res = await call('POST', '/api/v1/foods', { body: { name: 'broccoli' } });
            expect(res.status).toBe(401);

            const rows = await pool.query('SELECT count(*)::int AS n FROM food');
            expect(rows.rows[0].n).toBe(0);
            const queue = await pool.query('SELECT count(*)::int AS n FROM fetch_queue');
            expect(queue.rows[0].n).toBe(0);
        });

        /**
         * Rewritten for the trusted-hop key (S4 security review F8). The ALB appends the address it saw, so the
         * attacker writes only the entries to its left. Rotating them no longer escapes the shedder: every request
         * fails closed (401, then 503 once the source is shed), and a different real client is still served and
         * still writes its row. The bucket-cardinality bound is asserted in `src/auth/__tests__/AuthLoadShedder.test.ts`.
         */
        it('fails closed under a flood that rotates its client-written key, and keeps serving another client', async () => {
            const statuses: number[] = [];

            for (let i = 0; i < 250; i += 1) {
                const res = await call('GET', `/api/v1/foods/${ulid()}`, {
                    token: 'garbage',
                    headers: { 'x-forwarded-for': `192.0.2.${i % 256}-${i}, 203.0.113.66` },
                });
                statuses.push(res.status);
            }

            expect(statuses.every((status) => status === 401 || status === 503)).toBe(true);
            expect(statuses.at(-1)).toBe(503);

            const served = await call('POST', '/api/v1/foods', {
                token: 'user',
                body: { name: 'after the flood' },
                headers: { 'x-forwarded-for': '198.51.100.4' },
            });
            expect(served.status).toBe(202);
            expect((await pool.query('SELECT count(*)::int AS n FROM food')).rows[0].n).toBe(1);
        });

        it('ignores a forged x-debug-sub / x-authorizer-context and keys provenance on the app-user ULID', async () => {
            const res = await call('POST', '/api/v1/foods', {
                token: 'user',
                body: { name: 'forge test' },
                headers: { 'x-debug-sub': 'forged_admin', 'x-authorizer-context': '{"sub":"forged_admin"}' },
            });
            expect(res.status).toBe(202);

            // CR-002/U1: the requester is the verified app-user ULID (external_id), NEVER the Clerk sub.
            const requesters = await pool.query('SELECT requester_id FROM fetch_requesters');
            expect(requesters.rows.map((r) => r.requester_id)).toEqual([USER_ULID]);
        });

        it('accepts an azp-allowlisted M2M token and keys provenance on its svc_* id (FR-047)', async () => {
            const res = await call('POST', '/api/v1/foods', { token: 'm2m', body: { name: 'service add' } });
            expect(res.status).toBe(202);

            const requesters = await pool.query('SELECT requester_id FROM fetch_requesters');
            expect(requesters.rows.map((r) => r.requester_id)).toEqual(['svc_import']);
        });

        it('DEFERS a user enqueue with 401 when external_id has not synced yet, recording no row (CR-002/U1)', async () => {
            const res = await call('POST', '/api/v1/foods', { token: 'user_nosync', body: { name: 'pre-sync add' } });
            expect(res.status).toBe(401);

            // No food, no queue row, no requester — the raw sub is NEVER recorded.
            const foods = await pool.query('SELECT count(*)::int AS n FROM food');
            expect(foods.rows[0].n).toBe(0);
            const requesters = await pool.query('SELECT count(*)::int AS n FROM fetch_requesters');
            expect(requesters.rows[0].n).toBe(0);
        });

        it('enforces precedence 401 > 400: a malformed id with a bad token → 401 (not 400)', async () => {
            const res = await call('GET', '/api/v1/foods/not-a-ulid', { token: 'garbage' });
            expect(res.status).toBe(401);
        });

        it('enforces precedence 403 > 400 on /refetch: valid token w/o scope + malformed id → 403', async () => {
            const res = await call('POST', '/api/v1/foods/not-a-ulid/refetch', { token: 'user' });
            expect(res.status).toBe(403);
        });
    });

    // ── GET /api/v1/foods/{id} (T-131) ─────────────────────────────────────────────────────────────────
    describe('GET /api/v1/foods/{id}', () => {
        it('returns 200 + the golden record (no source call) for a RESOLVED food', async () => {
            const id = await seedResolved('Broccoli, raw');

            const res = await call('GET', `/api/v1/foods/${id}`, { token: 'user' });

            expect(res.status).toBe(200);
            const body = res.body as {
                id: string;
                status: string;
                nutrients: unknown[];
                provenance: Record<string, string>;
            };
            expect(body.id).toBe(id);
            expect(body.status).toBe('RESOLVED');
            expect(body.nutrients).toEqual([
                { nutrient: 'Protein', amount: 2.8, unit: 'g', basis: 'per_100g', source: 'usda' },
            ]);
            expect(body.provenance).toEqual({ name: 'usda' });
            expect(JSON.stringify(body)).not.toContain('fdcId');
        });

        it('returns 202 for a PENDING food', async () => {
            const id = await seedFood('PENDING', 'pending food');
            const res = await call('GET', `/api/v1/foods/${id}`, { token: 'user' });
            expect(res.status).toBe(202);
            expect((res.body as { status: string }).status).toBe('PENDING');
        });

        it('returns 202 for an UNRESOLVED food', async () => {
            const { id } = await seedUnresolved('broccoli');
            const res = await call('GET', `/api/v1/foods/${id}`, { token: 'user' });
            expect(res.status).toBe(202);
            expect((res.body as { status: string }).status).toBe('UNRESOLVED');
        });

        // The terminal status moved from a TOP-LEVEL `body.status` (the pre-2026-08-12 controller shape) into
        // `details.status` of the one envelope, and it is parsed against the PUBLISHED typed union here rather
        // than field-picked — so a body the schema package cannot describe fails this test over a real request.
        it.each([
            ['NOT_FOUND', 'ghost food'],
            ['FAILED', 'failed food'],
        ])('returns 404 FOOD_NOT_FOUND with %s in details, over a real request', async (status, name) => {
            const id = await seedFood(status as 'NOT_FOUND' | 'FAILED', name);
            const res = await call('GET', `/api/v1/foods/${id}`, { token: 'user' });

            expect(res.status).toBe(404);
            const body = foodErrorSchema.parse(res.body);
            expect(body.code).toBe('FOOD_NOT_FOUND');
            expect(body.code === 'FOOD_NOT_FOUND' && body.details).toEqual({ id, status });
        });

        it('returns 404 FOOD_NOT_FOUND with no status for an unknown id', async () => {
            const unknownId = ulid();
            const res = await call('GET', `/api/v1/foods/${unknownId}`, { token: 'user' });

            expect(res.status).toBe(404);
            const body = foodErrorSchema.parse(res.body);
            expect(body.code === 'FOOD_NOT_FOUND' && body.details).toEqual({ id: unknownId });
        });

        it('returns 400 INVALID_ID for a malformed ULID (with a valid token)', async () => {
            const res = await call('GET', '/api/v1/foods/not-a-ulid', { token: 'user' });

            expect(res.status).toBe(400);
            expect(foodErrorSchema.parse(res.body).code).toBe('INVALID_ID');
        });

        /**
         * T-199(b), SC-004/SC-005 — the local-store serve rate must be observable IN SERVICE, not only
         * under k6. Asserted through the real wired stack (guard → controller → service → DAO) because the
         * defect being fixed was a wiring gap: the metric name existed and was unit-tested, but nothing in
         * the running app ever emitted it. Reads the EMF line off `console.log`, which is the production
         * sink (CloudWatch auto-extracts it from the task log group — no `PutMetricData`, no extra IAM).
         */
        describe('local-store serve-rate EMF metric (SC-004/SC-005)', () => {
            /** One EMF record CloudWatch would extract from the task's stdout. */
            interface EmfLine {
                readonly _aws: {
                    readonly CloudWatchMetrics: readonly {
                        readonly Namespace: string;
                        readonly Metrics: readonly { readonly Name: string; readonly Unit: string }[];
                    }[];
                };
                readonly [key: string]: unknown;
            }

            /**
             * The serve-rate EMF records the running service emitted while `run` executed.
             *
             * `console.log` IS the production sink (the emitter resolves it per call, so a spy installed
             * after the app booted still fires), and it is the right boundary to assert on here: under
             * vitest `globalThis.console` is replaced with a Console over the runner's own stream, so
             * spying `process.stdout.write` observes nothing — the first attempt captured zero lines. What
             * CloudWatch reads from that line is covered by the EMF-shape unit suite.
             */
            async function serveRateRecords(run: () => Promise<unknown>): Promise<EmfLine[]> {
                const lines: string[] = [];
                const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]): void => {
                    lines.push(String(args[0]));
                });

                try {
                    await run();
                } finally {
                    spy.mockRestore();
                }

                return lines
                    .filter((line) => line.includes('food-local-store-serve-rate'))
                    .map((line) => JSON.parse(line) as EmfLine);
            }

            /** The serve-rate observation values (100 served / 0 not) emitted while `run` executed. */
            async function serveRateValues(run: () => Promise<unknown>): Promise<number[]> {
                return (await serveRateRecords(run)).map((record) => record['food-local-store-serve-rate'] as number);
            }

            it('emits 100 for a 200 golden-record read and 0 for a read the store cannot serve', async () => {
                const resolved = await seedResolved('Broccoli, raw');
                const pending = await seedFood('PENDING', 'pending food');

                const served = await serveRateValues(() => call('GET', `/api/v1/foods/${resolved}`, { token: 'user' }));
                const unserved = await serveRateValues(() =>
                    call('GET', `/api/v1/foods/${pending}`, { token: 'user' }),
                );

                expect(served).toEqual([100]);
                expect(unserved).toEqual([0]);
            });

            it('emits it in the Commise/Food namespace with the Percent unit CloudWatch averages', async () => {
                const resolved = await seedResolved('Broccoli, raw', '171689');

                const [record] = await serveRateRecords(() =>
                    call('GET', `/api/v1/foods/${resolved}`, { token: 'user' }),
                );

                expect(record).toBeDefined();
                expect(record!._aws.CloudWatchMetrics[0]!.Namespace).toBe('Commise/Food');
                expect(record!._aws.CloudWatchMetrics[0]!.Metrics).toEqual([
                    { Name: 'food-local-store-serve-rate', Unit: 'Percent' },
                ]);
            });

            it('does NOT emit on the status poll or search — neither can ever call a source (no tautology)', async () => {
                const resolved = await seedResolved('Broccoli, raw', '171690');

                const fromStatus = await serveRateValues(() =>
                    call('GET', `/api/v1/foods/${resolved}/status`, { token: 'user' }),
                );
                const fromSearch = await serveRateValues(() =>
                    call('GET', '/api/v1/foods/search?query=broccoli', { token: 'user' }),
                );

                expect(fromStatus).toEqual([]);
                expect(fromSearch).toEqual([]);
            });
        });
    });

    // ── GET /api/v1/foods/{id}/status (T-132) ──────────────────────────────────────────────────────────
    describe('GET /api/v1/foods/{id}/status', () => {
        it('returns the status + golden record for a RESOLVED food', async () => {
            const id = await seedResolved('Broccoli, raw');
            const res = await call('GET', `/api/v1/foods/${id}/status`, { token: 'user' });
            expect(res.status).toBe(200);
            const body = res.body as { status: string; food?: unknown };
            expect(body.status).toBe('RESOLVED');
            expect(body.food).toMatchObject({
                id,
                status: 'RESOLVED',
                name: 'Broccoli, raw',
                nutrients: [{ nutrient: 'Protein', amount: 2.8, unit: 'g', basis: 'per_100g', source: 'usda' }],
                portions: [],
                provenance: { name: 'usda' },
            });
        });

        it('returns the status (no food) for a PENDING food and 404 for an unknown id', async () => {
            const id = await seedFood('PENDING', 'pending poll');
            const ok = await call('GET', `/api/v1/foods/${id}/status`, { token: 'user' });
            expect(ok.status).toBe(200);
            expect((ok.body as { status: string; food?: unknown }).food).toBeUndefined();

            const missing = await call('GET', `/api/v1/foods/${ulid()}/status`, { token: 'user' });
            expect(missing.status).toBe(404);
        });

        it('returns 200 + status only (no food) for NOT_FOUND / FAILED / UNRESOLVED rows', async () => {
            const notFound = await seedFood('NOT_FOUND', 'ghost status');
            const failed = await seedFood('FAILED', 'failed status');
            const { id: unresolved } = await seedUnresolved('broccoli status');

            for (const [id, status] of [
                [notFound, 'NOT_FOUND'],
                [failed, 'FAILED'],
                [unresolved, 'UNRESOLVED'],
            ] as const) {
                const res = await call('GET', `/api/v1/foods/${id}/status`, { token: 'user' });
                expect(res.status).toBe(200);
                const body = res.body as { status: string; food?: unknown };
                expect(body.status).toBe(status);
                expect(body.food).toBeUndefined();
            }
        });
    });

    // ── GET /api/v1/foods/{id}/candidates (T-133) ──────────────────────────────────────────────────────
    describe('GET /api/v1/foods/{id}/candidates', () => {
        it('lists the candidate set for an UNRESOLVED food (no fdcId)', async () => {
            const { id } = await seedUnresolved('broccoli');
            const res = await call('GET', `/api/v1/foods/${id}/candidates`, { token: 'user' });
            expect(res.status).toBe(200);
            const body = res.body as { candidates: { source: string; externalKey: string }[] };
            expect(body.candidates).toHaveLength(2);
            expect(body.candidates[0].source).toBe('usda');
            expect(JSON.stringify(body)).not.toContain('fdcId');
        });

        it('returns an empty candidate set for a RESOLVED food', async () => {
            const id = await seedResolved('Broccoli, raw');
            const res = await call('GET', `/api/v1/foods/${id}/candidates`, { token: 'user' });
            expect(res.status).toBe(200);
            expect((res.body as { candidates: unknown[] }).candidates).toEqual([]);
        });

        it('returns 404 for an unknown id', async () => {
            const res = await call('GET', `/api/v1/foods/${ulid()}/candidates`, { token: 'user' });
            expect(res.status).toBe(404);
        });
    });

    // ── GET /api/v1/foods/search (T-134) ───────────────────────────────────────────────────────────────
    describe('GET /api/v1/foods/search', () => {
        it('returns ranked matches and never an unrelated food', async () => {
            await seedResolved('Chicken breast, raw', '1');
            await seedResolved('Chicken thigh, raw', '2');
            await seedResolved('Beef steak', '3');

            const res = await call('GET', '/api/v1/foods/search?query=chicken%20breast', { token: 'user' });
            expect(res.status).toBe(200);
            const names = (res.body as { results: { name: string }[] }).results.map((r) => r.name);
            expect(names).toContain('Chicken breast, raw');
            expect(names).not.toContain('Beef steak');
        });

        it('fuzzy-matches a misspelled query (avacado → Avocado, raw)', async () => {
            await seedResolved('Avocado, raw', '10');
            await seedResolved('Banana, raw', '11');
            const res = await call('GET', '/api/v1/foods/search?query=avacado', { token: 'user' });
            const names = (res.body as { results: { name: string }[] }).results.map((r) => r.name);
            expect(names).toContain('Avocado, raw');
        });

        it('resolves a known external_key crosswalk to the food id, and empty for no match', async () => {
            const id = await seedResolved('Broccoli, raw', '171688');
            const cross = await call('GET', '/api/v1/foods/search?query=171688', { token: 'user' });
            expect((cross.body as { results: { id: string }[] }).results.map((r) => r.id)).toContain(id);

            const none = await call('GET', '/api/v1/foods/search?query=zzzznotathing', { token: 'user' });
            expect((none.body as { results: unknown[] }).results).toEqual([]);
        });

        it('resolves a known product barcode crosswalk to the food id (FR-008)', async () => {
            const id = await seedResolved('Branded cereal', '900001');
            await pool.query(`UPDATE food SET barcode = $2 WHERE id = $1`, [id, '0123456789012']);

            const res = await call('GET', '/api/v1/foods/search?query=0123456789012', { token: 'user' });
            expect(res.status).toBe(200);
            expect((res.body as { results: { id: string }[] }).results.map((r) => r.id)).toContain(id);
        });

        /**
         * ⚠️ THIS ASSERTION WAS INVERTED, and it had gone stale in the working tree rather than being wrong when
         * written. It expected `200` with an empty result set, which was the behaviour when the controller read a
         * bare `@Query('query') query?: string` and passed `query ?? ''` to the DAO. `searchFoodQuerySchema` is now
         * actually BOUND (`.trim().min(1)`), so a whitespace-only term is a `400` — and that is the point of the
         * change: a caller could not previously tell "no results" from "you sent nothing", and the empty term still
         * cost a full trigram + full-text scan to produce a guaranteed-empty answer.
         */
        it('rejects an empty/whitespace query with 400 VALIDATION_FAILED, naming the field', async () => {
            const res = await call('GET', '/api/v1/foods/search?query=%20%20', { token: 'user' });

            expect(res.status).toBe(400);
            const body = foodErrorSchema.parse(res.body);
            expect(body.code).toBe('VALIDATION_FAILED');
            expect(body.code === 'VALIDATION_FAILED' && body.details.fields.join()).toContain('query');
        });

        it('rejects an absent query with 400, rather than treating it as the empty string', async () => {
            const res = await call('GET', '/api/v1/foods/search', { token: 'user' });

            expect(res.status).toBe(400);
            expect(foodErrorSchema.parse(res.body).code).toBe('VALIDATION_FAILED');
        });
    });

    // ── POST /api/v1/foods (T-140) ─────────────────────────────────────────────────────────────────────
    describe('POST /api/v1/foods', () => {
        it('adds by name → 202 + id, with exactly one fetch_queue row', async () => {
            const res = await call('POST', '/api/v1/foods', { token: 'user', body: { name: 'Broccoli' } });
            expect(res.status).toBe(202);
            const body = res.body as { id: string; status: string };
            expect(body.status).toBe('PENDING');

            const queue = await pool.query('SELECT count(*)::int AS n FROM fetch_queue WHERE food_id = $1', [body.id]);
            expect(queue.rows[0].n).toBe(1);
        });

        it('dedups a concurrent re-add of the same normalized name to one row/id', async () => {
            const first = await call('POST', '/api/v1/foods', { token: 'user', body: { name: 'Spinach' } });
            const second = await call('POST', '/api/v1/foods', { token: 'user', body: { name: '  spinach ' } });
            expect((first.body as { id: string }).id).toBe((second.body as { id: string }).id);

            const foods = await pool.query('SELECT count(*)::int AS n FROM food');
            expect(foods.rows[0].n).toBe(1);
        });

        it('stores the CANONICAL name, not the caller`s bytes, as the shared catalog`s global label', async () => {
            const res = await call('POST', '/api/v1/foods', {
                token: 'user',
                // A bidi override, a fullwidth capital and a zero-width space — invisible or misleading in a
                // picker, and permanent on an ownerless row every user sees (finding 16.A-6 / 23.S-11).
                body: { name: '\u202E\uFF22ro\u200Bccoli,  raw\u202C' },
            });
            expect(res.status).toBe(202);

            const row = await pool.query('SELECT name, normalized_name FROM food WHERE id = $1', [
                (res.body as { id: string }).id,
            ]);
            expect(row.rows[0].name).toBe('Broccoli, raw');
            expect(row.rows[0].normalized_name).toBe('broccoli, raw');
        });

        it('collapses an invisible-character variant onto the SAME row — the dedup key cannot be bypassed', async () => {
            const first = await call('POST', '/api/v1/foods', { token: 'user', body: { name: 'Kale' } });
            const second = await call('POST', '/api/v1/foods', { token: 'user', body: { name: 'Ka\u200Ble' } });

            expect((second.body as { id: string }).id).toBe((first.body as { id: string }).id);
            const foods = await pool.query('SELECT count(*)::int AS n FROM food');
            expect(foods.rows[0].n).toBe(1);
        });

        it('rejects an invisible-only name with 400, nothing written', async () => {
            const res = await call('POST', '/api/v1/foods', { token: 'user', body: { name: '\u200B\u200B\uFEFF' } });
            expect(res.status).toBe(400);
            const foods = await pool.query('SELECT count(*)::int AS n FROM food');
            expect(foods.rows[0].n).toBe(0);
        });

        it('rejects an empty/whitespace name with 400, nothing enqueued', async () => {
            const res = await call('POST', '/api/v1/foods', { token: 'user', body: { name: '   ' } });
            expect(res.status).toBe(400);
            const foods = await pool.query('SELECT count(*)::int AS n FROM food');
            expect(foods.rows[0].n).toBe(0);
        });

        it('re-adds an already-RESOLVED name inline (RESOLVED, no fresh enqueue / no source budget burned)', async () => {
            const seeded = await seedResolved('Already resolved', '700001');

            const res = await call('POST', '/api/v1/foods', { token: 'user', body: { name: 'Already resolved' } });
            expect(res.status).toBe(202);
            const body = res.body as { id: string; status: string; estimatedWaitSeconds?: number };
            expect(body.id).toBe(seeded);
            expect(body.status).toBe('RESOLVED');

            // No queue row created for an existing terminal-non-tombstoned hit (FR-028a no-burn path).
            const queue = await pool.query('SELECT count(*)::int AS n FROM fetch_queue WHERE food_id = $1', [seeded]);
            expect(queue.rows[0].n).toBe(0);
        });
    });

    // ── POST /api/v1/foods/batch (T-143) ───────────────────────────────────────────────────────────────
    describe('POST /api/v1/foods/batch', () => {
        it('returns a per-item partial: inline RESOLVED hits + PENDING misses', async () => {
            await seedResolved('Chicken breast, raw', '1');

            const res = await call('POST', '/api/v1/foods/batch', {
                token: 'user',
                body: { names: ['Chicken breast, raw', 'Quinoa', 'Lentils'] },
            });
            expect(res.status).toBe(201);
            const items = (res.body as { items: { status: string }[] }).items;
            expect(items.filter((i) => i.status === 'RESOLVED')).toHaveLength(1);
            expect(items.filter((i) => i.status === 'PENDING')).toHaveLength(2);
        });

        it('collapses an intra-batch duplicate name to one item', async () => {
            const res = await call('POST', '/api/v1/foods/batch', {
                token: 'user',
                body: { names: ['Kale', 'kale', '  KALE '] },
            });
            expect((res.body as { items: unknown[] }).items).toHaveLength(1);
        });

        it('rejects a batch over 100 names with 400, nothing enqueued', async () => {
            const names = Array.from({ length: 101 }, (_, i) => `food ${i}`);
            const res = await call('POST', '/api/v1/foods/batch', { token: 'user', body: { names } });
            expect(res.status).toBe(400);
            const foods = await pool.query('SELECT count(*)::int AS n FROM food');
            expect(foods.rows[0].n).toBe(0);
        });
    });

    // ── PATCH /api/v1/foods/{id} (T-142) ───────────────────────────────────────────────────────────────
    describe('PATCH /api/v1/foods/{id}', () => {
        it('resolves from a valid pick → 200 RESOLVED and clears the candidate set', async () => {
            const { id, candidateIds } = await seedUnresolved('broccoli');

            const res = await call('PATCH', `/api/v1/foods/${id}`, {
                token: 'user',
                body: { candidateIds: [candidateIds[0]] },
            });
            expect(res.status).toBe(200);
            expect((res.body as { status: string }).status).toBe('RESOLVED');

            const food = await pool.query('SELECT status FROM food WHERE id = $1', [id]);
            expect(food.rows[0].status).toBe('RESOLVED');
            const remaining = await pool.query('SELECT count(*)::int AS n FROM food_candidates WHERE food_id = $1', [
                id,
            ]);
            expect(remaining.rows[0].n).toBe(0);
        });

        it('rejects a candidate not in the food set with 409, status unchanged', async () => {
            const { id } = await seedUnresolved('broccoli');
            const res = await call('PATCH', `/api/v1/foods/${id}`, { token: 'user', body: { candidateIds: [ulid()] } });
            expect(res.status).toBe(409);
            const food = await pool.query('SELECT status FROM food WHERE id = $1', [id]);
            expect(food.rows[0].status).toBe('UNRESOLVED');
        });

        it('is an idempotent 200 no-op on an already-RESOLVED food', async () => {
            const id = await seedResolved('Broccoli, raw');
            const res = await call('PATCH', `/api/v1/foods/${id}`, { token: 'user', body: { candidateIds: [ulid()] } });
            expect(res.status).toBe(200);
            expect((res.body as { status: string }).status).toBe('RESOLVED');
        });

        it('rejects a repeated pick with 400 before any source call, status unchanged (security review C2)', async () => {
            const { id, candidateIds } = await seedUnresolved('broccoli');
            const pick = candidateIds[0];
            const calls = async (): Promise<number> =>
                (await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM source_call_log')).rows[0]?.n ?? -1;
            const before = await calls();

            const res = await call('PATCH', `/api/v1/foods/${id}`, {
                token: 'user',
                body: { candidateIds: [pick, pick] },
            });

            expect(res.status).toBe(400);
            expect(await calls()).toBe(before);
            const food = await pool.query('SELECT status FROM food WHERE id = $1', [id]);
            expect(food.rows[0].status).toBe('UNRESOLVED');
        });

        it('rejects a malformed body (no candidateIds) with 400', async () => {
            const { id } = await seedUnresolved('broccoli');
            const res = await call('PATCH', `/api/v1/foods/${id}`, { token: 'user', body: {} });
            expect(res.status).toBe(400);
        });

        it('rejects a resolve on a PENDING (not-awaiting-disambiguation) food with 409 (NotResolvableError)', async () => {
            const id = await seedFood('PENDING', 'pending resolve');
            const res = await call('PATCH', `/api/v1/foods/${id}`, { token: 'user', body: { candidateIds: [ulid()] } });
            expect(res.status).toBe(409);
            const food = await pool.query('SELECT status FROM food WHERE id = $1', [id]);
            expect(food.rows[0].status).toBe('PENDING');
        });

        it('returns 404 when resolving an unknown id', async () => {
            const res = await call('PATCH', `/api/v1/foods/${ulid()}`, {
                token: 'user',
                body: { candidateIds: [ulid()] },
            });
            expect(res.status).toBe(404);
        });

        it('returns 503 (not 429) when the rolling-window cap is exhausted; food stays UNRESOLVED (DSN-6)', async () => {
            const { id, candidateIds } = await seedUnresolved('broccoli');
            // Fill the USDA window past its ceiling of 4, so admission refuses for longer than resolve will wait.
            await pool.query(
                `INSERT INTO source_call_log (source, called_at) SELECT 'usda', now() FROM generate_series(1, 5)`,
            );

            const res = await call('PATCH', `/api/v1/foods/${id}`, {
                token: 'user',
                body: { candidateIds: [candidateIds[0]] },
            });
            expect(res.status).toBe(503);
            expect(res.headers.get('retry-after')).toBeTruthy();
            const food = await pool.query('SELECT status FROM food WHERE id = $1', [id]);
            expect(food.rows[0].status).toBe('UNRESOLVED');
        });

        /**
         * ⛔ REWRITTEN for the FR-019 amendment of 2026-09-15 (owner ruling "Up to 900"). It used to assert
         * that resolve "still proceeds at the 90% pause threshold" — the interactive lane spending into the
         * source's final 10% while the drain was shut out. The ruling retired that: 90% binds BOTH lanes,
         * because reaching 100% of a published limit is how the 429 the reserve exists to avoid is earned.
         *
         * Resolve is still exempt from what the ruling did NOT change — it never consults the drain's
         * `isPaused` and is never flood-shed (FR-043b) — so it keeps working right up to the shared
         * ceiling. That is what this case now pins: admitted one call below it, refused at it, with
         * FR-RES-2's `503` + `Retry-After` and the food left `UNRESOLVED` for retry.
         */
        it("resolves right up to the shared 90% ceiling, then returns FR-RES-2's 503 at it", async () => {
            const belowCeiling = await seedUnresolved('broccoli');
            // Ceiling = floor(5 * 0.9) = 4; three prior calls leave exactly one slot.
            await pool.query(
                `INSERT INTO source_call_log (source, called_at) SELECT 'usda', now() FROM generate_series(1, 3)`,
            );

            const admitted = await call('PATCH', `/api/v1/foods/${belowCeiling.id}`, {
                token: 'user',
                body: { candidateIds: [belowCeiling.candidateIds[0]] },
            });
            expect(admitted.status).toBe(200);
            expect((admitted.body as { status: string }).status).toBe('RESOLVED');

            // That resolve's own re-fetch took the last slot, so the window now sits AT the ceiling. The second food
            // offers items of its OWN: the first resolve now holds 171688, and a pick of a held item resolves to its
            // holder with no source call (FOOD-SERVICE-6), so it would never reach the ceiling this case pins.
            const atCeiling = await seedUnresolved('cauliflower', ['169986', '169987']);
            const refused = await call('PATCH', `/api/v1/foods/${atCeiling.id}`, {
                token: 'user',
                body: { candidateIds: [atCeiling.candidateIds[0]] },
            });
            expect(refused.status).toBe(503);
            expect(refused.headers.get('retry-after')).toBeTruthy();
            const food = await pool.query('SELECT status FROM food WHERE id = $1', [atCeiling.id]);
            expect(food.rows[0].status).toBe('UNRESOLVED');
        });

        it('waits ONCE for a refusal that clears within two seconds, then resolves (U27)', async () => {
            const { id, candidateIds } = await seedUnresolved('broccoli');
            // Four calls fill the ceiling; the oldest ages out of the hour one second from now.
            await pool.query(
                `INSERT INTO source_call_log (source, called_at) VALUES
                 ('usda', now() - interval '3599 seconds'), ('usda', now()), ('usda', now()), ('usda', now())`,
            );

            const res = await call('PATCH', `/api/v1/foods/${id}`, {
                token: 'user',
                body: { candidateIds: [candidateIds[0]] },
            });

            expect(res.status).toBe(200);
            expect((res.body as { status: string }).status).toBe('RESOLVED');
        });
    });

    // ── POST /api/v1/foods/{id}/refetch (T-145) ────────────────────────────────────────────────────────
    describe('POST /api/v1/foods/{id}/refetch', () => {
        it('rejects a valid token without the admin scope with 403', async () => {
            const id = await seedResolved('Broccoli, raw');
            const res = await call('POST', `/api/v1/foods/${id}/refetch`, { token: 'user' });
            expect(res.status).toBe(403);
        });

        it('re-enqueues for an admin-scoped token (202)', async () => {
            const id = await seedResolved('Broccoli, raw');
            const res = await call('POST', `/api/v1/foods/${id}/refetch`, { token: 'admin' });
            expect(res.status).toBe(202);

            const queue = await pool.query('SELECT status FROM fetch_queue WHERE food_id = $1', [id]);
            expect(queue.rows[0].status).toBe('pending');
        });

        it('returns 404 for an admin refetch of an unknown id (scope passes, food missing)', async () => {
            const res = await call('POST', `/api/v1/foods/${ulid()}/refetch`, { token: 'admin' });
            expect(res.status).toBe(404);
        });
    });

    // ── POST /api/v1/foods/admin/foods/{id}/requeue (U9) ───────────────────────────────────────────────
    /**
     * The requeue's answers ON THE WIRE. The unit tier proves the service raises the right exception; only a
     * booted app proves the global `ApiExceptionFilter` turns it into the documented status and body —
     * which is exactly where the `RESOLVED` case was wrong (a `500`, because no arm classified the DAO's
     * internal transition error).
     */
    describe('POST /api/v1/foods/admin/foods/{id}/requeue', () => {
        /** The blackholed resting state an operator would find: a tombstoned, FAILED food with a spent budget. */
        async function blackhole(name: string): Promise<string> {
            const id = await seedFood('FAILED', name);
            await pool.query(
                `INSERT INTO fetch_queue (food_id, status, attempts, last_error) VALUES ($1, 'tombstone', 5, 'all_sources_errored')`,
                [id],
            );

            return id;
        }

        it('rejects a valid token without the admin scope with 403', async () => {
            const id = await blackhole('unscoped requeue');
            const res = await call('POST', `/api/v1/foods/admin/foods/${id}/requeue`, { token: 'user' });

            expect(res.status).toBe(403);
        });

        it('requeues a blackholed food for an admin-scoped token (202) and clears BOTH halves', async () => {
            const id = await blackhole('recoverable over http');

            const res = await call('POST', `/api/v1/foods/admin/foods/${id}/requeue`, { token: 'admin' });

            expect(res.status).toBe(202);
            expect(res.body).toStrictEqual({ id, status: 'PENDING' });

            const food = await pool.query('SELECT status FROM food WHERE id = $1', [id]);
            expect(food.rows[0].status).toBe('PENDING');
            const queue = await pool.query('SELECT status, attempts FROM fetch_queue WHERE food_id = $1', [id]);
            expect(queue.rows[0]).toMatchObject({ status: 'pending', attempts: 0 });
        });

        it('returns 400 INVALID_ID for a malformed id', async () => {
            const res = await call('POST', '/api/v1/foods/admin/foods/not-a-ulid/requeue', { token: 'admin' });

            expect(res.status).toBe(400);
            expect((res.body as { code: string }).code).toBe('INVALID_ID');
        });

        it('returns 404 FOOD_NOT_FOUND for an unknown id', async () => {
            const res = await call('POST', `/api/v1/foods/admin/foods/${ulid()}/requeue`, { token: 'admin' });

            expect(res.status).toBe(404);
            expect((res.body as { code: string }).code).toBe('FOOD_NOT_FOUND');
        });

        /**
         * ⛔ THE REGRESSION THIS ROUTE EXISTED WITHOUT. A `RESOLVED`/`UNRESOLVED` food answered `500`, which
         * mid-incident reads as "the requeue failed" — so the operator retries a food that was never stuck.
         * The body must both classify the outcome (`409` + `NOT_REQUEUEABLE`) and name the route that IS
         * right for a healthy food.
         */
        it.each(['RESOLVED', 'UNRESOLVED'])(
            'answers 409 NOT_REQUEUEABLE for a %s food, naming /refetch',
            async (status) => {
                const id = await seedFood(status, `healthy ${status} over http`);

                const res = await call('POST', `/api/v1/foods/admin/foods/${id}/requeue`, { token: 'admin' });

                expect(res.status).toBe(409);

                // Parsed against the PUBLISHED union, not field-picked: a body the contract cannot describe fails.
                const parsed = foodErrorSchema.safeParse(res.body);
                expect(parsed.success, JSON.stringify(res.body)).toBe(true);
                expect((res.body as { code: string }).code).toBe('NOT_REQUEUEABLE');
                expect((res.body as { details: unknown }).details).toStrictEqual({ id, status });
                expect((res.body as { message: string }).message).toContain(`/api/v1/foods/${id}/refetch`);

                // A rejected requeue writes nothing.
                const food = await pool.query('SELECT status FROM food WHERE id = $1', [id]);
                expect(food.rows[0].status).toBe(status);
            },
        );
    });

    // ── Intake is never refused (owner ruling 2026-09-15; FR-043b and FR-046 amended) ─────────────
    /**
     * ⚠️ BOTH OF THESE PROVED THE OPPOSITE UNTIL 2026-09-15: a `503` at the depth ceiling, and a `503` for
     * the heavy requester near it. The owner ruled intake caps out — "restricting our users and bulk imports
     * would be a bad business decision" — so the queue accepts everything and the DRAIN is paced instead
     * (FR-019's 90% of the source's published limit, now binding both lanes).
     *
     * The coverage did not move: fairness between requesters is still proved, one layer down, by the
     * demotion the drain applies (`fetchQueue.dao` claim order, FR-043) — which reorders and never rejects.
     */
    describe('intake accepts every request (FR-043b retired)', () => {
        it('accepts an add well past the old depth ceiling', async () => {
            await seedPendingQueue(10, 'user_1');

            const res = await call('POST', '/api/v1/foods', { token: 'user', body: { name: 'one too many' } });
            expect(res.status).toBe(202);
            expect(res.headers.get('retry-after')).toBeNull();
        });

        it('accepts a heavy requester near the old ceiling, alongside a light one', async () => {
            await seedPendingQueue(9, FLOODER_ULID); // flooder pending=9 > demote threshold(2)

            const heavy = await call('POST', '/api/v1/foods', { token: 'flooder', body: { name: 'flooder add' } });
            expect(heavy.status).toBe(202);

            const light = await call('POST', '/api/v1/foods', { token: 'user', body: { name: 'light add' } });
            expect(light.status).toBe(202);
        });
    });
});
