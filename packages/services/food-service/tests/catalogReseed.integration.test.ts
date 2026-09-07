/**
 * U12b (integration, real Postgres) — the food-catalog RESEED, the half of U12 that puts the catalog back.
 * Requirements R44–R47; plan `docs/plans/2026-08-20-001-fix-ingredient-resolution-quality-plan.md` §U12,
 * Sequencing step 5.
 *
 * ⛔ WHY THIS TIER. Every claim the reseed makes is a claim about ROWS, and a mocked store cannot make one:
 *
 *  1. **`origin = 'bulk'` on every reseeded row (R47)** is written by `FoodDao.markOrigin` inside the
 *     seed's transaction; a fake store proves only that we called our own fake.
 *  2. **⚠️ `food.aliases` is NULL across the WHOLE reseeded catalog.** This is the consequence the plan's
 *     premise did not anticipate and it is asserted here against real rows rather than argued in a
 *     comment: U2 measured that USDA publishes "additional descriptions" only for Survey (FNDDS) foods,
 *     and the roster this reseed ships enables `foundation_food` + `sr_legacy_food`, which carry none.
 *     So a reseed does NOT, on its own, make U2's alias ranking observable. Whether to add FNDDS is a
 *     product decision (composite prepared dishes competing with ingredient rows) and is not taken here.
 *  3. **The ULIDs are FRESH.** The whole reason U12 is a two-service operation is that a reseed does not
 *     reuse the ids the recipe service holds. That is a fact about `ulid()` and the find-or-create, and it
 *     is proved below by clearing a seeded catalog and reseeding the same files.
 *  4. **`ON DELETE CASCADE` + fresh ids ⇒ no dangling `food_id`** — the plan's verification line, which
 *     spans two databases, so the suite carries a recipe-shaped sibling database to observe it in.
 *  5. **The dry run writes NOTHING** — provable only by counting real rows before and after.
 *
 * The recipe-side unlink is applied here as the plain `UPDATE` the recipe service's own
 * `ingredients:unlink` command performs (`packages/services/recipe-service/src/ingredients/unlinkCli.ts`).
 * The food service cannot import that workspace, and re-proving the unlink is U12a's job — what this suite
 * needs from it is only its EFFECT, so that the end-to-end invariant in (4) can be observed at all.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { isNotNull, sql } from 'drizzle-orm';
import pg from 'pg';

import { food } from '../src/db/schema/index.js';
import { FoodDao } from '../src/foods/dao/food.dao.js';
import { FoodSourcesDao } from '../src/foods/dao/foodSources.dao.js';
import { GoldenRecordMergeEngine } from '../src/foods/merge/mergeEngine.js';
import { MergeAndPersistService } from '../src/foods/merge/mergeAndPersist.service.js';
import { BulkSeedService } from '../src/foods/seed/bulkSeed.service.js';
import { CATALOG_DATASETS, enabledDataTypes, type CatalogDataset } from '../src/foods/seed/catalogDatasets.js';
import {
    createBulkSourceReader,
    createCatalogInventory,
    runCatalogReseed,
    type CatalogReseedDeps,
    type ReseedCliOptions,
} from '../src/foods/seed/reseedCli.js';
import { isCatalogReseedRefusedError, isCatalogReseedUnverifiedError } from '../src/foods/seed/reseedCli.errors.js';
import {
    createFoodCatalogStore,
    createRecipeLinkageProbe,
    describeDatabaseTarget,
    describeTargetToken,
    runCatalogClear,
} from '../src/foods/seed/clearCli.js';
import { SourceAdapterRegistry } from '../src/sources/SourceAdapterRegistry.js';
import { SilentWorkerLogger } from '../src/worker/SilentWorkerLogger.js';
import { DATABASE_URL, makeDb, makePool, resetSchema, type TestDb } from './support/db.js';

/** A sibling database standing in for the recipe service's, so the cross-service invariant is observable. */
const PROBE_DB_NAME = 'food_test_u12b_recipe_probe';

/** Quote every field the way FDC does, and join with LF (the published files are LF-only). */
function csv(rows: readonly (readonly string[])[]): string {
    return `${rows.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\n')}\n`;
}

/** Swap the database out of a `postgres://` URL, keeping host, port and credentials. */
function urlForDatabase(base: string, database: string): string {
    const url = new URL(base);

    url.pathname = `/${database}`;

    return url.toString();
}

describe.skipIf(!DATABASE_URL)('food catalog reseed (integration)', () => {
    let pool: pg.Pool;
    let db: TestDb;
    let probePool: pg.Pool;
    let probeUrl: string;
    let deps: CatalogReseedDeps;
    let dir: string;
    let emptyDir: string;

    /** A complete, valid options object; each test overrides only the field it is about. */
    /** The token this suite's REAL connection must be named by (PR #91 review) — read from the live server. */
    let liveTargetToken: string;

    function makeOptions(overrides: Partial<ReseedCliOptions> = {}): ReseedCliOptions {
        return {
            confirmTarget: liveTargetToken,
            stage: 'sandbox',
            confirm: 'sandbox',
            allowProd: false,
            dryRun: false,
            dirs: [dir],
            limit: undefined,
            datasets: CATALOG_DATASETS,
            ...overrides,
        };
    }

    /** Write a CSV file into a bulk directory. */
    function write(target: string, file: string, rows: readonly (readonly string[])[]): void {
        writeFileSync(join(target, file), csv(rows));
    }

    /**
     * Write a minimal-but-real bulk extraction: two seedable foods, one Branded row and one Survey
     * (FNDDS) row that the shipped roster must leave behind.
     */
    function writeDataset(target: string, seedable: boolean): void {
        write(target, 'food.csv', [
            ['fdc_id', 'data_type', 'description', 'food_category_id', 'publication_date'],
            ...(seedable
                ? [
                      ['170379', 'sr_legacy_food', 'Broccoli, raw', '11', '2019-04-01'],
                      ['747447', 'foundation_food', 'Cheese, cheddar', '1', '2019-12-16'],
                  ]
                : []),
            ['2057648', 'branded_food', 'GREEK YOGURT', 'Yogurt', '2021-07-29'],
            // The one data type USDA publishes curated aliases for — excluded by the shipped roster.
            ['2705709', 'survey_fndds_food', 'Cheese, cheddar, prepared', '1', '2024-10-31'],
        ]);
        write(target, 'food_nutrient.csv', [
            ['id', 'fdc_id', 'nutrient_id', 'amount'],
            ['1', '170379', '1003', '2.82'],
            ['2', '170379', '1008', '34'],
            ['3', '747447', '1003', '22.87'],
            ['4', '2705709', '1003', '21.00'],
        ]);
        write(target, 'nutrient.csv', [
            ['id', 'name', 'unit_name'],
            ['1003', 'Protein', 'G'],
            ['1008', 'Energy', 'KCAL'],
        ]);
    }

    /** Every `food` row's id + origin + aliases, ordered so two runs are comparable. */
    async function catalogRows(): Promise<
        { id: string; origin: string; aliases: string | null; name: string | null }[]
    > {
        return db
            .select({ id: food.id, origin: food.origin, aliases: food.aliases, name: food.name })
            .from(food)
            .orderBy(food.normalizedName);
    }

    beforeAll(async () => {
        pool = makePool();
        db = makeDb(pool);

        try {
            await pool.query(`CREATE DATABASE ${PROBE_DB_NAME}`);
        } catch (error: unknown) {
            // 42P04 = duplicate_database. Re-using it is fine; every run recreates its table.
            if ((error as { code?: string }).code !== '42P04') {
                throw error;
            }
        }

        probeUrl = urlForDatabase(DATABASE_URL ?? '', PROBE_DB_NAME);
        probePool = new pg.Pool({ connectionString: probeUrl });

        dir = mkdtempSync(join(tmpdir(), 'fdc-reseed-'));
        emptyDir = mkdtempSync(join(tmpdir(), 'fdc-reseed-empty-'));
        writeDataset(dir, true);
        writeDataset(emptyDir, false);

        deps = {
            source: createBulkSourceReader({
                dataTypes: enabledDataTypes(CATALOG_DATASETS),
                logger: new SilentWorkerLogger(),
            }),
            seeder: new BulkSeedService({
                foods: new FoodDao(db),
                sources: new FoodSourcesDao(db),
                persist: new MergeAndPersistService(db, new GoldenRecordMergeEngine(new SourceAdapterRegistry())),
                logger: new SilentWorkerLogger(),
            }),
            inventory: createCatalogInventory(db, pool),
        };
        liveTargetToken = describeTargetToken(await describeDatabaseTarget(pool));
    });

    afterAll(async () => {
        await probePool?.end();
        await pool?.end();
        rmSync(dir, { recursive: true, force: true });
        rmSync(emptyDir, { recursive: true, force: true });
    });

    beforeEach(async () => {
        await resetSchema(pool);
        await probePool.query('DROP TABLE IF EXISTS ingredients');
        await probePool.query(
            `CREATE TABLE ingredients (
                 id text PRIMARY KEY,
                 food_id text,
                 food_resolution_status text
             )`,
        );
    });

    describe('a reseed of a cleared catalog', () => {
        it('imports the roster’s data types and marks every row origin=bulk (R47)', async () => {
            const result = await runCatalogReseed(deps, makeOptions());

            expect(result).toMatchObject({ outcome: 'reseeded', candidates: 2, seeded: 2, failed: 0, foodsBefore: 0 });

            const rows = await catalogRows();

            expect(rows.map((row) => row.name)).toEqual(['Broccoli, raw', 'Cheese, cheddar']);
            expect(rows.every((row) => row.origin === 'bulk')).toBe(true);
        });

        it('leaves the Survey (FNDDS) row behind — the roster excludes it, and that is the alias source', async () => {
            await runCatalogReseed(deps, makeOptions());

            const rows = await catalogRows();

            expect(rows.map((row) => row.name)).not.toContain('Cheese, cheddar, prepared');
        });

        it('⚠️ leaves food.aliases NULL on EVERY reseeded row — the reseed does not, alone, make U2 observable', async () => {
            await runCatalogReseed(deps, makeOptions());

            const rows = await catalogRows();

            expect(rows).not.toHaveLength(0);
            expect(rows.map((row) => row.aliases)).toEqual([null, null]);

            const [withAliases] = await db
                .select({ count: sql<number>`count(*)::int` })
                .from(food)
                .where(isNotNull(food.aliases));

            expect(withAliases?.count).toBe(0);
        });

        it('reports the same alias count the post-condition judged, so the run’s own log is the evidence', async () => {
            const result = await runCatalogReseed(deps, makeOptions());

            expect(result).toMatchObject({ foodsWithAliases: 0, aliasesExpected: false });
        });
    });

    describe('the destructive-operation guard against a real catalog', () => {
        it('refuses without --confirm and writes NOTHING', async () => {
            await expect(runCatalogReseed(deps, makeOptions({ confirm: undefined }))).rejects.toSatisfy(
                isCatalogReseedRefusedError,
            );
            expect(await catalogRows()).toHaveLength(0);
        });

        it('refuses production without --allow-prod and writes NOTHING', async () => {
            await expect(runCatalogReseed(deps, makeOptions({ stage: 'prod', confirm: 'prod' }))).rejects.toSatisfy(
                isCatalogReseedRefusedError,
            );
            expect(await catalogRows()).toHaveLength(0);
        });

        it('a --dry-run reports what WOULD be imported and writes NOTHING', async () => {
            const result = await runCatalogReseed(deps, makeOptions({ dryRun: true, confirm: undefined }));

            expect(result).toMatchObject({ outcome: 'reported', candidates: 2, seeded: 0, wouldProceed: true });
            expect(await catalogRows()).toHaveLength(0);
        });

        it('a --dry-run against a directory with no seedable row reports wouldProceed=false', async () => {
            const result = await runCatalogReseed(deps, makeOptions({ dryRun: true, dirs: [emptyDir] }));

            expect(result).toMatchObject({ candidates: 0, wouldProceed: false });
        });
    });

    describe('the post-condition, against a real after-state', () => {
        it('fails an import that produced no row at all (the wrong --dir)', async () => {
            await expect(runCatalogReseed(deps, makeOptions({ dirs: [emptyDir] }))).rejects.toSatisfy(
                isCatalogReseedUnverifiedError,
            );
        });

        it('⚠️ fails when the roster PROMISES aliases and none land — the guard rail on enabling FNDDS', async () => {
            // Exactly the change a future operator would make: flip FNDDS on. The bulk reader does not read
            // USDA's `food_attribute.csv`, so the Survey rows arrive alias-less — and this is what stops
            // that landing silently.
            const withFndds: readonly CatalogDataset[] = CATALOG_DATASETS.map((dataset) =>
                dataset.dataType === 'survey_fndds_food' ? { ...dataset, enabled: true } : dataset,
            );
            const fnddsDeps: CatalogReseedDeps = {
                ...deps,
                source: createBulkSourceReader({
                    dataTypes: enabledDataTypes(withFndds),
                    logger: new SilentWorkerLogger(),
                }),
            };

            await expect(runCatalogReseed(fnddsDeps, makeOptions({ datasets: withFndds }))).rejects.toSatisfy(
                isCatalogReseedUnverifiedError,
            );

            const rows = await catalogRows();

            // The roster flip REACHED the reader — the Survey row is in the catalog. (Without this the
            // test would still pass if the adapter dropped the selection and simply re-imported the
            // default two datasets, which also land zero aliases: the right answer for the wrong reason.)
            expect(rows.map((row) => row.name)).toContain('Cheese, cheddar, prepared');
            // …it just arrived alias-less, which is the whole point of the guard rail.
            expect(rows.every((row) => row.aliases === null)).toBe(true);
            // And it failed AFTER writing, because a seed is not one transaction. The rows are there; the
            // remedy is to fix the cause and re-run, which is safe because the import is idempotent.
            expect(rows.length).toBeGreaterThan(0);
        });
    });

    describe('re-running', () => {
        it('is idempotent — a second run skips every food and reuses the SAME ids', async () => {
            await runCatalogReseed(deps, makeOptions());
            const first = await catalogRows();

            const second = await runCatalogReseed(deps, makeOptions());

            expect(second).toMatchObject({ unchanged: 2, seeded: 0, failed: 0 });
            expect((await catalogRows()).map((row) => row.id)).toEqual(first.map((row) => row.id));
        });

        it('⛔ mints FRESH ids after a clear — which is exactly why U12 is a two-service operation', async () => {
            await runCatalogReseed(deps, makeOptions());
            const before = await catalogRows();

            await runCatalogClear(
                {
                    linkage: createRecipeLinkageProbe(probePool),
                    catalog: createFoodCatalogStore(db, pool),
                },
                {
                    stage: 'sandbox',
                    confirm: 'sandbox',
                    allowProd: false,
                    dryRun: false,
                    recipeDatabaseUrl: probeUrl,
                    // PR #91 review: the clear now refuses a run that has not named the database it opened.
                    confirmTarget: liveTargetToken,
                },
            );
            await runCatalogReseed(deps, makeOptions());
            const after = await catalogRows();

            expect(after.map((row) => row.name)).toEqual(before.map((row) => row.name));
            expect(after.map((row) => row.id)).not.toEqual(before.map((row) => row.id));
        });
    });

    describe('the cross-service invariant (the plan’s verification line)', () => {
        it('unlink → clear → reseed leaves NO ingredients.food_id pointing at a missing food row', async () => {
            await runCatalogReseed(deps, makeOptions());
            const seeded = await catalogRows();

            // A recipe that resolved against the pre-reseed catalog.
            for (const [index, row] of seeded.entries()) {
                await probePool.query(
                    'INSERT INTO ingredients (id, food_id, food_resolution_status) VALUES ($1, $2, $3)',
                    [`ing-${index}`, row.id, 'resolved'],
                );
            }

            // The recipe-side unlink (U12a, half one) — the same in-place UPDATE that command performs.
            await probePool.query('UPDATE ingredients SET food_id = NULL, food_resolution_status = NULL');

            await runCatalogClear(
                { linkage: createRecipeLinkageProbe(probePool), catalog: createFoodCatalogStore(db, pool) },
                {
                    stage: 'sandbox',
                    confirm: 'sandbox',
                    allowProd: false,
                    dryRun: false,
                    recipeDatabaseUrl: probeUrl,
                    // PR #91 review: the clear now refuses a run that has not named the database it opened.
                    confirmTarget: liveTargetToken,
                },
            );
            await runCatalogReseed(deps, makeOptions());

            const linked = await probePool.query<{ food_id: string }>(
                'SELECT food_id FROM ingredients WHERE food_id IS NOT NULL',
            );
            const catalogIds = new Set((await catalogRows()).map((row) => row.id));
            const dangling = linked.rows.filter((row) => !catalogIds.has(row.food_id));

            expect(dangling).toEqual([]);
            // No row was DELETED by the reset — `recipe_ingredients.ingredient_id` is NOT NULL with no
            // ON DELETE, so the unlink nulls in place (U12a). The rows are still here, just unlinked.
            const remaining = await probePool.query<{ n: number }>('SELECT count(*)::int AS n FROM ingredients');

            expect(remaining.rows[0]?.n).toBe(seeded.length);
        });
    });
});
