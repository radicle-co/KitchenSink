/**
 * LOCAL e2e (`docs/CODING_STANDARDS.md` §7.1a): Sentry FOOD-SERVICE-6, "food_app may not UPDATE seed-owned food_sources
 * rows", reproduced on a real Postgres through the path that raised it, and the three repairs that close it.
 *
 * The path: a food added by name goes to the fan-out worker, which searches USDA directly. USDA answers several items,
 * one of which a seeded root already holds; the food becomes `UNRESOLVED` with that item in its candidate set; the cook
 * picks it; the merge records the item's crosswalk row, and the ownership trigger refuses the write to the seed's row.
 *
 * What the suite pins, every case against the booted app and a worker connected as `food_app` (the role a deployed task
 * holds), with the seeded catalog written as the schema owner (as the seed writes it):
 *
 * - catalog first: a name that IS a catalog root's synonym answers that root at add time, and a name that IS a root and
 *   one of its variants is forwarded to the variant by the worker, with no USDA call either way;
 * - a candidate set never offers an item the catalog holds, and the worker never fetches one;
 * - an answer made only of one holder's items forwards the food to that holder;
 * - a forced pick of a held item (a candidate set persisted before the catalog took the item) resolves to the holder,
 *   and no seed-owned row is written;
 * - the merge itself never writes over another food's row: it refuses, naming the held item.
 *
 * The USDA source is the programmable stub, shared by the app (the PATCH re-fetch) and the worker (the fan-out).
 */
import 'reflect-metadata';

import type { AddressInfo } from 'node:net';

import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Substitute the programmable stub for UsdaSourceAdapter so the real FoodsModule factory registers it.
vi.mock('../../src/sources/usda/usda.adapter.js', async () => {
    const { StubSourceAdapter } = await import('../support/StubSourceAdapter.js');

    return { UsdaSourceAdapter: StubSourceAdapter };
});

import { InMemoryPublisher } from '@kitchensink/messaging';

import * as schema from '../../src/db/schema/index.js';
import { DrizzleProvider, type FoodDrizzle } from '../../src/database/database.module.js';
import { FoodEventEmitter } from '../../src/events/FoodEventEmitter.js';
import { FetchQueueDao } from '../../src/foods/dao/fetchQueue.dao.js';
import { FoodDao } from '../../src/foods/dao/food.dao.js';
import { FoodSourcesDao } from '../../src/foods/dao/foodSources.dao.js';
import { MergeAndPersistService } from '../../src/foods/merge/mergeAndPersist.service.js';
import { GoldenRecordMergeEngine } from '../../src/foods/merge/mergeEngine.js';
import { isSourceHeldError } from '../../src/foods/merge/merge.errors.js';
import { SourceAdapterRegistry } from '../../src/sources/SourceAdapterRegistry.js';
import { FoodConsumerService } from '../../src/worker/foodConsumer.service.js';
import { SilentWorkerLogger } from '../../src/worker/SilentWorkerLogger.js';
import { workerCatalogOf } from '../../src/worker/workerCatalog.js';
import { FoodMetrics } from '../../src/observability/emfMetrics.js';
import { makeSeededRoot } from '../__fixtures__/catalogFood.js';
import { generateClerkKeypair, mintToken } from '../support/jwt.js';
import { foodDb } from '../support/roleDb.js';
import { StubSourceAdapter, stub } from '../support/StubSourceAdapter.js';

const APP_AZP = 'https://app.example.com';
const keypair = generateClerkKeypair();
const USER_ULID = '01J9ZK8N7QF3B2X4M6T0V5C1AB';
const userToken = mintToken(keypair.privateKeyPem, { sub: 'user_e2e', externalId: USER_ULID, azp: APP_AZP });

/** The USDA item the seeded root holds: the key FOOD-SERVICE-6's pick named. */
const HELD_KEY = '747447';

/** The seed-owned crosswalk row, every column the merge's write would have changed. */
interface SeedRowState {
    readonly id: string;
    readonly item_id: string;
    readonly item_version: string | null;
    readonly fetch_state: string;
    readonly fetched_at: string;
}

describe('FOOD-SERVICE-6: a held source item is never offered, picked over, or written over', () => {
    const bus = new InMemoryPublisher();
    let app: INestApplication;
    let pool: pg.Pool;
    let baseUrl: string;
    let consumer: FoodConsumerService;

    /**
     * Issue one request as the cook.
     *
     * @sideEffect Performs an HTTP request.
     */
    async function call(method: string, path: string, body?: unknown): Promise<{ status: number; body: unknown }> {
        const response = await fetch(`${baseUrl}${path}`, {
            method,
            headers: {
                authorization: `Bearer ${userToken}`,
                ...(body === undefined ? {} : { 'content-type': 'application/json' }),
            },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        const text = await response.text();

        return { status: response.status, body: text.length > 0 ? (JSON.parse(text) as unknown) : undefined };
    }

    /**
     * Seed the catalog's Broccoli: a seed-owned root holding {@link HELD_KEY}, with a synonym and one variant.
     *
     * @sideEffect Writes the root as the schema owner.
     */
    async function seedBroccoli(): Promise<{ rootId: string; variantId: string }> {
        const root = await makeSeededRoot(foodDb(), {
            name: 'Broccoli',
            synonyms: ['calabrese'],
            sourceKey: HELD_KEY,
            values: [{ key: 'energyKcal', amount: 34 }],
            variants: [{ parts: [{ attribute: 'cookingMethod', text: 'steamed' }], sourceKey: '747448' }],
        });
        const [variant] = root.variants;

        if (variant === undefined) {
            throw new Error('the seeded root has no variant');
        }

        return { rootId: root.id, variantId: variant.id };
    }

    /**
     * The seed-owned row holding {@link HELD_KEY}.
     *
     * @sideEffect Reads `food_sources` as the owner.
     */
    async function seedRow(): Promise<SeedRowState[]> {
        return foodDb().asOwner(async (client) => {
            const rows = await client.query<SeedRowState>(
                `SELECT fs.id, fs.item_id, fs.item_version, fs.fetch_state, fs.fetched_at::text AS fetched_at
                   FROM food_sources fs WHERE fs.source = 'usda' AND fs.external_key = $1`,
                [HELD_KEY],
            );

            return rows.rows;
        });
    }

    /**
     * Add a name through the API and drain the worker once.
     *
     * @sideEffect Performs a request and drains the queue.
     */
    async function addAndDrain(name: string): Promise<{ id: string; added: { status: string } }> {
        const added = await call('POST', '/api/v1/foods', { name });
        const body = added.body as { id: string; status: string };

        await consumer.drain();

        return { id: body.id, added: body };
    }

    /**
     * The food's status, retirement and forward, read straight from the table.
     *
     * @sideEffect Reads `food` and `food_forward`.
     */
    async function storedFood(id: string): Promise<{
        status: string | undefined;
        retired: boolean;
        forward: { target_food_id: string | null; target_variant_id: string | null } | undefined;
    }> {
        const food = await pool.query<{ status: string; retired: boolean }>(
            'SELECT status::text AS status, retired_at IS NOT NULL AS retired FROM food WHERE id = $1',
            [id],
        );
        const forward = await pool.query<{ target_food_id: string | null; target_variant_id: string | null }>(
            'SELECT target_food_id, target_variant_id FROM food_forward WHERE source_id = $1',
            [id],
        );

        return { status: food.rows[0]?.status, retired: food.rows[0]?.retired ?? false, forward: forward.rows[0] };
    }

    /** The answer `refs/resolve` gives for a root ref. */
    async function refAnswer(id: string): Promise<unknown> {
        const answer = await call('POST', '/api/v1/foods/refs/resolve', { refs: [{ kind: 'root', id }] });

        return (answer.body as { entries: unknown[] }).entries[0];
    }

    beforeAll(async () => {
        pool = new pg.Pool({ connectionString: foodDb().appUrl });
        await foodDb().truncate();

        foodDb().applySubjectEnv();
        process.env['USDA_API_KEY'] = 'e2e-stub-key';
        process.env['CLERK_JWT_KEY'] = keypair.publicKeyPem;
        process.env['CLERK_AUTHORIZED_PARTIES'] = APP_AZP;
        process.env['NODE_ENV'] = 'test';

        const { AppModule } = await import('../../src/app.module.js');
        app = await NestFactory.create(AppModule, { logger: false });
        await app.listen(0);
        baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;

        const db = app.get<FoodDrizzle>(DrizzleProvider, { strict: false });

        consumer = new FoodConsumerService({
            foodDao: app.get(FoodDao, { strict: false }),
            sources: app.get(FoodSourcesDao, { strict: false }),
            queue: new FetchQueueDao(db),
            registry: app.get(SourceAdapterRegistry, { strict: false }),
            merge: app.get(MergeAndPersistService, { strict: false }),
            catalog: workerCatalogOf(db, new FoodMetrics(() => undefined)),
            events: new FoodEventEmitter(bus),
            logger: new SilentWorkerLogger(),
        });
    });

    afterAll(async () => {
        await app?.close();
        await pool?.end();
    });

    beforeEach(async () => {
        await foodDb().truncate();
        stub.reset();
    });

    describe('catalog first', () => {
        it("a name that IS a root's synonym answers that root at add time, with no row made and no USDA call", async () => {
            const { rootId } = await seedBroccoli();

            const added = await call('POST', '/api/v1/foods', { name: 'Calabrese' });

            // The add route answers `202` with the status in the body, as it does for any RESOLVED dedup hit.
            expect(added.status).toBe(202);
            expect(added.body).toEqual({ id: rootId, status: 'RESOLVED' });
            expect((await pool.query('SELECT count(*)::int AS n FROM food')).rows[0]).toEqual({ n: 1 });
            expect(stub.calls.searchByName).toBe(0);
        });

        it('a name that IS a root and one of its variants is forwarded to the variant, with no USDA call', async () => {
            const { variantId } = await seedBroccoli();

            const { id, added } = await addAndDrain('steamed broccoli');

            expect(added.status).toBe('PENDING');
            expect(stub.calls.searchByName).toBe(0);
            expect(await storedFood(id)).toEqual({
                status: 'RESOLVED',
                retired: true,
                forward: { target_food_id: null, target_variant_id: variantId },
            });
            expect(await refAnswer(id)).toMatchObject({
                outcome: 'found',
                forwardedTo: { kind: 'variant', id: variantId },
            });
            expect(
                (await pool.query('SELECT count(*)::int AS n FROM fetch_queue WHERE food_id = $1', [id])).rows[0],
            ).toEqual({ n: 0 });
        });
    });

    describe('held candidates', () => {
        it('never offers, and never fetches, an item the catalog holds', async () => {
            await seedBroccoli();
            stub.programUnresolved('broccoli florets', [
                { name: 'Broccoli, raw', externalKey: HELD_KEY },
                { name: 'Broccoli, frozen, chopped', externalKey: '169967' },
                { name: 'Broccoli raab, cooked', externalKey: '170381' },
            ]);

            const { id } = await addAndDrain('broccoli florets');
            const candidates = await call('GET', `/api/v1/foods/${id}/candidates`);
            const offered = (candidates.body as { candidates: { externalKey: string }[] }).candidates;

            expect((await storedFood(id)).status).toBe('UNRESOLVED');
            expect(offered.map((candidate) => candidate.externalKey).sort()).toEqual(['169967', '170381']);
            expect(stub.keysFetched).not.toContain(HELD_KEY);
        });

        it("an answer made only of one holder's items forwards the food to that holder", async () => {
            const { rootId } = await seedBroccoli();
            stub.programUnresolved('broccoli crowns', [{ name: 'Broccoli, raw', externalKey: HELD_KEY }]);

            const { id } = await addAndDrain('broccoli crowns');

            expect(await storedFood(id)).toEqual({
                status: 'RESOLVED',
                retired: true,
                forward: { target_food_id: rootId, target_variant_id: null },
            });
            expect(stub.keysFetched).toEqual([]);
        });
    });

    describe('the forced pick that raised FOOD-SERVICE-6', () => {
        it('a pick of a held item resolves to the holder, and writes no seed-owned row', async () => {
            const { rootId } = await seedBroccoli();
            stub.programUnresolved('broccoli florets', [
                { name: 'Broccoli, raw', externalKey: HELD_KEY },
                { name: 'Broccoli, frozen, chopped', externalKey: '169967' },
            ]);
            const { id } = await addAndDrain('broccoli florets');
            // The set as it stood before the catalog took the item: a pin bump claims a key after a set was persisted.
            await pool.query(
                `INSERT INTO food_candidates (id, food_id, source, external_key, name)
                 VALUES ('cand-held', $1, 'usda', $2, 'Broccoli, raw') ON CONFLICT DO NOTHING`,
                [id, HELD_KEY],
            );
            const held = (
                await pool.query<{ id: string }>(
                    'SELECT id FROM food_candidates WHERE food_id = $1 AND external_key = $2',
                    [id, HELD_KEY],
                )
            ).rows[0];
            const before = await seedRow();

            const pick = await call('PATCH', `/api/v1/foods/${id}`, { candidateIds: [held?.id] });

            expect(pick).toEqual({ status: 200, body: { id, status: 'RESOLVED' } });
            expect(await seedRow()).toEqual(before);
            expect(await storedFood(id)).toEqual({
                status: 'RESOLVED',
                retired: true,
                forward: { target_food_id: rootId, target_variant_id: null },
            });
            expect(await refAnswer(id)).toMatchObject({ outcome: 'found', forwardedTo: { kind: 'root', id: rootId } });
            expect(
                (await pool.query('SELECT count(*)::int AS n FROM food_candidates WHERE food_id = $1', [id])).rows[0],
            ).toEqual({ n: 0 });
            expect(
                (
                    await pool.query(
                        'SELECT count(*)::int AS n FROM food_sources fs JOIN food f ON f.item_id = fs.item_id WHERE f.id = $1',
                        [id],
                    )
                ).rows[0],
            ).toEqual({ n: 0 });
        });

        it("the merge refuses an item another food holds, naming it, and leaves the seed's row as it was", async () => {
            await seedBroccoli();
            const placeholder = await new FoodDao(drizzle(pool, { schema })).createByName({
                normalizedName: 'broccoli florets',
                displayName: 'broccoli florets',
            });
            const registry = new SourceAdapterRegistry();
            registry.register(new StubSourceAdapter());
            stub.programResolve('Broccoli, raw', { externalKey: HELD_KEY });
            const pick = stub.canonicalFor(HELD_KEY);
            const before = await seedRow();

            if (pick === undefined) {
                throw new Error('the stub holds no item for the held key');
            }

            const merge = new MergeAndPersistService(drizzle(pool, { schema }), new GoldenRecordMergeEngine(registry));
            const refused = await merge.resolveFromPicks({ foodId: placeholder.id, picks: [pick] }).then(
                () => undefined,
                (error: unknown) => error,
            );

            expect(isSourceHeldError(refused) ? refused.held : refused).toEqual([
                { source: 'usda', externalKey: HELD_KEY },
            ]);
            expect(await seedRow()).toEqual(before);
        });
    });
});
