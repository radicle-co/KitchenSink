/**
 * Full-stack e2e for `GET /api/v1/foods/nutrition?ids=…` — food's batch nutrition endpoint (plan U8).
 *
 * | Plan U8 scenario | Proved here |
 * | ---------------- | ----------- |
 * | many ids in one call return in one response | the batch shape, in canonical id order |
 * | energy selected by basis + name + unit | a food carrying BOTH a `kcal` and a `kJ` energy row reads the kcal figure, not the 4.184× one |
 * | a `per_serving` energy row reports ABSENT | the branded case, over the real merge/persist path |
 * | a food with no energy row reports absent, not zero | the field is missing from the body entirely |
 * | normalized portions with gram weights | `1 cup chopped` @125 g → `{ unit: 'cup', gramsPerUnit: 125 }` |
 * | an uninterpretable portion label reports that portion absent | never a fabricated unit or weight |
 * | an unresolved id returns a STATUS rather than being omitted | `PENDING` and `AWAITING_RETRY` (U9) both ride the wire |
 * | an unknown id is reported, not an error for the whole batch | `unknownIds`, alongside the ids that did resolve |
 * | input over the cap is rejected with a STRUCTURED error | the published `BATCH_TOO_LARGE` envelope, and the 100-id boundary |
 * | two callers requesting the same id set produce byte-identical URLs | canonicalization is proved through the URL, and by three unrelated principals receiving byte-identical bodies |
 * | the response parses against the generated schema; `CONTRACT_HASH` matches | validated against `@kitchensink/schema-food` — the copy a CLIENT imports, not the in-service authored one |
 *
 * ## Why this tier
 *
 * `src/foods/__tests__/nutritionBatch.test.ts` drives the service over a stubbed DAO, so it can prove the
 * projection is CALLED correctly and nothing about what an external caller receives. Everything above turns
 * on things a mock cannot hold: that a `kJ` row and a `kcal` row can coexist for one food (they can — the
 * `nutrient` dictionary dedupes on `(name, unit)`), that `basis` survives the round trip through
 * `food_nutrients`, that the guard runs before the query, that the query DTO is `.strict()` so no extra
 * parameter can fork the cache key, and that the body validates against the PUBLISHED schema package.
 *
 * Boot + harness mirror `foodsApi.e2e.test.ts`: the real Nest app, real Postgres, real `FoodAuthGuard`
 * over genuinely-signed RS256 tokens, and the source seam swapped for the programmable stub. No network.
 */
import 'reflect-metadata';

import type { AddressInfo } from 'node:net';

import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import pg from 'pg';
import { ulid } from 'ulidx';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Substitute the programmable stub for UsdaSourceAdapter so the real FoodsModule factory registers it.
vi.mock('../../src/sources/usda/usda.adapter.js', async () => {
    const { StubSourceAdapter } = await import('../support/StubSourceAdapter.js');

    return { UsdaSourceAdapter: StubSourceAdapter };
});

import { InMemoryPublisher } from '@kitchensink/messaging';
import {
    CONTRACT_HASH as PUBLISHED_CONTRACT_HASH,
    foodErrorSchema as publishedFoodErrorSchema,
    foodNutritionBatchResponseSchema as publishedNutritionSchema,
} from '@kitchensink/schema-food';

import { CONTRACT_HASH as IN_SERVICE_CONTRACT_HASH } from '../../src/contract/contractHash.js';
import { DrizzleProvider, type FoodDrizzle } from '../../src/database/database.module.js';
import { FoodEventEmitter } from '../../src/events/FoodEventEmitter.js';
import { FetchQueueDao, FoodDao, FoodSourcesDao } from '../../src/foods/dao/index.js';
import { MAX_NUTRITION_IDS } from '../../src/foods/foods.schema.js';
import { MergeAndPersistService } from '../../src/foods/merge/mergeAndPersist.service.js';
import { RollingWindowLimiter } from '../../src/sources/RollingWindowLimiter.js';
import { SourceAdapterRegistry } from '../../src/sources/SourceAdapterRegistry.js';
import { FoodConsumerService } from '../../src/worker/foodConsumer.service.js';
import type { WorkerLogger } from '../../src/worker/workerLogger.js';
import { resetSchema } from '../support/db.js';
import { generateClerkKeypair, mintToken } from '../support/jwt.js';
import { stub } from '../support/StubSourceAdapter.js';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];

const APP_AZP = 'https://app.example.com';
const M2M_AZP = 'svc-import-client';

const keypair = generateClerkKeypair();
const userToken = mintToken(keypair.privateKeyPem, {
    sub: 'user_nutrition',
    externalId: '01J9ZK8N7QF3B2X4M6T0V5C1AB',
    azp: APP_AZP,
});
const otherUserToken = mintToken(keypair.privateKeyPem, {
    sub: 'user_other',
    externalId: '01J9ZK8N7QF3B2X4M6T0V5C1AC',
    azp: APP_AZP,
});
const adminToken = mintToken(keypair.privateKeyPem, {
    sub: 'admin_nutrition',
    externalId: '01J9ZK8N7QF3B2X4M6T0V5C1AD',
    azp: APP_AZP,
    scopes: ['food:admin'],
});
const m2mToken = mintToken(keypair.privateKeyPem, { sub: 'svc_nutrition', azp: M2M_AZP });
const expiredToken = mintToken(keypair.privateKeyPem, {
    sub: 'user_nutrition',
    externalId: '01J9ZK8N7QF3B2X4M6T0V5C1AB',
    azp: APP_AZP,
    expiresInSeconds: -30,
});

const silentLogger: WorkerLogger = { info(): void {}, warn(): void {}, error(): void {} };

/** One food's entry in the batch response, as a caller sees it. */
interface NutritionEntry {
    readonly id: string;
    readonly status: string;
    readonly caloriesPer100g?: number;
    readonly proteinGPer100g?: number;
    readonly carbsGPer100g?: number;
    readonly fatGPer100g?: number;
    readonly portions: readonly { readonly unit: string; readonly gramsPerUnit: number }[];
}

describe.skipIf(!DATABASE_URL)(
    'GET /api/v1/foods/nutrition — batch nutrition e2e (booted Nest + real Postgres)',
    () => {
        const captureBus = new InMemoryPublisher();
        let app: INestApplication;
        let pool: pg.Pool;
        let baseUrl: string;
        let consumer: FoodConsumerService;

        /** Issue a request; omit `token` for an unauthenticated call. Returns the RAW text too (byte compare). */
        async function call(
            path: string,
            token?: string,
        ): Promise<{ status: number; text: string; body: unknown; headers: Headers }> {
            const response = await fetch(`${baseUrl}${path}`, {
                method: 'GET',
                headers: token ? { authorization: `Bearer ${token}` } : {},
            });
            const text = await response.text();

            return {
                status: response.status,
                text,
                body: text ? JSON.parse(text) : undefined,
                headers: response.headers,
            };
        }

        /** `GET /nutrition` for the given ids, exactly as written (no client-side canonicalization). */
        async function nutrition(ids: readonly string[], token: string = userToken) {
            return call(`/api/v1/foods/nutrition?ids=${ids.join(',')}`, token);
        }

        /** The parsed batch body, asserted 200 and validated against the PUBLISHED schema first. */
        async function nutritionOf(
            ids: readonly string[],
            token: string = userToken,
        ): Promise<{ foods: NutritionEntry[]; unknownIds: string[] }> {
            const res = await nutrition(ids, token);

            expect(res.status).toBe(200);
            expect(publishedNutritionSchema.safeParse(res.body).success).toBe(true);

            return res.body as { foods: NutritionEntry[]; unknownIds: string[] };
        }

        /** Add a name through the real API, drain the worker, and return the food id. */
        async function seedResolved(name: string): Promise<string> {
            const add = await fetch(`${baseUrl}/api/v1/foods`, {
                method: 'POST',
                headers: { authorization: `Bearer ${userToken}`, 'content-type': 'application/json' },
                body: JSON.stringify({ name }),
            });
            const { id } = (await add.json()) as { id: string };
            await consumer.drain();

            return id;
        }

        /** Insert a bare `food` row in the given lifecycle status (no source data at all). */
        async function seedBareFood(name: string, status: string): Promise<string> {
            const id = ulid();
            await pool.query(
                'INSERT INTO food (id, name, normalized_name, status) VALUES ($1, $2, $2, $3::food_status)',
                [id, name, status],
            );

            return id;
        }

        beforeAll(async () => {
            pool = new pg.Pool({ connectionString: DATABASE_URL });
            await resetSchema(pool);

            process.env['DATABASE_URL'] = DATABASE_URL;
            process.env['USDA_API_KEY'] = 'e2e-stub-key';
            process.env['FOOD_SOURCE_RATE_LIMIT_PER_HOUR'] = '100000';
            process.env['CLERK_JWT_KEY'] = keypair.publicKeyPem;
            process.env['CLERK_AUTHORIZED_PARTIES'] = `${APP_AZP},${M2M_AZP}`;
            process.env['FOOD_MAX_QUEUE_DEPTH'] = '5000';
            process.env['FOOD_DEMOTE_THRESHOLD'] = '5000';
            process.env['NODE_ENV'] = 'test';

            const { AppModule } = await import('../../src/app.module.js');
            app = await NestFactory.create(AppModule, { logger: false });
            await app.listen(0);
            baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;

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
            captureBus.clear();
        });

        // ── Auth (the endpoint is behind the same real guard as every other food route) ─────────────────
        describe('auth', () => {
            it('rejects an unauthenticated request → 401, and reads no food', async () => {
                const id = await seedBareFood('unauth broccoli', 'PENDING');

                const res = await call(`/api/v1/foods/nutrition?ids=${id}`);

                expect(res.status).toBe(401);
                expect(res.text).not.toContain(id);
            });

            it('rejects a malformed and an expired token → 401', async () => {
                expect((await nutrition([ulid()], 'not-a-jwt')).status).toBe(401);
                expect((await nutrition([ulid()], expiredToken)).status).toBe(401);
            });

            it('401 precedes the id-list rejection — an over-cap unauthenticated request is still a 401', async () => {
                const ids = Array.from({ length: MAX_NUTRITION_IDS + 1 }, () => ulid());

                expect((await call(`/api/v1/foods/nutrition?ids=${ids.join(',')}`)).status).toBe(401);
            });
        });

        // ── The wire shape (U8: the projection + normalized portions) ───────────────────────────────────
        describe('the response an external caller receives', () => {
            it('returns per-100g macros and normalized portions for many ids in ONE call', async () => {
                stub.programResolve('Broccoli, raw', {
                    nutrients: [
                        { code: null, name: 'Energy', unit: 'kcal', amount: '34', basis: 'per_100g' },
                        { code: null, name: 'Protein', unit: 'g', amount: '2.8', basis: 'per_100g' },
                        {
                            code: null,
                            name: 'Carbohydrate, by difference',
                            unit: 'g',
                            amount: '6.6',
                            basis: 'per_100g',
                        },
                        { code: null, name: 'Total lipid (fat)', unit: 'g', amount: '0.37', basis: 'per_100g' },
                    ],
                    portions: [{ label: '1 cup chopped', gramWeight: '91' }],
                });
                stub.programResolve('Almonds, raw', {
                    nutrients: [
                        { code: null, name: 'Energy', unit: 'kcal', amount: '579', basis: 'per_100g' },
                        { code: null, name: 'Protein', unit: 'g', amount: '21.2', basis: 'per_100g' },
                    ],
                    portions: [{ label: '1 tablespoon', gramWeight: '9' }],
                });

                const broccoli = await seedResolved('Broccoli, raw');
                const almonds = await seedResolved('Almonds, raw');
                const body = await nutritionOf([broccoli, almonds]);

                expect(body.unknownIds).toStrictEqual([]);
                expect(body.foods).toHaveLength(2);
                expect(body.foods.find((food) => food.id === broccoli)).toStrictEqual({
                    id: broccoli,
                    status: 'RESOLVED',
                    caloriesPer100g: 34,
                    proteinGPer100g: 2.8,
                    carbsGPer100g: 6.6,
                    fatGPer100g: 0.37,
                    portions: [{ unit: 'cup', gramsPerUnit: 91 }],
                });
                expect(body.foods.find((food) => food.id === almonds)).toStrictEqual({
                    id: almonds,
                    status: 'RESOLVED',
                    caloriesPer100g: 579,
                    proteinGPer100g: 21.2,
                    portions: [{ unit: 'tablespoon', gramsPerUnit: 9 }],
                });
            });

            it('returns the foods in CANONICAL (sorted, de-duplicated) id order regardless of how they were asked for', async () => {
                stub.programResolve('alpha food');
                stub.programResolve('beta food');
                stub.programResolve('gamma food');
                const ids = [
                    await seedResolved('alpha food'),
                    await seedResolved('beta food'),
                    await seedResolved('gamma food'),
                ];
                const sorted = [...ids].sort();

                const asked = [ids[2]!, ids[0]!, ids[1]!, ids[0]!];
                const body = await nutritionOf(asked);

                expect(body.foods.map((food) => food.id)).toStrictEqual(sorted);
            });

            it('is CALLER-INDEPENDENT — three unrelated principals receive byte-identical bodies (ADR-0020)', async () => {
                stub.programResolve('shared cache entry');
                const id = await seedResolved('shared cache entry');
                const path = `/api/v1/foods/nutrition?ids=${id}`;

                const [mine, theirs, admin, machine] = await Promise.all([
                    call(path, userToken),
                    call(path, otherUserToken),
                    call(path, adminToken),
                    call(path, m2mToken),
                ]);

                expect(mine!.status).toBe(200);
                expect(theirs!.text).toBe(mine!.text);
                expect(admin!.text).toBe(mine!.text);
                expect(machine!.text).toBe(mine!.text);
            });

            it('validates against the PUBLISHED schema package, whose CONTRACT_HASH matches the in-service copy', async () => {
                stub.programResolve('contract check');
                const id = await seedResolved('contract check');

                const res = await nutrition([id]);

                expect(PUBLISHED_CONTRACT_HASH).toBe(IN_SERVICE_CONTRACT_HASH);
                expect(publishedNutritionSchema.parse(res.body).foods[0]!.id).toBe(id);
            });
        });

        // ── The selection traps U8 exists to close (KTD-3) ──────────────────────────────────────────────
        describe('energy selection — basis AND canonical name AND unit', () => {
            it('picks the kcal row when the SAME food also stores a kJ energy row (the 4.184× trap)', async () => {
                stub.programResolve('Dual energy food', {
                    nutrients: [
                        // Both are stored: `nutrient` dedupes on (name, unit), so these are two dictionary rows.
                        { code: null, name: 'Energy', unit: 'kJ', amount: '1000', basis: 'per_100g' },
                        { code: null, name: 'Energy', unit: 'kcal', amount: '239', basis: 'per_100g' },
                    ],
                });
                const id = await seedResolved('Dual energy food');

                // Both rows really did persist — otherwise this asserts nothing about SELECTION.
                const stored = await pool.query<{ unit: string }>(
                    'SELECT n.unit FROM food_nutrients fn JOIN nutrient n ON n.id = fn.nutrient_id WHERE fn.food_id = $1',
                    [id],
                );
                expect(stored.rows.map((row) => row.unit).sort()).toStrictEqual(['kJ', 'kcal']);

                const [food] = (await nutritionOf([id])).foods;
                expect(food!.caloriesPer100g).toBe(239);
            });

            it('reports calories ABSENT when the only energy row is per_serving (the branded-label trap)', async () => {
                stub.programResolve('Branded bar', {
                    nutrients: [
                        { code: null, name: 'Energy', unit: 'kcal', amount: '190', basis: 'per_serving' },
                        { code: null, name: 'Protein', unit: 'g', amount: '10', basis: 'per_100g' },
                    ],
                });
                const id = await seedResolved('Branded bar');

                const [food] = (await nutritionOf([id])).foods;

                expect(food!).not.toHaveProperty('caloriesPer100g');
                expect(food!.proteinGPer100g).toBe(10);
            });

            it('reports calories ABSENT — never zero — when the food has no energy row at all', async () => {
                stub.programResolve('No energy food', {
                    nutrients: [{ code: null, name: 'Protein', unit: 'g', amount: '3.1', basis: 'per_100g' }],
                });
                const id = await seedResolved('No energy food');

                const [food] = (await nutritionOf([id])).foods;

                expect(food!).not.toHaveProperty('caloriesPer100g');
                expect(food!.caloriesPer100g).toBeUndefined();
            });

            it('does not read "Fatty acids, total trans" as total fat (the substring trap)', async () => {
                stub.programResolve('Trans only food', {
                    nutrients: [
                        { code: null, name: 'Fatty acids, total trans', unit: 'g', amount: '0.5', basis: 'per_100g' },
                    ],
                });
                const id = await seedResolved('Trans only food');

                const [food] = (await nutritionOf([id])).foods;

                expect(food!).not.toHaveProperty('fatGPer100g');
            });
        });

        // ── Portions (KTD-3: food normalizes, consumers do not parse) ───────────────────────────────────
        describe('portion normalization', () => {
            it('divides the gram weight by the label amount, singularizes the unit, and de-duplicates by unit', async () => {
                stub.programResolve('Portioned food', {
                    portions: [
                        { label: '2 cups sliced', gramWeight: '250' },
                        { label: '1/2 cup diced', gramWeight: '60' },
                        { label: '1 tablespoon', gramWeight: '15' },
                    ],
                });
                const id = await seedResolved('Portioned food');

                const [food] = (await nutritionOf([id])).foods;

                // 250/2 = 125 g per cup; the later `1/2 cup` entry is dropped as a duplicate unit (first wins),
                // which is why 120 must NOT appear.
                expect(food!.portions).toStrictEqual([
                    { unit: 'cup', gramsPerUnit: 125 },
                    { unit: 'tablespoon', gramsPerUnit: 15 },
                ]);
            });

            it('reports an uninterpretable label ABSENT rather than guessing a unit or a weight', async () => {
                stub.programResolve('Vague portions', {
                    portions: [
                        { label: 'serving', gramWeight: '55' },
                        { label: '1 clove', gramWeight: '3' },
                    ],
                });
                const id = await seedResolved('Vague portions');

                const [food] = (await nutritionOf([id])).foods;

                expect(food!.portions).toStrictEqual([{ unit: 'clove', gramsPerUnit: 3 }]);
            });

            it('returns an EMPTY portion list — not a missing field — for a food with no portions', async () => {
                stub.programResolve('No portions', { portions: [] });
                const id = await seedResolved('No portions');

                const [food] = (await nutritionOf([id])).foods;

                expect(food!.portions).toStrictEqual([]);
            });
        });

        // ── Unresolved / unknown ids are REPORTED, never silently dropped ───────────────────────────────
        describe('ids that carry no nutrition', () => {
            it('reports an unknown id in unknownIds and still serves the ids that do resolve', async () => {
                stub.programResolve('known food');
                const known = await seedResolved('known food');
                const ghost = ulid();

                const body = await nutritionOf([known, ghost]);

                expect(body.unknownIds).toStrictEqual([ghost]);
                expect(body.foods.map((food) => food.id)).toStrictEqual([known]);
            });

            it('is not an error for the whole batch when EVERY id is unknown', async () => {
                const ghosts = [ulid(), ulid()].sort();

                const body = await nutritionOf(ghosts);

                expect(body.foods).toStrictEqual([]);
                expect(body.unknownIds).toStrictEqual(ghosts);
            });

            it.each(['PENDING', 'AWAITING_RETRY', 'UNRESOLVED', 'FAILED', 'NOT_FOUND'])(
                'reports a %s food WITH its status rather than omitting it (U9 rides this wire)',
                async (status) => {
                    const id = await seedBareFood(`bare ${status}`, status);

                    const body = await nutritionOf([id]);

                    expect(body.unknownIds).toStrictEqual([]);
                    expect(body.foods).toStrictEqual([{ id, status, portions: [] }]);
                },
            );
        });

        // ── The id-list contract: the URL IS the cache key (ADR-0020) ───────────────────────────────────
        describe('the ?ids= contract', () => {
            it('rejects more than the cap with the published BATCH_TOO_LARGE envelope → 400', async () => {
                const ids = Array.from({ length: MAX_NUTRITION_IDS + 1 }, () => ulid());

                const res = await nutrition(ids);

                expect(res.status).toBe(400);
                const parsed = publishedFoodErrorSchema.parse(res.body);
                expect(parsed.code).toBe('BATCH_TOO_LARGE');
                expect(parsed.message).toContain(String(MAX_NUTRITION_IDS));
            });

            it('accepts EXACTLY the cap — the boundary is inclusive', async () => {
                const ids = Array.from({ length: MAX_NUTRITION_IDS }, () => ulid());

                const res = await nutrition(ids);

                expect(res.status).toBe(200);
                expect((res.body as { unknownIds: string[] }).unknownIds).toHaveLength(MAX_NUTRITION_IDS);
            });

            it('counts DISTINCT ids against the cap — duplicates cannot smuggle a request past it', async () => {
                const distinct = Array.from({ length: MAX_NUTRITION_IDS }, () => ulid());

                const res = await nutrition([...distinct, distinct[0]!, distinct[1]!]);

                expect(res.status).toBe(200);
                expect((res.body as { unknownIds: string[] }).unknownIds).toHaveLength(MAX_NUTRITION_IDS);
            });

            it.each([
                ['an absent ids parameter', '/api/v1/foods/nutrition'],
                ['an empty ids parameter', '/api/v1/foods/nutrition?ids='],
                ['a list of only separators', '/api/v1/foods/nutrition?ids=,,,'],
            ])('rejects %s → 400 with a published error code', async (_case, path) => {
                const res = await call(path, userToken);

                expect(res.status).toBe(400);
                expect(publishedFoodErrorSchema.safeParse(res.body).success).toBe(true);
            });

            it('rejects an unrecognized query parameter → 400, so nothing can fork the cache key', async () => {
                const id = ulid();

                const res = await call(`/api/v1/foods/nutrition?ids=${id}&fields=calories`, userToken);

                expect(res.status).toBe(400);
            });

            it('is not swallowed by the `:id` routes — `nutrition` never binds as a food id', async () => {
                const res = await call('/api/v1/foods/nutrition?ids=notaulid', userToken);

                // A route-order regression makes this a 400 INVALID_ID (or a 404) from `GET /:id` instead of a
                // 200 batch reporting the id as unknown.
                expect(res.status).toBe(200);
                expect((res.body as { unknownIds: string[] }).unknownIds).toStrictEqual(['notaulid']);
            });
        });
    },
);
