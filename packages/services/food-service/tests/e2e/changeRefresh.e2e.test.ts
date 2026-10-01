/**
 * Full-stack e2e for change-driven refresh + the UNRESOLVED candidate-set TTL (Phase 7: T-170/T-171/T-172).
 * Boots the REAL Nest app against a REAL Postgres with the REAL `FoodAuthGuard` (genuinely-signed
 * RS256 tokens), and drives BOTH workers over the app's own DI instances:
 *
 *   - the fan-out/merge consumer ({@link FoodConsumerService}) — first-time resolve + the RESOLVED-food
 *     refresh branch (T-171);
 *   - the change-refresh scheduled task ({@link ChangeRefreshConsumer}) — scan + re-enqueue + TTL sweep
 *     (T-170/T-172).
 *
 * The only seam swapped is the source: `usda.adapter.js` is mocked so the production `FoodsModule` factory
 * registers the programmable `StubSourceAdapter`; the SAME stub instance backs the HTTP app, the
 * worker, and the change-refresh task. `stub.mutateItem` simulates an upstream item change. No real USDA,
 * no AWS — the completion bus is an in-memory capture. (The EventBridge→ECS RunTask trigger is infra/CDK,
 * out of scope for this slice.)
 */
import 'reflect-metadata';

import type { AddressInfo } from 'node:net';

import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import pg from 'pg';
import { ulid } from 'ulidx';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/sources/usda/usda.adapter.js', async () => {
    const { StubSourceAdapter } = await import('../support/StubSourceAdapter.js');

    return { UsdaSourceAdapter: StubSourceAdapter };
});

import { DrizzleProvider, type FoodDrizzle } from '../../src/database/database.module.js';
import { InMemoryPublisher } from '@kitchensink/messaging';
import { FoodEventEmitter } from '../../src/events/FoodEventEmitter.js';
import { FetchQueueDao } from '../../src/foods/dao/fetchQueue.dao.js';
import { FoodDao } from '../../src/foods/dao/food.dao.js';
import { CandidateStore } from '../../src/foods/dao/foodCandidates.dao.js';
import { FoodSourcesDao } from '../../src/foods/dao/foodSources.dao.js';
import { EnqueueEmitter } from '../../src/foods/enqueue.emitter.js';
import { MergeAndPersistService } from '../../src/foods/merge/mergeAndPersist.service.js';
import { SourceAdapterRegistry } from '../../src/sources/SourceAdapterRegistry.js';
import { RollingWindowLimiter } from '../../src/sources/RollingWindowLimiter.js';
import { ChangeRefreshConsumer } from '../../src/worker/change-refresh/changeRefresh.consumer.js';
import { FoodConsumerService } from '../../src/worker/foodConsumer.service.js';
import type { WorkerLogger } from '../../src/worker/workerLogger.js';
import { foodE2eDb, hasTestDatabase } from '../support/roleDb.js';
import { generateClerkKeypair, mintToken } from '../support/jwt.js';
import { stub } from '../support/StubSourceAdapter.js';

const APP_AZP = 'https://app.example.com';
const keypair = generateClerkKeypair();
// CR-002/U1: the user token carries its app-user ULID as `external_id` (THE requester key).
const userToken = mintToken(keypair.privateKeyPem, {
    sub: 'user_e2e',
    externalId: '01J9ZK8N7QF3B2X4M6T0V5C1AB',
    azp: APP_AZP,
});

const silentLogger: WorkerLogger = { info(): void {}, warn(): void {}, error(): void {} };

describe.skipIf(!hasTestDatabase)('change-refresh + UNRESOLVED TTL full-stack e2e', () => {
    /** The shared capturing adapter (plan U4) — replaces this suite's hand-rolled bus double. */
    const captureBus = new InMemoryPublisher();
    let app: INestApplication;
    let pool: pg.Pool;
    let baseUrl: string;
    let consumer: FoodConsumerService;
    let changeRefresh: ChangeRefreshConsumer;

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
        const res = await call('POST', '/api/v1/foods', { token: userToken, body: { name } });
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
        const res = await call('GET', `/api/v1/foods/${id}`, { token: userToken });

        return { status: res.status, body: (res.body ?? {}) as Record<string, unknown> };
    }

    beforeAll(async () => {
        pool = new pg.Pool({ connectionString: foodE2eDb().appUrl });
        await foodE2eDb().truncate();

        foodE2eDb().applySubjectEnv();
        process.env['USDA_API_KEY'] = 'e2e-stub-key';
        process.env['CLERK_JWT_KEY'] = keypair.publicKeyPem;
        process.env['CLERK_AUTHORIZED_PARTIES'] = APP_AZP;
        process.env['NODE_ENV'] = 'test';

        const { AppModule } = await import('../../src/app.module.js');
        app = await NestFactory.create(AppModule, { logger: false });
        await app.listen(0);
        baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
        const drizzle = app.get<FoodDrizzle>(DrizzleProvider, { strict: false });
        consumer = new FoodConsumerService({
            foodDao: app.get(FoodDao, { strict: false }),
            sources: app.get(FoodSourcesDao, { strict: false }),
            queue: new FetchQueueDao(drizzle),
            registry: app.get(SourceAdapterRegistry, { strict: false }),
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
        // As the OWNER: `food_app` holds DML and no TRUNCATE, which is what a deployed task holds.
        await foodE2eDb().truncate();
        stub.reset();
        captureBus.clear();
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
            'SELECT s.item_version FROM food_sources s JOIN food f ON f.item_id = s.item_id WHERE f.id = $1',
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
            `SELECT f.updated_at, fn.amount FROM food f JOIN food_nutrient_view fn ON fn.food_id = f.id WHERE f.id = $1`,
            [id],
        );

        const result = await runChangeRefresh();

        expect(result.enqueued).toBe(0);
        const after = await pool.query<{ updated_at: Date; amount: string }>(
            `SELECT f.updated_at, fn.amount FROM food f JOIN food_nutrient_view fn ON fn.food_id = f.id WHERE f.id = $1`,
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

        const candidates = await call('GET', `/api/v1/foods/${id}/candidates`, { token: userToken });
        const set = (candidates.body as { candidates: { candidateId: string; externalKey: string }[] }).candidates;
        const rawPick = set.find((c) => c.externalKey === keys[0])!;
        const pick = await call('PATCH', `/api/v1/foods/${id}`, {
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
        const candidates = await call('GET', `/api/v1/foods/${id}/candidates`, { token: userToken });
        const set = (candidates.body as { candidates: { candidateId: string; externalKey: string }[] }).candidates;
        const pickId = set.find((c) => c.externalKey === keys[0])!.candidateId;
        await call('PATCH', `/api/v1/foods/${id}`, { token: userToken, body: { candidateIds: [pickId] } });

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
        const beforeExpire = (await call('GET', `/api/v1/foods/${id}/candidates`, { token: userToken })).body as {
            id: string;
            candidates: { source: string; externalKey: string; name: string; summary: string | null }[];
        };
        expect(beforeExpire.id).toBe(id);
        expect(beforeExpire.candidates).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    source: 'usda',
                    externalKey: 'ek-avo-raw',
                    name: 'Avocado, raw',
                    summary: null,
                }),
                expect.objectContaining({
                    source: 'usda',
                    externalKey: 'ek-avo-cal',
                    name: 'Avocado, California',
                    summary: null,
                }),
            ]),
        );
        expect(beforeExpire.candidates).toHaveLength(2);

        // Age the candidate set past the 30-day TTL.
        await pool.query(`UPDATE food_candidates SET created_at = now() - interval '40 days' WHERE food_id = $1`, [id]);

        const sweep = await runChangeRefresh();
        expect(sweep.expiredCandidateRows).toBe(2);

        // The set is cleared but the food STAYS UNRESOLVED (never swept to NOT_FOUND) → GET 202.
        expect(await foodStatus(id)).toBe('UNRESOLVED');
        expect((await call('GET', `/api/v1/foods/${id}`, { token: userToken })).status).toBe(202);
        const emptyCandidates = await call('GET', `/api/v1/foods/${id}/candidates`, { token: userToken });
        expect((emptyCandidates.body as { candidates: unknown[] }).candidates).toEqual([]);

        // The next add-by-name for the same food re-fans-out against the normal budget; now it resolves.
        stub.reset();
        stub.programResolve('avocado', { name: 'Avocado, raw' });
        const readd = await call('POST', '/api/v1/foods', { token: userToken, body: { name: 'avocado' } });
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
        const candidates = await call('GET', `/api/v1/foods/${id}/candidates`, { token: userToken });
        const set = (candidates.body as { candidates: { candidateId: string; externalKey: string }[] }).candidates;
        const pickId = set.find((c) => c.externalKey === keys[0])!.candidateId;
        await call('PATCH', `/api/v1/foods/${id}`, { token: userToken, body: { candidateIds: [pickId] } });
        expect(await foodStatus(id)).toBe('RESOLVED');

        const callsBefore = stub.calls.searchByName;
        const readd = await call('POST', '/api/v1/foods', { token: userToken, body: { name: 'mango' } });
        // An add for an already-RESOLVED food does not re-fan-out (no scarce source budget burned).
        expect((readd.body as { id: string }).id).toBe(id);
        expect(stub.calls.searchByName).toBe(callsBefore);
        expect(await foodStatus(id)).toBe('RESOLVED');
    });

    // ── R14: a seed-owned food is never refreshed from the live API ───────────────────────────────────
    // Ported from the retired bulk seeder's suite (curated plan U16), and re-keyed by U4: the exclusion that was
    // `origin <> 'bulk'` is now `NOT seed_owned`. A seeded root is written as the owner, the way the seed's writes
    // are admitted, with a crosswalk row for the stub's item so the scan has something to skip.
    describe('the seed-owned exclusion (R14 — correctness, not a quota nicety)', () => {
        let seedNumber = 900_000;

        /** A seeded root standing for the stub's item `externalKey`, as the seed writes one. */
        async function bulkFood(name: string, externalKey: string, description: string | null = null): Promise<string> {
            seedNumber += 1;
            const key = `fdc:${seedNumber}`;
            // A ULID, because the read routes refuse any other id shape.
            const id = ulid();

            await foodE2eDb().asOwner(async (client) => {
                await client.query("INSERT INTO food_item (id, natural_key, owner_kind) VALUES ($1, $2, 'root')", [
                    `item-${id}`,
                    key,
                ]);
                await client.query(
                    `INSERT INTO food (id, item_id, name, normalized_name, description, status, seed_key)
                     VALUES ($1, $2, $3, lower($3), $4, 'RESOLVED', $5)`,
                    [id, `item-${id}`, name, description, key],
                );
                await client.query(
                    `INSERT INTO food_sources (id, item_id, source, external_key, item_version)
                     VALUES ($1, $2, 'usda', $3, 'v1')`,
                    [`src-${id}`, `item-${id}`, externalKey],
                );
            });

            return id;
        }

        const sources = () => app.get(FoodSourcesDao, { strict: false });

        it('omits seed-owned backing items from listResolvedBackingItems while keeping live ones', async () => {
            const bulkKey = stub.programResolve('Broccoli, raw', { itemVersion: 'v1' });
            stub.programResolve('Spinach', { itemVersion: 'v1' });
            const bulkId = await bulkFood('Broccoli, raw', bulkKey);
            const { id: liveId } = await addAndDrain('Spinach');

            const items = await sources().listResolvedBackingItems();

            expect(items.map((item) => item.foodId)).toStrictEqual([liveId]);
            expect(items.map((item) => item.foodId)).not.toContain(bulkId);
        });

        it('⛔ never re-fetches or re-enqueues a seeded food, but DOES refresh the live one in the same pass', async () => {
            const bulkKey = stub.programResolve('Broccoli, raw', { itemVersion: 'v1', description: 'lab florets' });
            const liveKey = stub.programResolve('Spinach', { itemVersion: 'v1' });
            const bulkId = await bulkFood('Broccoli, raw', bulkKey, 'lab florets');
            const { id: liveId } = await addAndDrain('Spinach');

            // Both changed upstream. Without the exclusion the seeded item would be fetched and re-enqueued on every
            // sweep, and its seeded values overwritten (or the write refused by the ownership trigger).
            stub.mutateItem(bulkKey, { itemVersion: 'v2', description: 'api florets' });
            stub.mutateItem(liveKey, { itemVersion: 'v2' });

            const result = await changeRefresh.runOnce();
            const queued = async (id: string): Promise<number> =>
                (await pool.query('SELECT 1 FROM fetch_queue WHERE food_id = $1', [id])).rowCount ?? 0;

            expect(result.enqueued).toBe(1);
            expect(await queued(bulkId)).toBe(0);
            expect(await queued(liveId)).toBe(1);

            await consumer.drain();

            expect((await getFood(bulkId)).body['description']).toBe('lab florets');
        });

        it('does not exclude a seeded food from anything else — it stays readable and searchable', async () => {
            const bulkKey = stub.programResolve('Broccoli, raw', { itemVersion: 'v1' });
            const bulkId = await bulkFood('Broccoli, raw', bulkKey);

            expect(await getFood(bulkId)).toMatchObject({ status: 200, body: { status: 'RESOLVED' } });

            const search = await call('GET', '/api/v1/foods/search?query=broccoli', { token: userToken });

            expect((search.body as { results: { id: string }[] }).results.map((hit) => hit.id)).toContain(bulkId);
        });
    });
});
