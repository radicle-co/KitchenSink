/**
 * Integration suite for the USDA **bulk-download seed importer** (plan §2 Stage 1) against REAL Postgres.
 * Covers the two things unit tests structurally cannot prove:
 *
 *   1. **Idempotent, FK-safe re-runs (F-W2).** Re-running the importer over the same files must not
 *      duplicate a `food` row, duplicate a crosswalk row, duplicate portions, or trip the composite
 *      same-food provenance FK (`food_nutrients_provenance_same_food_fk`). The find-or-create is what
 *      makes that true — the raw `UNIQUE(source, external_key)` is NOT enough, because
 *      `onConflictDoUpdate` never updates `food_id`.
 *   2. **The F-C2 refresh exclusion is CORRECTNESS-critical, not just quota.** A bulk row's `item_version`
 *      can never equal an API version, so an unexcluded bulk food would be re-enqueued on EVERY sweep and
 *      have its lab-analyzed nutrition clobbered by API values via `mergeChangedSources`. The proof below
 *      runs a real `ChangeRefreshConsumer` pass over a bulk food and a live food side by side: the live
 *      one is fetched + enqueued, the bulk one is never even fetched.
 *
 * The importer NEVER calls the live USDA API (bulk files only), so neither does this suite — the only
 * adapter here is a fake used to drive the change-refresh comparison.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { ulid } from 'ulidx';
import type pg from 'pg';

import { CandidateStore } from '../src/foods/dao/food-candidates.dao.js';
import { FoodDao } from '../src/foods/dao/food.dao.js';
import { FoodSourcesDao } from '../src/foods/dao/food-sources.dao.js';
import { SourceCallLogDao } from '../src/foods/dao/source-call-log.dao.js';
import { EnqueueEmitter } from '../src/foods/enqueue.emitter.js';
import { makeMergeCandidate } from '../src/foods/merge/__fixtures__/merge.fixtures.js';
import { GoldenRecordMergeEngine } from '../src/foods/merge/merge-engine.js';
import { MergeAndPersistService } from '../src/foods/merge/merge-and-persist.service.js';
import { BulkSeedService } from '../src/foods/seed/bulk-seed.service.js';
import {
    SourceAdapterRegistry,
    type CanonicalCandidate,
    type FoodSourceAdapter,
    type SourceCandidate,
} from '../src/sources/food-source-adapter.js';
import { streamBulkCandidates } from '../src/sources/usda/bulk/usda-bulk.reader.js';
import { RollingWindowLimiter } from '../src/sources/rolling-window-limiter.js';
import { ChangeRefreshConsumer } from '../src/worker/change-refresh/change-refresh.consumer.js';
import { SilentWorkerLogger } from '../src/worker/worker-logger.js';
import { DATABASE_URL, makeDb, makePool, resetSchema, type TestDb } from './support/db.js';

describe.skipIf(!DATABASE_URL)('USDA bulk seed importer (integration)', () => {
    let pool: pg.Pool;
    let db: TestDb;
    let foods: FoodDao;
    let sources: FoodSourcesDao;
    let merge: MergeAndPersistService;
    let seeder: BulkSeedService;

    beforeAll(() => {
        pool = makePool();
        db = makeDb(pool);
        foods = new FoodDao(db);
        sources = new FoodSourcesDao(db);
        merge = new MergeAndPersistService(db, new GoldenRecordMergeEngine(new SourceAdapterRegistry()));
        seeder = new BulkSeedService({ foods, sources, persist: merge, logger: new SilentWorkerLogger() });
    });

    afterAll(async () => {
        await pool?.end();
    });

    beforeEach(async () => {
        await resetSchema(pool);
    });

    /** A one-shot async stream of candidates (stands in for the bulk reader). */
    async function* stream(...candidates: readonly CanonicalCandidate[]): AsyncGenerator<CanonicalCandidate> {
        for (const candidate of candidates) {
            yield candidate;
        }
    }

    /** A bulk-shaped canonical candidate (per-100g nutrients, a portion, a `bulk:` item version). */
    const bulk = (overrides: Partial<CanonicalCandidate> = {}): CanonicalCandidate =>
        makeMergeCandidate('usda', {
            externalKey: '170379',
            name: 'Broccoli, raw',
            description: 'Broccoli, raw',
            nutrients: [
                { code: null, name: 'Protein', unit: 'g', amount: '2.82', basis: 'per_100g' },
                { code: null, name: 'Energy', unit: 'kcal', amount: '34', basis: 'per_100g' },
            ],
            portions: [{ label: 'cup, chopped', gramWeight: '91' }],
            itemVersion: 'bulk:v1',
            ...overrides,
        });

    /** Count rows matching a single-parameter predicate. */
    async function count(sql: string, params: readonly unknown[] = []): Promise<number> {
        const result = await pool.query<{ n: number }>(sql, [...params]);

        return result.rows[0]!.n;
    }

    // ── Seeding as RESOLVED golden records ──────────────────────────────────────────────────────────
    it('persists a bulk food as a RESOLVED golden record with bulk origin and full provenance', async () => {
        const result = await seeder.seed(stream(bulk()));

        expect(result).toMatchObject({ total: 1, seeded: 1, refreshed: 0, unchanged: 0, failed: 0 });

        const foodId = await sources.findFoodIdByExternalKey('usda', '170379');
        expect(foodId).toBeDefined();

        const record = await foods.readGoldenRecord(foodId!);
        expect(record?.status).toBe('RESOLVED');
        expect(record?.name).toBe('Broccoli, raw');
        expect(record?.nutrients).toHaveLength(2);
        expect(record?.portions).toHaveLength(1);
        // The nutrient dictionary auto-resolves inside persistResolved — no pre-population needed.
        expect(await count('SELECT count(*)::int AS n FROM nutrient')).toBe(2);
        // Every value carries a resolvable same-food source_id (D-PROVENANCE-FK).
        const crosswalkIds = new Set(record?.sources.map((source) => source.id));
        expect(record?.nutrients.every((entry) => crosswalkIds.has(entry.sourceId))).toBe(true);
        expect(record?.portions.every((entry) => crosswalkIds.has(entry.sourceId))).toBe(true);
        expect(record?.fieldProvenance.length).toBeGreaterThan(0);

        const origin = await pool.query<{ origin: string }>('SELECT origin FROM food WHERE id = $1', [foodId]);
        expect(origin.rows[0]?.origin).toBe('bulk');
    });

    it('seeds many foods in one pass and reports the final count', async () => {
        const result = await seeder.seed(
            stream(
                bulk({ externalKey: '170379', name: 'Broccoli, raw' }),
                bulk({ externalKey: '747447', name: 'Cheese, cheddar' }),
                bulk({ externalKey: '169967', name: 'Apples, raw, with skin' }),
            ),
        );

        expect(result).toMatchObject({ total: 3, seeded: 3, failed: 0 });
        expect(await count(`SELECT count(*)::int AS n FROM food WHERE status = 'RESOLVED'`)).toBe(3);
        expect(await count('SELECT count(*)::int AS n FROM food_sources')).toBe(3);
    });

    // ── Idempotent re-run (F-W2) ────────────────────────────────────────────────────────────────────
    it('re-running the identical seed neither duplicates nor FK-violates (idempotent, resumable)', async () => {
        await seeder.seed(stream(bulk()));
        const first = await sources.findFoodIdByExternalKey('usda', '170379');

        const second = await seeder.seed(stream(bulk()));

        expect(second).toMatchObject({ total: 1, unchanged: 1, seeded: 0, refreshed: 0, failed: 0 });
        expect(await count('SELECT count(*)::int AS n FROM food')).toBe(1);
        expect(await count('SELECT count(*)::int AS n FROM food_sources')).toBe(1);
        expect(await count('SELECT count(*)::int AS n FROM food_portions')).toBe(1);
        expect(await count('SELECT count(*)::int AS n FROM food_nutrients')).toBe(2);
        expect(await sources.findFoodIdByExternalKey('usda', '170379')).toBe(first);
    });

    it('re-seeding a NEW bulk revision updates values in place, staying RESOLVED with one crosswalk row', async () => {
        await seeder.seed(stream(bulk()));
        const foodId = (await sources.findFoodIdByExternalKey('usda', '170379'))!;
        const before = await pool.query<{ id: string }>('SELECT id FROM food_sources WHERE food_id = $1', [foodId]);

        const result = await seeder.seed(
            stream(
                bulk({
                    itemVersion: 'bulk:v2',
                    nutrients: [
                        { code: null, name: 'Protein', unit: 'g', amount: '3.10', basis: 'per_100g' },
                        { code: null, name: 'Energy', unit: 'kcal', amount: '34', basis: 'per_100g' },
                    ],
                    portions: [{ label: 'cup, chopped', gramWeight: '92' }],
                }),
            ),
        );

        expect(result).toMatchObject({ total: 1, refreshed: 1, unchanged: 0, seeded: 0, failed: 0 });

        const record = await foods.readGoldenRecord(foodId);
        expect(record?.status).toBe('RESOLVED');
        expect(record?.nutrients.find((entry) => entry.name === 'Protein')?.amount).toBe('3.10');
        // Portions are REPLACED per source, not appended (mergeChangedSources drop-then-insert).
        expect(record?.portions).toHaveLength(1);
        expect(record?.portions[0]?.gramWeight).toBe('92');
        // The crosswalk row keeps its identity (so every provenance FK still resolves) and advances.
        const after = await pool.query<{ id: string; item_version: string }>(
            'SELECT id, item_version FROM food_sources WHERE food_id = $1',
            [foodId],
        );
        expect(after.rows).toHaveLength(1);
        expect(after.rows[0]?.id).toBe(before.rows[0]?.id);
        expect(after.rows[0]?.item_version).toBe('bulk:v2');
    });

    it('collapses two different fdcIds that normalize to the SAME name onto one food (no 23505)', async () => {
        const result = await seeder.seed(
            stream(
                bulk({ externalKey: '170379', name: 'Broccoli, raw' }),
                bulk({ externalKey: '999999', name: 'BROCCOLI,  RAW', itemVersion: 'bulk:other' }),
            ),
        );

        expect(result.failed).toBe(0);
        expect(await count('SELECT count(*)::int AS n FROM food')).toBe(1);
        expect(await count('SELECT count(*)::int AS n FROM food_sources')).toBe(2);
    });

    it('reactivates a NOT_FOUND tombstone rather than failing on an illegal transition', async () => {
        const created = await foods.createByName({ normalizedName: 'broccoli, raw', displayName: 'Broccoli, raw' });
        await foods.setStatus({ id: created.id, status: 'NOT_FOUND' });

        const result = await seeder.seed(stream(bulk()));

        expect(result).toMatchObject({ total: 1, seeded: 1, failed: 0 });
        const row = await foods.getById(created.id);
        expect(row?.status).toBe('RESOLVED');
        expect(row?.tombstonedAt).toBeNull();
    });

    it('resolves an UNRESOLVED food and clears its now-obsolete candidate set', async () => {
        const created = await foods.createByName({ normalizedName: 'broccoli, raw', displayName: 'Broccoli, raw' });
        await merge.resolveAndPersist({
            foodId: created.id,
            candidates: [
                makeMergeCandidate('usda', { externalKey: 'amb-1', name: 'Broccoli, raw' }),
                makeMergeCandidate('usda', { externalKey: 'amb-2', name: 'Broccoli florets' }),
            ],
        });
        expect((await foods.getById(created.id))?.status).toBe('UNRESOLVED');
        expect(await count('SELECT count(*)::int AS n FROM food_candidates')).toBe(2);

        const result = await seeder.seed(stream(bulk()));

        expect(result).toMatchObject({ total: 1, seeded: 1, failed: 0 });
        expect((await foods.getById(created.id))?.status).toBe('RESOLVED');
        expect(await count('SELECT count(*)::int AS n FROM food_candidates')).toBe(0);
    });

    // ── The `origin` column + its backfill semantics (F-C2 / F3) ─────────────────────────────────────
    describe('food.origin column', () => {
        it("defaults to 'live' for a row inserted without it (the migration backfill for existing rows)", async () => {
            const id = ulid();
            await pool.query(
                `INSERT INTO food (id, name, normalized_name, status) VALUES ($1, 'Kale', 'kale', 'PENDING')`,
                [id],
            );

            const row = await foods.getById(id);
            expect(row?.origin).toBe('live');
        });

        it('rejects an out-of-set origin value (the enum is the durable backstop)', async () => {
            await expect(
                pool.query(
                    `INSERT INTO food (id, name, normalized_name, status, origin) VALUES ($1, 'Kale', 'kale', 'PENDING', 'bogus')`,
                    [ulid()],
                ),
            ).rejects.toThrow();
        });
    });

    // ── F-C2: the live change-refresh exclusion ──────────────────────────────────────────────────────
    describe('live change-refresh exclusion (F-C2 — correctness, not just quota)', () => {
        type FakeAdapter = FoodSourceAdapter & { fetchByKey: Mock<(key: string) => Promise<CanonicalCandidate>> };

        /** A fake adapter that reports a DIFFERENT item version for every key it is asked about. */
        function fakeAdapter(): FakeAdapter {
            return {
                source: 'usda',
                searchByName: vi.fn<(name: string) => Promise<SourceCandidate[]>>(async () => []),
                fetchByKey: vi.fn<(key: string) => Promise<CanonicalCandidate>>(async (key) =>
                    makeMergeCandidate('usda', { externalKey: key, name: key, itemVersion: 'api-2026-07-26' }),
                ),
            };
        }

        /** Build a real change-refresh consumer over the fake adapter. */
        function consumerOver(adapter: FoodSourceAdapter): ChangeRefreshConsumer {
            const registry = new SourceAdapterRegistry();
            registry.register(adapter);

            return new ChangeRefreshConsumer({
                sources,
                candidates: new CandidateStore(db),
                registry,
                limiter: new RollingWindowLimiter(new SourceCallLogDao(db)),
                enqueue: new EnqueueEmitter(pool),
                logger: new SilentWorkerLogger(),
            });
        }

        /** Resolve a food through the ordinary LIVE path (origin stays the 'live' default). */
        async function seedLiveResolved(name: string, externalKey: string): Promise<string> {
            const { id } = await foods.createByName({ normalizedName: name.toLowerCase(), displayName: name });
            await merge.resolveAndPersist({
                foodId: id,
                candidates: [makeMergeCandidate('usda', { externalKey, name, itemVersion: 'api-2026-01-01' })],
            });

            return id;
        }

        it('omits bulk-origin backing items from listResolvedBackingItems while keeping live ones', async () => {
            await seeder.seed(stream(bulk({ externalKey: 'ek-bulk', name: 'Broccoli, raw' })));
            const liveId = await seedLiveResolved('Spinach', 'ek-live');

            const items = await sources.listResolvedBackingItems();

            expect(items.map((item) => item.externalKey)).toEqual(['ek-live']);
            expect(items[0]?.foodId).toBe(liveId);
        });

        it('never re-fetches or re-enqueues a bulk food, but DOES refresh the live one in the same pass', async () => {
            await seeder.seed(stream(bulk({ externalKey: 'ek-bulk', name: 'Broccoli, raw' })));
            const bulkId = (await sources.findFoodIdByExternalKey('usda', 'ek-bulk'))!;
            const liveId = await seedLiveResolved('Spinach', 'ek-live');

            const adapter = fakeAdapter();
            const result = await consumerOver(adapter).runOnce();

            // Without the `AND f.origin <> 'bulk'` gate this asserts the failure precisely: the bulk row's
            // 'bulk:v1' version can never equal 'api-2026-07-26', so it WOULD be fetched + enqueued every
            // sweep, and the drain would clobber its lab-analyzed nutrition with API values.
            const fetched = adapter.fetchByKey.mock.calls.map(([key]) => key);
            expect(fetched).toEqual(['ek-live']);
            expect(result.scanned).toBe(1);
            expect(result.enqueued).toBe(1);
            expect(await count('SELECT count(*)::int AS n FROM fetch_queue WHERE food_id = $1', [bulkId])).toBe(0);
            expect(await count('SELECT count(*)::int AS n FROM fetch_queue WHERE food_id = $1', [liveId])).toBe(1);
        });

        it('drops a previously-live food out of the scan once the bulk seed re-classifies it', async () => {
            const id = await seedLiveResolved('Broccoli, raw', 'ek-shared');
            expect((await sources.listResolvedBackingItems()).map((item) => item.foodId)).toEqual([id]);

            await seeder.seed(stream(bulk({ externalKey: 'ek-shared', itemVersion: 'bulk:v1' })));

            expect((await foods.getById(id))?.origin).toBe('bulk');
            expect(await sources.listResolvedBackingItems()).toEqual([]);
        });

        it('does not exclude bulk-origin foods from anything else (they stay searchable + readable)', async () => {
            await seeder.seed(stream(bulk()));
            const foodId = (await sources.findFoodIdByExternalKey('usda', '170379'))!;

            expect((await foods.readGoldenRecord(foodId))?.status).toBe('RESOLVED');
            const hits = await pool.query(
                `SELECT id FROM food WHERE search_vector @@ plainto_tsquery('english', 'broccoli')`,
            );
            expect(hits.rows).toHaveLength(1);
        });
    });

    // ── End-to-end: real CSV files → parser → seeder → golden records ───────────────────────────────
    describe('reader → seeder pipeline over real on-disk bulk CSVs', () => {
        let dir: string;

        beforeEach(() => {
            dir = mkdtempSync(join(tmpdir(), 'fdc-seed-'));
        });

        afterAll(() => {
            rmSync(dir, { recursive: true, force: true });
        });

        /** Write an FDC-shaped (fully quoted, LF) CSV. */
        function write(file: string, rows: readonly (readonly string[])[]): void {
            const body = rows.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\n');
            writeFileSync(join(dir, file), `${body}\n`);
        }

        it('seeds Foundation + SR Legacy from CSVs and NEVER seeds the Branded rows in the same file', async () => {
            write('food.csv', [
                ['fdc_id', 'data_type', 'description', 'food_category_id', 'publication_date'],
                ['170379', 'sr_legacy_food', 'Broccoli, raw', '11', '2019-04-01'],
                ['747447', 'foundation_food', 'Cheese, cheddar', '1', '2019-12-16'],
                ['2057648', 'branded_food', 'GREEK YOGURT, PLAIN', 'Yogurt', '2021-07-29'],
            ]);
            write('food_nutrient.csv', [
                [
                    'id',
                    'fdc_id',
                    'nutrient_id',
                    'amount',
                    'data_points',
                    'derivation_id',
                    'min',
                    'max',
                    'median',
                    'footnote',
                    'min_year_acquired',
                ],
                ['1', '170379', '1003', '2.82', '', '71', '', '', '', '', ''],
                ['2', '170379', '1114', '0.1', '', '71', '', '', '', '', ''],
                // Blank amount + a nutrient_id absent from nutrient.csv: both dropped, food still seeds.
                ['3', '170379', '1008', '', '', '71', '', '', '', '', ''],
                ['4', '170379', '2066', '9', '', '71', '', '', '', '', ''],
                ['5', '747447', '1003', '22.87', '', '71', '', '', '', '', ''],
                ['6', '2057648', '1003', '9.5', '', '71', '', '', '', '', ''],
            ]);
            write('nutrient.csv', [
                ['id', 'name', 'unit_name', 'nutrient_nbr', 'rank'],
                ['1003', 'Protein', 'G', '203', '600'],
                ['1008', 'Energy', 'KCAL', '208', '300'],
                ['1114', 'Vitamin D (D2 + D3)', 'UG', '328', '8700'],
            ]);
            write('food_portion.csv', [
                [
                    'id',
                    'fdc_id',
                    'seq_num',
                    'amount',
                    'measure_unit_id',
                    'portion_description',
                    'modifier',
                    'gram_weight',
                    'data_points',
                    'footnote',
                    'min_year_acquired',
                ],
                ['10', '170379', '1', '1', '1000', '', 'cup, chopped', '91', '', '', ''],
            ]);
            write('measure_unit.csv', [
                ['id', 'name'],
                ['1000', 'cup'],
            ]);

            const result = await seeder.seed(streamBulkCandidates({ dir }));

            expect(result).toMatchObject({ total: 2, seeded: 2, failed: 0 });
            expect(await count('SELECT count(*)::int AS n FROM food')).toBe(2);
            expect(await sources.findFoodIdByExternalKey('usda', '2057648')).toBeUndefined();

            const broccoliId = (await sources.findFoodIdByExternalKey('usda', '170379'))!;
            const record = await foods.readGoldenRecord(broccoliId);
            expect(record?.status).toBe('RESOLVED');
            expect(record?.nutrients.map((entry) => `${entry.name} ${entry.unit}`).sort()).toEqual([
                'Protein g',
                'Vitamin d (d2 + d3) µg',
            ]);
            expect(record?.portions).toEqual([expect.objectContaining({ label: 'cup, chopped', gramWeight: '91' })]);
            expect(record?.sources[0]?.itemVersion?.startsWith('bulk:')).toBe(true);

            // Re-running the very same directory is a clean no-op (resumable).
            const rerun = await seeder.seed(streamBulkCandidates({ dir }));
            expect(rerun).toMatchObject({ total: 2, unchanged: 2, seeded: 0, refreshed: 0, failed: 0 });
            expect(await count('SELECT count(*)::int AS n FROM food')).toBe(2);
        });
    });
});
