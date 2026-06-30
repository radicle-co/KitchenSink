/**
 * Full-stack e2e for change-driven refresh + the UNRESOLVED candidate-set TTL (Phase 7: T-170/T-171/T-172).
 * Boots the REAL Nest app against a REAL Postgres with the REAL {@link FoodAuthGuard} (genuinely-signed
 * RS256 tokens), and drives BOTH workers over the app's own DI instances:
 *
 *   - the fan-out/merge consumer ({@link FoodConsumerService}) — first-time resolve + the RESOLVED-food
 *     refresh branch (T-171);
 *   - the change-refresh scheduled task ({@link ChangeRefreshConsumer}) — scan + re-enqueue + TTL sweep
 *     (T-170/T-172).
 *
 * The only seam swapped is the source: `usda.adapter.js` is mocked so the production `FoodsModule` factory
 * registers the programmable {@link StubSourceAdapter}; the SAME stub instance backs the HTTP app, the
 * worker, and the change-refresh task. `stub.mutateItem` simulates an upstream item change. No real USDA,
 * no AWS — the completion bus is an in-memory capture. (The EventBridge→ECS RunTask trigger is infra/CDK,
 * out of scope for this slice.)
 */
import 'reflect-metadata';

import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/sources/usda/usda.adapter.js', async () => {
    const { StubSourceAdapter } = await import('../support/stub-source-adapter.js');

    return { UsdaSourceAdapter: StubSourceAdapter };
});

import { DrizzleProvider, type FoodDrizzle } from '../../src/database/database.module.js';
import { FoodEventEmitter, type EventBus, type EventBusPutInput } from '../../src/events/food-event-emitter.js';
import { CandidateStore, FetchQueueDao, FoodDao, FoodSourcesDao } from '../../src/foods/dao/index.js';
import { EnqueueEmitter } from '../../src/foods/enqueue.emitter.js';
import { MergeAndPersistService } from '../../src/foods/merge/merge-and-persist.service.js';
import { SourceAdapterRegistry } from '../../src/sources/food-source-adapter.js';
import { RollingWindowLimiter } from '../../src/sources/rolling-window-limiter.js';
import { ChangeRefreshConsumer } from '../../src/worker/change-refresh/change-refresh.consumer.js';
import { FoodConsumerService } from '../../src/worker/food-consumer.service.js';
import type { WorkerLogger } from '../../src/worker/worker-logger.js';
import { generateClerkKeypair, mintToken } from '../support/jwt.js';
import { stub } from '../support/stub-source-adapter.js';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../../src/db/migrations');

const APP_AZP = 'https://app.example.com';
const keypair = generateClerkKeypair();
const userToken = mintToken(keypair.privateKeyPem, { sub: 'user_e2e', azp: APP_AZP });

const silentLogger: WorkerLogger = { info(): void {}, warn(): void {}, error(): void {} };

describe.skipIf(!DATABASE_URL)('change-refresh + UNRESOLVED TTL full-stack e2e', () => {
    let app: INestApplication;
    let pool: pg.Pool;
    let baseUrl: string;
    let consumer: FoodConsumerService;
    let changeRefresh: ChangeRefreshConsumer;
    const capturedEvents: EventBusPutInput[] = [];

    async function call(
        method: string,
        path: string,
        opts: { token?: string; body?: unknown } = {},
    ): Promise<{ status: number; body: unknown }> {
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

        return { status: response.status, body: text ? JSON.parse(text) : undefined };
    }

    async function foodStatus(id: string): Promise<string | undefined> {
        const rows = await pool.query<{ status: string }>('SELECT status FROM food WHERE id = $1', [id]);

        return rows.rows[0]?.status;
    }

    /** Drain the worker until a food reaches a terminal status (resetting failure backoff between passes). */
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

    async function addAndDrain(name: string): Promise<{ id: string; status: string }> {
        const res = await call('POST', '/v1/foods', { token: userToken, body: { name } });
        const id = (res.body as { id: string }).id;

        return { id, status: await drainUntilTerminal(id) };
    }

    /** Run the change-refresh scan, then drain the worker so any re-enqueued refresh rows are processed. */
    async function runChangeRefresh(): Promise<{ enqueued: number; expiredCandidateRows: number }> {
        const result = await changeRefresh.runOnce();
        await consumer.drain();

        return result;
    }

    /** Read a food's golden record over HTTP (200 → record). */
    async function getFood(id: string): Promise<{ status: number; body: Record<string, unknown> }> {
        const res = await call('GET', `/v1/foods/${id}`, { token: userToken });

        return { status: res.status, body: (res.body ?? {}) as Record<string, unknown> };
    }

    beforeAll(async () => {
        pool = new pg.Pool({ connectionString: DATABASE_URL });
        await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
        await pool.query(readFileSync(join(migrationsDir, '0000_food_schema.sql'), 'utf-8'));

        process.env['DATABASE_URL'] = DATABASE_URL;
        process.env['USDA_API_KEY'] = 'e2e-stub-key';
        process.env['USDA_RATE_LIMIT_PER_HOUR'] = '100000';
        process.env['CLERK_JWT_KEY'] = keypair.publicKeyPem;
        process.env['CLERK_AUTHORIZED_PARTIES'] = APP_AZP;
        process.env['FOOD_MAX_QUEUE_DEPTH'] = '1000';
        process.env['NODE_ENV'] = 'test';

        const { AppModule } = await import('../../src/app.module.js');
        app = await NestFactory.create(AppModule, { logger: false });
        await app.listen(0);
        baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;

        const captureBus: EventBus = {
            async putEvent(input: EventBusPutInput): Promise<void> {
                capturedEvents.push(input);
            },
        };
        const drizzle = app.get<FoodDrizzle>(DrizzleProvider, { strict: false });
        consumer = new FoodConsumerService({
            foodDao: app.get(FoodDao, { strict: false }),
            sources: app.get(FoodSourcesDao, { strict: false }),
            queue: new FetchQueueDao(drizzle),
            registry: app.get(SourceAdapterRegistry, { strict: false }),
            limiter: app.get(RollingWindowLimiter, { strict: false }),
            merge: app.get(MergeAndPersistService, { strict: false }),
            events: new FoodEventEmitter(captureBus),
            logger: silentLogger,
        });
        changeRefresh = new ChangeRefreshConsumer({
            sources: app.get(FoodSourcesDao, { strict: false }),
            candidates: app.get(CandidateStore, { strict: false }),
            registry: app.get(SourceAdapterRegistry, { strict: false }),
            limiter: app.get(RollingWindowLimiter, { strict: false }),
            enqueue: app.get(EnqueueEmitter, { strict: false }),
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

    // ── T-170 + T-171: changed item → selective in-place re-pull, food stays RESOLVED ───────────────
    it('refreshes a RESOLVED food whose backing item changed upstream; GET reflects the new values', async () => {
        const key = stub.programResolve('Broccoli, raw', {
            description: 'old florets',
            itemVersion: 'v1',
            nutrients: [{ code: null, name: 'Protein', unit: 'g', amount: '2.8', basis: 'per_100g' }],
        });
        const { id, status } = await addAndDrain('Broccoli, raw');
        expect(status).toBe('RESOLVED');

        const initial = await getFood(id);
        expect(initial.status).toBe(200);
        expect(initial.body['description']).toBe('old florets');

        // Upstream change: new itemVersion + new nutrient amount + new description.
        stub.mutateItem(key, {
            description: 'fresh florets',
            itemVersion: 'v2',
            nutrients: [{ code: null, name: 'Protein', unit: 'g', amount: '3.5', basis: 'per_100g' }],
        });

        const result = await runChangeRefresh();
        expect(result.enqueued).toBe(1);

        // Food stayed RESOLVED and the golden record reflects the upstream change.
        expect(await foodStatus(id)).toBe('RESOLVED');
        const refreshed = await getFood(id);
        const nutrients = refreshed.body['nutrients'] as { nutrient: string; amount: number }[];
        expect(refreshed.body['description']).toBe('fresh florets');
        expect(nutrients.find((n) => n.nutrient === 'Protein')?.amount).toBe(3.5);

        // The crosswalk item_version advanced.
        const version = await pool.query<{ item_version: string }>(
            'SELECT item_version FROM food_sources WHERE food_id = $1',
            [id],
        );
        expect(version.rows[0]!.item_version).toBe('v2');
    });

    it('is a no-op when no backing item changed upstream (no re-enqueue, golden record untouched)', async () => {
        stub.programResolve('Spinach', {
            itemVersion: 'v1',
            nutrients: [{ code: null, name: 'Protein', unit: 'g', amount: '2.9', basis: 'per_100g' }],
        });
        const { id } = await addAndDrain('Spinach');

        const before = await pool.query<{ updated_at: Date; amount: string }>(
            `SELECT f.updated_at, fn.amount FROM food f JOIN food_nutrients fn ON fn.food_id = f.id WHERE f.id = $1`,
            [id],
        );

        const result = await runChangeRefresh();

        expect(result.enqueued).toBe(0);
        const after = await pool.query<{ updated_at: Date; amount: string }>(
            `SELECT f.updated_at, fn.amount FROM food f JOIN food_nutrients fn ON fn.food_id = f.id WHERE f.id = $1`,
            [id],
        );
        expect(after.rows[0]!.updated_at.getTime()).toBe(before.rows[0]!.updated_at.getTime());
        expect(after.rows[0]!.amount).toBe(before.rows[0]!.amount);
    });

    // ── T-171: manual pick (PATCH-resolve) preservation vs. its own item changing ───────────────────
    it('preserves a manual pick across refresh when its backing item is unchanged', async () => {
        const keys = stub.programUnresolved('broccoli', [
            { name: 'Broccoli, raw', externalKey: 'ek-raw', itemVersion: 'v1', description: 'picked raw' },
            { name: 'Broccoli, cooked', externalKey: 'ek-cooked', itemVersion: 'v1' },
        ]);
        const { id, status } = await addAndDrain('broccoli');
        expect(status).toBe('UNRESOLVED');

        const candidates = await call('GET', `/v1/foods/${id}/candidates`, { token: userToken });
        const set = (candidates.body as { candidates: { candidateId: string; externalKey: string }[] }).candidates;
        const rawPick = set.find((c) => c.externalKey === keys[0])!;
        const pick = await call('PATCH', `/v1/foods/${id}`, {
            token: userToken,
            body: { candidateIds: [rawPick.candidateId] },
        });
        expect((pick.body as { status: string }).status).toBe('RESOLVED');

        // The picked item is UNCHANGED upstream → refresh must not touch the manual pick.
        const result = await runChangeRefresh();
        expect(result.enqueued).toBe(0);
        expect(await foodStatus(id)).toBe('RESOLVED');
        expect((await getFood(id)).body['description']).toBe('picked raw');
    });

    it('re-pulls a manual pick when its own backing item changes upstream (D-REFRESH)', async () => {
        const keys = stub.programUnresolved('yogurt', [
            { name: 'Yogurt, plain', externalKey: 'ek-plain', itemVersion: 'v1', description: 'plain' },
            { name: 'Yogurt, vanilla', externalKey: 'ek-vanilla', itemVersion: 'v1' },
        ]);
        const { id } = await addAndDrain('yogurt');
        const candidates = await call('GET', `/v1/foods/${id}/candidates`, { token: userToken });
        const set = (candidates.body as { candidates: { candidateId: string; externalKey: string }[] }).candidates;
        const pickId = set.find((c) => c.externalKey === keys[0])!.candidateId;
        await call('PATCH', `/v1/foods/${id}`, { token: userToken, body: { candidateIds: [pickId] } });

        // The picked item itself changed upstream → refresh legitimately re-pulls it.
        stub.mutateItem(keys[0], { description: 'plain, updated', itemVersion: 'v2' });
        const result = await runChangeRefresh();

        expect(result.enqueued).toBe(1);
        expect(await foodStatus(id)).toBe('RESOLVED');
        expect((await getFood(id)).body['description']).toBe('plain, updated');
    });

    // ── T-170: scope of the scan (skips tombstones) ─────────────────────────────────────────────────
    it('does not refresh a NOT_FOUND tombstone', async () => {
        stub.programNotFound('phantom food');
        const { id, status } = await addAndDrain('phantom food');
        expect(status).toBe('NOT_FOUND');

        const result = await runChangeRefresh();
        expect(result.enqueued).toBe(0);
        expect(await foodStatus(id)).toBe('NOT_FOUND');
    });

    // ── T-172: UNRESOLVED candidate-set TTL → cleared, food stays UNRESOLVED, next add re-fans-out ───
    it('expires a >30-day UNRESOLVED candidate set, keeps the food UNRESOLVED, and the next add re-fans-out', async () => {
        stub.programUnresolved('avocado', [
            { name: 'Avocado, raw', externalKey: 'ek-avo-raw' },
            { name: 'Avocado, California', externalKey: 'ek-avo-cal' },
        ]);
        const { id, status } = await addAndDrain('avocado');
        expect(status).toBe('UNRESOLVED');
        expect(
            (await call('GET', `/v1/foods/${id}/candidates`, { token: userToken }).then((r) => r.body)) as unknown,
        ).toBeDefined();

        // Age the candidate set past the 30-day TTL.
        await pool.query(`UPDATE food_candidates SET created_at = now() - interval '40 days' WHERE food_id = $1`, [id]);

        const sweep = await runChangeRefresh();
        expect(sweep.expiredCandidateRows).toBe(2);

        // The set is cleared but the food STAYS UNRESOLVED (never swept to NOT_FOUND) → GET 202.
        expect(await foodStatus(id)).toBe('UNRESOLVED');
        expect((await call('GET', `/v1/foods/${id}`, { token: userToken })).status).toBe(202);
        const emptyCandidates = await call('GET', `/v1/foods/${id}/candidates`, { token: userToken });
        expect((emptyCandidates.body as { candidates: unknown[] }).candidates).toEqual([]);

        // The next add-by-name for the same food re-fans-out against the normal budget; now it resolves.
        stub.reset();
        stub.programResolve('avocado', { name: 'Avocado, raw' });
        const readd = await call('POST', '/v1/foods', { token: userToken, body: { name: 'avocado' } });
        expect(readd.status).toBe(202);
        expect((readd.body as { id: string }).id).toBe(id); // same logical food id
        expect(await drainUntilTerminal(id)).toBe('RESOLVED');
        expect(stub.calls.searchByName).toBeGreaterThan(0); // a real re-fan-out occurred
    });

    it('keeps a human pick made before expiry RESOLVED with no re-fan-out', async () => {
        const keys = stub.programUnresolved('mango', [
            { name: 'Mango, raw', externalKey: 'ek-mango-raw' },
            { name: 'Mango, dried', externalKey: 'ek-mango-dried' },
        ]);
        const { id } = await addAndDrain('mango');
        const candidates = await call('GET', `/v1/foods/${id}/candidates`, { token: userToken });
        const set = (candidates.body as { candidates: { candidateId: string; externalKey: string }[] }).candidates;
        const pickId = set.find((c) => c.externalKey === keys[0])!.candidateId;
        await call('PATCH', `/v1/foods/${id}`, { token: userToken, body: { candidateIds: [pickId] } });
        expect(await foodStatus(id)).toBe('RESOLVED');

        const callsBefore = stub.calls.searchByName;
        const readd = await call('POST', '/v1/foods', { token: userToken, body: { name: 'mango' } });
        // An add for an already-RESOLVED food does not re-fan-out (no scarce source budget burned).
        expect((readd.body as { id: string }).id).toBe(id);
        expect(stub.calls.searchByName).toBe(callsBefore);
        expect(await foodStatus(id)).toBe('RESOLVED');
    });
});
