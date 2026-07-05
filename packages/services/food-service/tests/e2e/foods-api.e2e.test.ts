/**
 * Full-stack e2e for the source-agnostic `/v1/foods/*` API (T-190). Boots the REAL Nest app against a
 * REAL Postgres (`DATABASE_URL`) with the REAL {@link FoodAuthGuard} → `@kitchensink/clerk-verify`
 * (NO auth mock — every request carries a genuinely-signed RS256 token, see `tests/support/jwt.ts`),
 * and drives the fan-out worker deterministically by constructing a {@link FoodConsumerService} over
 * the app's own DI instances and calling `drain()` (no `LISTEN/NOTIFY`, no timers, no `waitForTimeout`).
 *
 * The only seam swapped is the source: `usda.adapter.js` is mocked so the production `FoodsModule`
 * factory registers the programmable {@link StubSourceAdapter} in place of `UsdaSourceAdapter` — so the
 * SAME stub instance backs both the HTTP app (PATCH-resolve re-fetch) and the worker (fan-out). No real
 * USDA network, no AWS; the completion bus is an in-memory capture. Fully hermetic + deterministic.
 *
 * Boot config: a throwaway RSA keypair's public PEM is `CLERK_JWT_KEY`; `CLERK_AUTHORIZED_PARTIES`
 * allows the app origin + an M2M client id; `FOOD_SOURCE_RATE_LIMIT_PER_HOUR` is high (the rolling window never
 * interferes); `FOOD_MAX_QUEUE_DEPTH=25` (one backpressure assertion seeds to the ceiling).
 */
import 'reflect-metadata';

import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import pg from 'pg';
import { ulid } from 'ulidx';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Substitute the programmable stub for UsdaSourceAdapter so the real FoodsModule factory registers it.
vi.mock('../../src/sources/usda/usda.adapter.js', async () => {
    const { StubSourceAdapter } = await import('../support/stub-source-adapter.js');

    return { UsdaSourceAdapter: StubSourceAdapter };
});

import { DrizzleProvider, type FoodDrizzle } from '../../src/database/database.module.js';
import { FoodEventEmitter, type EventBus, type EventBusPutInput } from '../../src/events/food-event-emitter.js';
import { FetchQueueDao, FoodDao, FoodSourcesDao } from '../../src/foods/dao/index.js';
import { MergeAndPersistService } from '../../src/foods/merge/merge-and-persist.service.js';
import { SourceAdapterRegistry } from '../../src/sources/food-source-adapter.js';
import { RollingWindowLimiter } from '../../src/sources/rolling-window-limiter.js';
import { FoodConsumerService } from '../../src/worker/food-consumer.service.js';
import type { WorkerLogger } from '../../src/worker/worker-logger.js';
import { generateClerkKeypair, mintToken } from '../support/jwt.js';
import { stub } from '../support/stub-source-adapter.js';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../../src/db/migrations');

/** The app origin (a session-token `azp`) and a distinct M2M client id — both allowlisted. */
const APP_AZP = 'https://app.example.com';
const M2M_AZP = 'svc-import-client';

// One throwaway keypair for the whole suite; its public PEM is set as CLERK_JWT_KEY before app boot.
const keypair = generateClerkKeypair();
const userToken = mintToken(keypair.privateKeyPem, { sub: 'user_e2e', azp: APP_AZP });
const adminToken = mintToken(keypair.privateKeyPem, { sub: 'admin_e2e', azp: APP_AZP, scopes: ['food:admin'] });
const m2mToken = mintToken(keypair.privateKeyPem, { sub: 'svc_e2e', azp: M2M_AZP });
const expiredToken = mintToken(keypair.privateKeyPem, { sub: 'user_e2e', azp: APP_AZP, expiresInSeconds: -30 });

/** A no-op worker logger so the drain produces no console noise. */
const silentLogger: WorkerLogger = { info(): void {}, warn(): void {}, error(): void {} };

/** Program a resolvable name and return the name (sugar for inline add-and-drain seeds). */
function programmedResolve(name: string): string {
    stub.programResolve(name);

    return name;
}

describe.skipIf(!DATABASE_URL)('/v1/foods/* full-stack e2e (booted Nest + real Postgres + worker drain)', () => {
    let app: INestApplication;
    let pool: pg.Pool;
    let baseUrl: string;
    let consumer: FoodConsumerService;
    const capturedEvents: EventBusPutInput[] = [];

    /** Issue an HTTP request; omit `token` for an unauthenticated call. */
    async function call(
        method: string,
        path: string,
        opts: { token?: string; body?: unknown } = {},
    ): Promise<{ status: number; body: unknown; headers: Headers }> {
        const headers: Record<string, string> = {};

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

    /** Read a food's lifecycle status straight from the DB, or `undefined` when no row exists. */
    async function foodStatus(id: string): Promise<string | undefined> {
        const rows = await pool.query<{ status: string }>('SELECT status FROM food WHERE id = $1', [id]);

        return rows.rows[0]?.status;
    }

    /** Completion/failure events captured for a given food id, by detailType. */
    function eventsFor(id: string, detailType: string): EventBusPutInput[] {
        return capturedEvents.filter((event) => event.detailType === detailType && event.detail['id'] === id);
    }

    /**
     * Drain the queue until the food reaches a terminal status. A FAILED row is held off by failure
     * backoff (`last_requested = now() + 2^attempts`), so between passes its gate is cleared so it
     * re-leases — a deterministic stand-in for elapsed backoff time.
     */
    async function drainUntilTerminal(id: string): Promise<string> {
        const terminal = new Set(['RESOLVED', 'UNRESOLVED', 'NOT_FOUND', 'FAILED']);

        for (let pass = 0; pass < 12; pass += 1) {
            await consumer.drain();
            const status = await foodStatus(id);

            if (status === undefined || terminal.has(status)) {
                return status ?? 'MISSING';
            }

            await pool.query(
                `UPDATE fetch_queue SET status = 'pending', leased_at = NULL, last_requested = now() WHERE food_id = $1`,
                [id],
            );
        }

        return (await foodStatus(id)) ?? 'MISSING';
    }

    /** Add a name through the real API and drain to its terminal status; returns the id + status. */
    async function addAndDrain(token: string, name: string): Promise<{ id: string; status: string }> {
        const res = await call('POST', '/v1/foods', { token, body: { name } });
        const id = (res.body as { id: string }).id;

        return { id, status: await drainUntilTerminal(id) };
    }

    /** Seed `count` active (`pending`) queue rows (backpressure fixture). */
    async function seedActiveQueue(count: number): Promise<void> {
        for (let i = 0; i < count; i += 1) {
            const id = ulid();
            await pool.query(`INSERT INTO food (id, name, normalized_name, status) VALUES ($1, $2, $2, 'PENDING')`, [
                id,
                `seed pending ${i}`,
            ]);
            await pool.query(`INSERT INTO fetch_queue (food_id, status) VALUES ($1, 'pending')`, [id]);
        }
    }

    beforeAll(async () => {
        pool = new pg.Pool({ connectionString: DATABASE_URL });
        await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
        for (const file of ['0000_food_schema.sql', '0001_food_fts.sql']) {
            await pool.query(readFileSync(join(migrationsDir, file), 'utf-8'));
        }

        process.env['DATABASE_URL'] = DATABASE_URL;
        process.env['USDA_API_KEY'] = 'e2e-stub-key';
        process.env['FOOD_SOURCE_RATE_LIMIT_PER_HOUR'] = '100000';
        process.env['CLERK_JWT_KEY'] = keypair.publicKeyPem;
        process.env['CLERK_AUTHORIZED_PARTIES'] = `${APP_AZP},${M2M_AZP}`;
        process.env['FOOD_MAX_QUEUE_DEPTH'] = '25';
        process.env['FOOD_DEMOTE_THRESHOLD'] = '50';
        process.env['NODE_ENV'] = 'test';

        const { AppModule } = await import('../../src/app.module.js');
        app = await NestFactory.create(AppModule, { logger: false });
        await app.listen(0);
        const address = app.getHttpServer().address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${address.port}`;

        // Build the worker over the app's own DI instances (same registry/limiter/merge/pool) so the
        // stub the app uses is the stub the worker fans out through. The completion bus captures events.
        const captureBus: EventBus = {
            async putEvent(input: EventBusPutInput): Promise<void> {
                capturedEvents.push(input);
            },
        };
        consumer = new FoodConsumerService({
            foodDao: app.get(FoodDao, { strict: false }),
            sources: app.get(FoodSourcesDao, { strict: false }),
            queue: new FetchQueueDao(app.get<FoodDrizzle>(DrizzleProvider, { strict: false })),
            registry: app.get(SourceAdapterRegistry, { strict: false }),
            limiter: app.get(RollingWindowLimiter, { strict: false }),
            merge: app.get(MergeAndPersistService, { strict: false }),
            events: new FoodEventEmitter(captureBus),
            logger: silentLogger,
        });
    });

    afterAll(async () => {
        await app?.close();
        await pool?.end();
    });

    beforeEach(async () => {
        await pool.query(`
            TRUNCATE food, food_sources, nutrient, food_nutrients, food_portions, food_field_provenance,
                     food_category, food_category_assignment, food_candidates, fetch_queue, fetch_requesters,
                     source_call_log, source_sync_metadata RESTART IDENTITY CASCADE
        `);
        stub.reset();
        capturedEvents.length = 0;
    });

    // ── Auth (real Clerk verification, FR-035/FR-038/FR-039/FR-047) ─────────────────────────────────
    describe('auth gate (real RS256 verification)', () => {
        it('rejects every endpoint with no token → 401', async () => {
            const id = ulid();
            const cases: [string, string][] = [
                ['GET', `/v1/foods/${id}`],
                ['GET', `/v1/foods/${id}/status`],
                ['GET', `/v1/foods/${id}/candidates`],
                ['GET', '/v1/foods/search?query=x'],
                ['POST', '/v1/foods'],
                ['POST', '/v1/foods/batch'],
                ['PATCH', `/v1/foods/${id}`],
                ['POST', `/v1/foods/${id}/refetch`],
            ];

            for (const [method, path] of cases) {
                const res = await call(method, path);
                expect(res.status).toBe(401);
            }
        });

        it('rejects a malformed token and an expired token → 401', async () => {
            expect((await call('GET', `/v1/foods/${ulid()}`, { token: 'not-a-jwt' })).status).toBe(401);
            expect((await call('GET', `/v1/foods/${ulid()}`, { token: expiredToken })).status).toBe(401);
        });

        it('does NOT create a food/queue row for an unauthenticated POST (401 before any effect)', async () => {
            const res = await call('POST', '/v1/foods', { body: { name: 'unauth broccoli' } });
            expect(res.status).toBe(401);

            expect((await pool.query('SELECT count(*)::int AS n FROM food')).rows[0].n).toBe(0);
            expect((await pool.query('SELECT count(*)::int AS n FROM fetch_queue')).rows[0].n).toBe(0);
        });

        it('accepts an azp-allowlisted M2M token and uses its sub for provenance (FR-047)', async () => {
            stub.programResolve('service add');
            const res = await call('POST', '/v1/foods', { token: m2mToken, body: { name: 'service add' } });
            expect(res.status).toBe(202);

            const requesters = await pool.query('SELECT sub FROM fetch_requesters');
            expect(requesters.rows.map((row) => row.sub)).toEqual(['svc_e2e']);
        });

        it('rejects /refetch without the food:admin scope → 403, allows it with the scope → 202', async () => {
            const { id } = await addAndDrain(userToken, programmedResolve('Refetch me'));

            expect((await call('POST', `/v1/foods/${id}/refetch`, { token: userToken })).status).toBe(403);
            expect((await call('POST', `/v1/foods/${id}/refetch`, { token: adminToken })).status).toBe(202);
        });
    });

    // ── Add-by-name → resolve (FR-005/FR-011/FR-024/FR-MRG-1) ───────────────────────────────────────
    describe('add-by-name → worker resolve', () => {
        it('POST 202 + one queue row → drain → RESOLVED golden record (per-100g, provenance, no fdcId)', async () => {
            const externalKey = stub.programResolve('Broccoli, raw', { description: 'Raw broccoli florets' });

            const add = await call('POST', '/v1/foods', { token: userToken, body: { name: 'Broccoli, raw' } });
            expect(add.status).toBe(202);
            const id = (add.body as { id: string; status: string }).id;
            expect((add.body as { status: string }).status).toBe('PENDING');
            expect(
                (await pool.query('SELECT count(*)::int AS n FROM fetch_queue WHERE food_id = $1', [id])).rows[0].n,
            ).toBe(1);

            // PENDING read → 202 before the worker runs.
            expect((await call('GET', `/v1/foods/${id}`, { token: userToken })).status).toBe(202);

            expect(await drainUntilTerminal(id)).toBe('RESOLVED');

            const got = await call('GET', `/v1/foods/${id}`, { token: userToken });
            expect(got.status).toBe(200);
            const food = got.body as {
                id: string;
                status: string;
                nutrients: unknown[];
                portions: unknown[];
                provenance: Record<string, string>;
            };
            expect(food.id).toBe(id);
            expect(food.status).toBe('RESOLVED');
            expect(food.nutrients).toEqual([
                { nutrient: 'Protein', amount: 2.8, unit: 'g', basis: 'per_100g', source: 'usda' },
            ]);
            expect(food.portions).toEqual([{ label: '1 cup', gramWeight: 91, source: 'usda' }]);
            expect(food.provenance['name']).toBe('usda');
            expect(JSON.stringify(food)).not.toContain('fdcId');
            expect(JSON.stringify(food)).not.toContain(externalKey);

            // status transitioned PENDING → RESOLVED and now carries the golden record.
            const status = await call('GET', `/v1/foods/${id}/status`, { token: userToken });
            expect((status.body as { status: string; food?: unknown }).status).toBe('RESOLVED');
            expect((status.body as { food?: unknown }).food).toBeDefined();

            // FoodFetchCompleted emitted for the RESOLVED disposition.
            const completed = eventsFor(id, 'FoodFetchCompleted');
            expect(completed).toHaveLength(1);
            expect(completed[0]!.detail['status']).toBe('RESOLVED');
        });

        it('dedups a same-normalized-name re-add to one id/row', async () => {
            stub.programResolve('Spinach');
            const first = await call('POST', '/v1/foods', { token: userToken, body: { name: 'Spinach' } });
            const second = await call('POST', '/v1/foods', { token: userToken, body: { name: '  spinach ' } });
            expect((first.body as { id: string }).id).toBe((second.body as { id: string }).id);
            expect((await pool.query('SELECT count(*)::int AS n FROM food')).rows[0].n).toBe(1);
        });
    });

    // ── UNRESOLVED → candidate pick (FR-RES-1/FR-RES-2) ─────────────────────────────────────────────
    describe('UNRESOLVED → candidate pick', () => {
        it('multi-candidate → UNRESOLVED → PATCH a valid pick → RESOLVED + set cleared', async () => {
            stub.programUnresolved('broccoli', [
                { name: 'Broccoli, raw', externalKey: 'ek-raw' },
                { name: 'Broccoli, cooked', externalKey: 'ek-cooked' },
            ]);

            const { id, status } = await addAndDrain(userToken, 'broccoli');
            expect(status).toBe('UNRESOLVED');
            expect((await call('GET', `/v1/foods/${id}`, { token: userToken })).status).toBe(202);

            const candidates = await call('GET', `/v1/foods/${id}/candidates`, { token: userToken });
            expect(candidates.status).toBe(200);
            const set = (candidates.body as { candidates: { candidateId: string; externalKey: string }[] }).candidates;
            expect(set).toHaveLength(2);
            expect(JSON.stringify(candidates.body)).not.toContain('fdcId');

            // A non-member pick → 409, status unchanged.
            const mismatch = await call('PATCH', `/v1/foods/${id}`, {
                token: userToken,
                body: { candidateIds: [ulid()] },
            });
            expect(mismatch.status).toBe(409);
            expect(await foodStatus(id)).toBe('UNRESOLVED');

            // A valid pick → 200 RESOLVED (re-fetched through the stub) + candidate set cleared.
            const pick = await call('PATCH', `/v1/foods/${id}`, {
                token: userToken,
                body: { candidateIds: [set[0]!.candidateId] },
            });
            expect(pick.status).toBe(200);
            expect((pick.body as { status: string }).status).toBe('RESOLVED');
            expect(await foodStatus(id)).toBe('RESOLVED');
            expect(
                (await pool.query('SELECT count(*)::int AS n FROM food_candidates WHERE food_id = $1', [id])).rows[0].n,
            ).toBe(0);
            expect((await call('GET', `/v1/foods/${id}`, { token: userToken })).status).toBe(200);

            // PATCH again on a RESOLVED food → idempotent 200 no-op.
            const again = await call('PATCH', `/v1/foods/${id}`, {
                token: userToken,
                body: { candidateIds: [ulid()] },
            });
            expect(again.status).toBe(200);
            expect((again.body as { status: string }).status).toBe('RESOLVED');
        });
    });

    // ── NOT_FOUND tombstone (FR-025/DSN-9) ──────────────────────────────────────────────────────────
    describe('NOT_FOUND', () => {
        it('zero hits → NOT_FOUND tombstone; GET → 404 with status retrievable', async () => {
            stub.programNotFound('phantom food');
            const { id, status } = await addAndDrain(userToken, 'phantom food');
            expect(status).toBe('NOT_FOUND');

            const got = await call('GET', `/v1/foods/${id}`, { token: userToken });
            expect(got.status).toBe(404);
            expect((got.body as { status: string }).status).toBe('NOT_FOUND');

            const poll = await call('GET', `/v1/foods/${id}/status`, { token: userToken });
            expect(poll.status).toBe(200);
            expect((poll.body as { status: string }).status).toBe('NOT_FOUND');

            // NOT_FOUND emits a completion but NO FetchFailed (a normal outcome, DSN-9).
            expect(eventsFor(id, 'FoodFetchCompleted')).toHaveLength(1);
            expect(eventsFor(id, 'FetchFailed')).toHaveLength(0);
        });
    });

    // ── Batch (FR-012/FR-045) ───────────────────────────────────────────────────────────────────────
    describe('POST /v1/foods/batch', () => {
        it('mixed batch → per-item partial (inline RESOLVED hit + PENDING misses)', async () => {
            const { id: resolvedId } = await addAndDrain(userToken, programmedResolve('Chicken breast, raw'));
            expect(await foodStatus(resolvedId)).toBe('RESOLVED');
            stub.programResolve('Quinoa');
            stub.programResolve('Lentils');

            const res = await call('POST', '/v1/foods/batch', {
                token: userToken,
                body: { names: ['Chicken breast, raw', 'Quinoa', 'Lentils'] },
            });
            expect(res.status).toBe(201);
            const items = (res.body as { items: { id: string; status: string }[] }).items;
            expect(items.filter((item) => item.status === 'RESOLVED')).toHaveLength(1);
            expect(items.filter((item) => item.status === 'PENDING')).toHaveLength(2);
        });

        it('collapses an intra-batch duplicate name to one item', async () => {
            stub.programResolve('Kale');
            const res = await call('POST', '/v1/foods/batch', {
                token: userToken,
                body: { names: ['Kale', 'kale', '  KALE '] },
            });
            expect((res.body as { items: unknown[] }).items).toHaveLength(1);
        });

        it('rejects a batch over 100 names → 400, nothing enqueued', async () => {
            const names = Array.from({ length: 101 }, (_, i) => `batch food ${i}`);
            const res = await call('POST', '/v1/foods/batch', { token: userToken, body: { names } });
            expect(res.status).toBe(400);
            expect((await pool.query('SELECT count(*)::int AS n FROM food')).rows[0].n).toBe(0);
        });
    });

    // ── Search (FR-008/FR-009 — never a source call) ────────────────────────────────────────────────
    describe('GET /v1/foods/search', () => {
        it('ranks fuzzy/substring hits, crosswalks external_key + barcode, and never calls a source', async () => {
            const chickenKey = stub.programResolve('Chicken breast, raw', {
                externalKey: 'ek-chicken-1',
                barcode: '0123456789012',
            });
            stub.programResolve('Beef steak', { externalKey: 'ek-beef-1' });
            const { id: chickenId } = await addAndDrain(userToken, 'Chicken breast, raw');
            await addAndDrain(userToken, 'Beef steak');

            // Substring/fuzzy: matches chicken, never the unrelated beef.
            const fuzzy = await call('GET', '/v1/foods/search?query=chicken', { token: userToken });
            expect(fuzzy.status).toBe(200);
            const names = (fuzzy.body as { results: { name: string }[] }).results.map((row) => row.name);
            expect(names).toContain('Chicken breast, raw');
            expect(names).not.toContain('Beef steak');

            // external_key crosswalk → the chicken id.
            const byKey = await call('GET', `/v1/foods/search?query=${chickenKey}`, { token: userToken });
            expect((byKey.body as { results: { id: string }[] }).results.map((row) => row.id)).toContain(chickenId);

            // barcode crosswalk → the chicken id.
            const byBarcode = await call('GET', '/v1/foods/search?query=0123456789012', { token: userToken });
            expect((byBarcode.body as { results: { id: string }[] }).results.map((row) => row.id)).toContain(chickenId);

            // No match → empty AND zero source calls during the search.
            const before = stub.calls.searchByName;
            const none = await call('GET', '/v1/foods/search?query=zzzznotathing', { token: userToken });
            expect((none.body as { results: unknown[] }).results).toEqual([]);
            expect(stub.calls.searchByName).toBe(before);
        });

        it('matches a word-order-independent query via ranked FTS and never calls a source (T-180)', async () => {
            stub.programResolve('Chicken breast, raw');
            const { id } = await addAndDrain(userToken, 'Chicken breast, raw');

            // "breast chicken" is NOT a substring — only the ranked FTS lexeme path matches the reversed phrase.
            const before = stub.calls.searchByName;
            const res = await call('GET', '/v1/foods/search?query=breast%20chicken', { token: userToken });
            expect(res.status).toBe(200);
            expect((res.body as { results: { id: string }[] }).results.map((row) => row.id)).toContain(id);
            expect(stub.calls.searchByName).toBe(before);
        });
    });

    // ── FAILED tombstone (FR-016/FR-027/DSN-9) ──────────────────────────────────────────────────────
    describe('FAILED', () => {
        it('repeated genuine 5xx (500) past the retry budget → FAILED tombstone + FetchFailed; GET → 404', async () => {
            // 500 = a genuine per-food server error (consumes the retry budget). A 503/504/timeout is now
            // treated as backpressure (deferred, no attempts++) — see the FoodConsumerService fan-out buckets.
            stub.programSearchError('kombucha scoby', 500);
            const { id, status } = await addAndDrain(userToken, 'kombucha scoby');
            expect(status).toBe('FAILED');

            const got = await call('GET', `/v1/foods/${id}`, { token: userToken });
            expect(got.status).toBe(404);
            expect((got.body as { status: string }).status).toBe('FAILED');

            expect(eventsFor(id, 'FoodFetchCompleted').some((event) => event.detail['status'] === 'FAILED')).toBe(true);
            const failed = eventsFor(id, 'FetchFailed');
            expect(failed).toHaveLength(1);
            expect(failed[0]!.detail['attempts']).toBe(5);
        });
    });

    // ── Admin operational-query endpoints (FR-039 / US-10, T-184) ────────────────────────────────────
    describe('GET /v1/foods/admin/* operational metrics', () => {
        it('unauth → 401; authenticated non-admin → 403; admin → 200 with the operational signals', async () => {
            // Unauthenticated → 401 (the guard, before any handler).
            expect((await call('GET', '/v1/foods/admin/metrics')).status).toBe(401);
            expect((await call('GET', '/v1/foods/admin/queue')).status).toBe(401);

            // Authenticated but missing the food:admin scope → 403 (FR-039/FR-051).
            expect((await call('GET', '/v1/foods/admin/metrics', { token: userToken })).status).toBe(403);
            expect((await call('GET', '/v1/foods/admin/queue', { token: userToken })).status).toBe(403);

            // Seed a known operational state: a RESOLVED food, a NOT_FOUND tombstone, and pending rows.
            const { id: resolvedId } = await addAndDrain(userToken, programmedResolve('Admin resolved'));
            expect(await foodStatus(resolvedId)).toBe('RESOLVED');
            stub.programNotFound('admin phantom');
            await addAndDrain(userToken, 'admin phantom');
            await seedActiveQueue(3);

            // Admin → 200 with the dashboard signals.
            const metrics = await call('GET', '/v1/foods/admin/metrics', { token: adminToken });
            expect(metrics.status).toBe(200);
            const body = metrics.body as {
                queue: { pending: number; inFlight: number; tombstone: number };
                backlog: { unresolved: number; notFound: number; failed: number };
                sources: { source: string; windowCount: number; hardCap: number; utilization: number }[];
            };
            expect(body.queue.pending).toBeGreaterThanOrEqual(3);
            expect(body.queue.tombstone).toBeGreaterThanOrEqual(1);
            expect(body.backlog.notFound).toBeGreaterThanOrEqual(1);
            expect(body.sources.map((source) => source.source)).toContain('usda');
            expect(body.sources[0]!.hardCap).toBeGreaterThan(0);

            // The focused queue-depth endpoint also requires the admin scope and returns the depths.
            const queue = await call('GET', '/v1/foods/admin/queue', { token: adminToken });
            expect(queue.status).toBe(200);
            expect((queue.body as { pending: number }).pending).toBeGreaterThanOrEqual(3);
        });
    });

    // ── Backpressure (FR-046) ───────────────────────────────────────────────────────────────────────
    describe('backpressure', () => {
        it('returns 503 + Retry-After at the queue-depth ceiling', async () => {
            await seedActiveQueue(25); // FOOD_MAX_QUEUE_DEPTH=25
            stub.programResolve('one too many');

            const res = await call('POST', '/v1/foods', { token: userToken, body: { name: 'one too many' } });
            expect(res.status).toBe(503);
            expect(res.headers.get('retry-after')).toBeTruthy();
        });
    });
});
