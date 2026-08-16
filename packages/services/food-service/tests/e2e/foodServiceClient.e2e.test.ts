/**
 * Full-stack e2e for `@kitchensink/food-service-client` (T-057) against the REAL booted food service.
 * Boots the same hermetic stack as `foodsApi.e2e.test.ts` (real Nest app + real Postgres + the REAL
 * `FoodAuthGuard` → `@kitchensink/clerk-verify`, genuinely-signed RS256 tokens, the programmable
 * stub source adapter, and a worker `drain()` over the app's own DI). It then drives the API ONLY
 * through the typed client to prove end-to-end token attachment + status→typed-result/error mapping:
 *
 *   addByName (202) → drain → getById (RESOLVED) / getStatus / search ; unauthenticated → UnauthorizedError ;
 *   empty name → BadRequestError ; M2M token accepted (FR-047) ; queue ceiling → FetchUnavailableError (503).
 */
import 'reflect-metadata';

import type { AddressInfo } from 'node:net';

import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
    FoodServiceClient,
    isBadRequestError,
    isFetchUnavailableError,
    isInvalidRequestError,
    isUnauthorizedError,
} from '@kitchensink/food-service-client';
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
import { FetchQueueDao, FoodDao, FoodSourcesDao } from '../../src/foods/dao/index.js';
import { MergeAndPersistService } from '../../src/foods/merge/mergeAndPersist.service.js';
import { SourceAdapterRegistry } from '../../src/sources/SourceAdapterRegistry.js';
import { RollingWindowLimiter } from '../../src/sources/RollingWindowLimiter.js';
import { FoodConsumerService } from '../../src/worker/foodConsumer.service.js';
import type { WorkerLogger } from '../../src/worker/workerLogger.js';
import { resetSchema } from '../support/db.js';
import { generateClerkKeypair, mintToken } from '../support/jwt.js';
import { stub } from '../support/StubSourceAdapter.js';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];

const APP_AZP = 'https://app.example.com';
const M2M_AZP = 'svc-import-client';

const keypair = generateClerkKeypair();
// CR-002/U1: the user token carries its app-user ULID as `external_id` (THE requester key).
const userToken = mintToken(keypair.privateKeyPem, {
    sub: 'user_client_e2e',
    externalId: '01J9ZK8N7QF3B2X4M6T0V5C1AB',
    azp: APP_AZP,
});
const m2mToken = mintToken(keypair.privateKeyPem, { sub: 'svc_client_e2e', azp: M2M_AZP });

const silentLogger: WorkerLogger = { info(): void {}, warn(): void {}, error(): void {} };

describe.skipIf(!DATABASE_URL)('@kitchensink/food-service-client against the booted food service (e2e)', () => {
    /** The shared capturing adapter (plan U4) — replaces this suite's hand-rolled bus double. */
    const captureBus = new InMemoryPublisher();
    let app: INestApplication;
    let pool: pg.Pool;
    let baseUrl: string;
    let consumer: FoodConsumerService;
    let client: FoodServiceClient;
    let anonClient: FoodServiceClient;
    let m2mClient: FoodServiceClient;

    /** Drain the queue until the food reaches a terminal status (deterministic stand-in for backoff). */
    async function drainUntilTerminal(id: string): Promise<string> {
        const terminal = new Set(['RESOLVED', 'UNRESOLVED', 'NOT_FOUND', 'FAILED']);

        for (let pass = 0; pass < 12; pass += 1) {
            await consumer.drain();
            const rows = await pool.query<{ status: string }>('SELECT status FROM food WHERE id = $1', [id]);
            const status = rows.rows[0]?.status;

            if (status === undefined || terminal.has(status)) {
                return status ?? 'MISSING';
            }

            await pool.query(
                `UPDATE fetch_queue SET status='pending', leased_at=NULL, last_requested=now() WHERE food_id=$1`,
                [id],
            );
        }

        return 'TIMEOUT';
    }

    beforeAll(async () => {
        pool = new pg.Pool({ connectionString: DATABASE_URL });
        await resetSchema(pool);

        process.env['DATABASE_URL'] = DATABASE_URL;
        process.env['USDA_API_KEY'] = 'e2e-stub-key';
        process.env['FOOD_SOURCE_RATE_LIMIT_PER_HOUR'] = '100000';
        process.env['CLERK_JWT_KEY'] = keypair.publicKeyPem;
        process.env['CLERK_AUTHORIZED_PARTIES'] = `${APP_AZP},${M2M_AZP}`;
        process.env['FOOD_MAX_QUEUE_DEPTH'] = '25';
        process.env['NODE_ENV'] = 'test';

        const { AppModule } = await import('../../src/app.module.js');
        app = await NestFactory.create(AppModule, { logger: false });
        await app.listen(0);
        const address = app.getHttpServer().address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${address.port}`;
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

        client = new FoodServiceClient({ baseUrl, token: userToken });
        anonClient = new FoodServiceClient({ baseUrl });
        m2mClient = new FoodServiceClient({ baseUrl, token: m2mToken });
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
    });

    it('addByName → drain → getById returns the RESOLVED golden record (typed)', async () => {
        stub.programResolve('Broccoli, raw', { description: 'Raw broccoli florets' });

        const add = await client.addByName('Broccoli, raw');
        expect(add.status).toBe('PENDING');
        expect(add.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/i); // ULID, never an fdcId

        // PENDING before the worker runs.
        const pending = await client.getById(add.id);
        expect(pending.status).toBe('PENDING');

        expect(await drainUntilTerminal(add.id)).toBe('RESOLVED');

        const got = await client.getById(add.id);
        expect(got.status).toBe('RESOLVED');

        if (got.status === 'RESOLVED') {
            expect(got.food.id).toBe(add.id);
            expect(got.food.nutrients[0]?.nutrient).toBe('Protein');
            expect(JSON.stringify(got.food)).not.toContain('fdcId');
        }

        const status = await client.getStatus(add.id);
        expect(status.status).toBe('RESOLVED');
        expect(status.food?.id).toBe(add.id);
        expect(status.food?.nutrients[0]?.nutrient).toBe('Protein');
    });

    it('search returns ranked local hits (typed, never a source call)', async () => {
        stub.programResolve('Chicken breast, raw');
        const add = await client.addByName('Chicken breast, raw');
        await drainUntilTerminal(add.id);

        const result = await client.search('chicken');
        expect(result.results.map((row) => row.name)).toContain('Chicken breast, raw');
    });

    it('an unauthenticated client surfaces a typed UnauthorizedError (no DB effect)', async () => {
        const error = await anonClient.addByName('unauth food').catch((caught: unknown) => caught);
        expect(isUnauthorizedError(error)).toBe(true);

        expect((await pool.query('SELECT count(*)::int AS n FROM food')).rows[0].n).toBe(0);
    });

    /**
     * ⚠️ THIS ASSERTION WAS STALE, and the distinction it was collapsing is the one the client's error hierarchy
     * exists to preserve. It expected a `BadRequestError` — "the SERVER answered 400" — for a body that never
     * leaves the process: the client now parses every outbound body against the same published request schema the
     * service validates with (ADR-0014, outbound half), and `'   '` is illegal per `addFoodRequestSchema`, so this
     * is the CALLER's own bug and no request is issued. `InvalidRequestError` says exactly that, and a retry with
     * the same body cannot work; a `BadRequestError` would have meant the opposite (a legal body the server
     * rejected anyway — genuine skew, worth alerting on).
     */
    it("an empty name is the CALLER's error, rejected before a request is issued", async () => {
        const error = await client.addByName('   ').catch((caught: unknown) => caught);

        expect(isInvalidRequestError(error)).toBe(true);
        expect(isBadRequestError(error)).toBe(false);
        // Proof it never reached the service: an accepted add would have created a `food` row.
        expect((await pool.query('SELECT count(*)::int AS n FROM food')).rows[0].n).toBe(0);
    });

    /**
     * The other half, which nothing covered: a body the client's schema ACCEPTS and the server rejects anyway.
     *
     * `batchAddFoodRequestSchema` deliberately carries no `.max()` — the cap is `FOOD_MAX_BATCH_NAMES`, runtime
     * configuration, and duplicating it in the contract would be a second representation that disagrees the moment
     * it is tuned. So the oversized batch really goes out, really comes back a `400`, and this is the case that
     * proves the client maps the SERVER's coded rejection (`BATCH_TOO_LARGE`) rather than only its own.
     */
    it("an oversized batch surfaces the SERVER's typed BadRequestError", async () => {
        const names = Array.from({ length: 101 }, (_, index) => `bulk food ${index}`);

        const error = await client.batch(names).catch((caught: unknown) => caught);

        expect(isBadRequestError(error)).toBe(true);
        expect(isInvalidRequestError(error)).toBe(false);
        // The configured cap is reported in the message, so a caller can re-chunk without guessing it.
        expect((error as Error).message).toContain('100');
    });

    it('accepts an azp-allowlisted M2M token (FR-047)', async () => {
        stub.programResolve('service-added food');
        const add = await m2mClient.addByName('service-added food');
        expect(add.status).toBe('PENDING');

        const requesters = await pool.query('SELECT requester_id FROM fetch_requesters');
        expect(requesters.rows.map((row) => row.requester_id)).toEqual(['svc_client_e2e']);
    });

    it('maps the queue-depth ceiling to a typed FetchUnavailableError (503), never a 429', async () => {
        for (let i = 0; i < 25; i += 1) {
            const id = ulid();
            await pool.query(`INSERT INTO food (id, name, normalized_name, status) VALUES ($1, $2, $2, 'PENDING')`, [
                id,
                `seed ${i}`,
            ]);
            await pool.query(`INSERT INTO fetch_queue (food_id, status) VALUES ($1, 'pending')`, [id]);
        }

        stub.programResolve('one too many');

        const error = await client.addByName('one too many').catch((caught: unknown) => caught);
        expect(isFetchUnavailableError(error)).toBe(true);
    });
});
