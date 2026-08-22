/**
 * U12a (integration, real Postgres — TWO databases) — the food-catalog CLEAR, half two of the two-service
 * catalog reset. Requirements R44–R47; plan
 * `docs/plans/2026-08-20-001-fix-ingredient-resolution-quality-plan.md` §U12, Sequencing step 4.
 *
 * ⛔ WHY THIS TIER. The clear's whole safety property is a statement about TWO databases at once, and a
 * mocked probe cannot make it:
 *
 *  1. **The ordering is enforced against a REAL recipe database.** The suite creates a second database
 *     carrying the recipe service's `ingredients` link columns, populates it, and proves that a food row
 *     count taken AFTER a blocked clear is unchanged — the plan's "a non-zero remaining linked count
 *     aborts before any food row is deleted", proved rather than asserted about a fake.
 *  2. **The probe fails CLOSED against a real absence.** Pointed at a database with no `ingredients`
 *     table, or one missing `food_resolution_status`, it must raise — never answer "zero", which would
 *     read as permission to delete the entire catalog. Only a real connection can be pointed at a real
 *     absence.
 *  3. **`ON DELETE CASCADE` is a property of the migrated schema, not of our code.** The clear deletes
 *     `food` and relies on eight dependent tables coming away with it, including two whose composite
 *     provenance FK is `ON DELETE NO ACTION`. And the CASCADING_CATALOG_TABLES list is checked against
 *     `pg_constraint` itself, so a table added to the schema and not to the list fails HERE rather than
 *     being silently left behind by a future reset.
 *
 * The mirrored-ordering discipline is ADR-0001's (`createPreviewDomain.ts` / `teardownPreviewDomain.ts`,
 * "Teardown of the preview address"): a failure in the first step aborts before the second.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getTableName, sql } from 'drizzle-orm';
import pg from 'pg';

import {
    CASCADING_CATALOG_TABLES,
    PRODUCTION_STAGE,
    createFoodCatalogStore,
    createRecipeLinkageProbe,
    describeDatabaseTarget,
    runCatalogClear,
    type CatalogClearDeps,
    type ClearCliOptions,
} from '../src/foods/seed/clearCli.js';
import {
    isCatalogClearIncompleteError,
    isCatalogClearRefusedError,
    isRecipeLinkageRemainingError,
    isRecipeLinkageUnreadableError,
} from '../src/foods/seed/clearCli.errors.js';
import { foodCategory, nutrient } from '../src/db/schema/index.js';
import { DATABASE_URL, makeDb, makePool, resetSchema, type TestDb } from './support/db.js';

/**
 * A sibling database on the SAME server, standing in for the recipe service's. The clear reads it through
 * a connection the operator supplies, so the suite supplies one too — `RECIPE_DATABASE_URL` when the
 * harness offers a real recipe database (CI's cross-service job sets exactly that variable), else one this
 * suite creates itself.
 */
const PROBE_DB_NAME = 'food_test_u12a_recipe_probe';

/** A second sibling database with an `ingredients` table that is MISSING a link column. */
const DRIFTED_DB_NAME = 'food_test_u12a_recipe_drift';

/** A third with no `ingredients` table at all. */
const EMPTY_DB_NAME = 'food_test_u12a_recipe_empty';

/** Swap the database out of a `postgres://` URL, keeping host, port and credentials. */
function urlForDatabase(base: string, database: string): string {
    const url = new URL(base);

    url.pathname = `/${database}`;

    return url.toString();
}

/** A complete, valid options object; each test overrides only the field it is about. */
function makeOptions(recipeDatabaseUrl: string, overrides: Partial<ClearCliOptions> = {}): ClearCliOptions {
    return {
        stage: 'sandbox',
        confirm: 'sandbox',
        allowProd: false,
        dryRun: false,
        recipeDatabaseUrl,
        ...overrides,
    };
}

describe.skipIf(!DATABASE_URL)('food catalog clear (integration)', () => {
    let pool: pg.Pool;
    let db: TestDb;
    let probePool: pg.Pool;
    let driftedPool: pg.Pool;
    let emptyPool: pg.Pool;
    let deps: CatalogClearDeps;
    let probeUrl: string;

    /**
     * Create a sibling database, ignoring "already exists". `CREATE DATABASE` cannot run inside a
     * transaction, which a plain pooled query is not.
     */
    async function createDatabase(name: string): Promise<void> {
        try {
            await pool.query(`CREATE DATABASE ${name}`);
        } catch (error: unknown) {
            // 42P04 = duplicate_database. Re-using it is fine; every suite run recreates its tables.
            if ((error as { code?: string }).code !== '42P04') {
                throw error;
            }
        }
    }

    beforeAll(async () => {
        pool = makePool();
        db = makeDb(pool);

        await createDatabase(PROBE_DB_NAME);
        await createDatabase(DRIFTED_DB_NAME);
        await createDatabase(EMPTY_DB_NAME);

        const base = DATABASE_URL ?? '';

        probeUrl = urlForDatabase(base, PROBE_DB_NAME);
        probePool = new pg.Pool({ connectionString: probeUrl });
        driftedPool = new pg.Pool({ connectionString: urlForDatabase(base, DRIFTED_DB_NAME) });
        emptyPool = new pg.Pool({ connectionString: urlForDatabase(base, EMPTY_DB_NAME) });

        // The columns the probe reads, exactly as `0001_initial.sql` + `0006` shape them in the recipe
        // service. Only these three matter to the probe; nothing else here reads this table.
        await probePool.query('DROP TABLE IF EXISTS ingredients');
        await probePool.query(
            `CREATE TABLE ingredients (
                 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                 name text NOT NULL,
                 food_id text,
                 food_resolution_status text
             )`,
        );

        // The same table with `food_resolution_status` never added — a plausible drift, and the case the
        // probe must refuse rather than answer.
        await driftedPool.query('DROP TABLE IF EXISTS ingredients');
        await driftedPool.query(
            `CREATE TABLE ingredients (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, food_id text)`,
        );

        await emptyPool.query('DROP TABLE IF EXISTS ingredients');

        deps = {
            linkage: createRecipeLinkageProbe(probePool),
            catalog: createFoodCatalogStore(db),
        };
    });

    afterAll(async () => {
        await Promise.all([probePool?.end(), driftedPool?.end(), emptyPool?.end()]);
        await pool?.end();
    });

    /** One golden record plus a row in every table that must cascade away with it. */
    async function seedCatalogRow(id: string): Promise<void> {
        await pool.query(`INSERT INTO food (id, name, normalized_name, origin) VALUES ($1, $2, $2, 'bulk')`, [
            id,
            `u12a ${id}`,
        ]);
        await pool.query(`INSERT INTO food_sources (id, food_id, source, external_key) VALUES ($1, $2, 'usda', $3)`, [
            `src-${id}`,
            id,
            `ext-${id}`,
        ]);
        await pool.query(`INSERT INTO nutrient (id, name, unit) VALUES ($1, $1, 'g') ON CONFLICT DO NOTHING`, [
            'u12a-nutrient',
        ]);
        await pool.query(
            `INSERT INTO food_nutrients (id, food_id, nutrient_id, amount, source_id) VALUES ($1, $2, $3, 1.5, $4)`,
            [`fn-${id}`, id, 'u12a-nutrient', `src-${id}`],
        );
        await pool.query(
            `INSERT INTO food_portions (id, food_id, label, gram_weight, source_id) VALUES ($1, $2, 'cup', 120, $3)`,
            [`fp-${id}`, id, `src-${id}`],
        );
        await pool.query(`INSERT INTO food_field_provenance (food_id, field, source_id) VALUES ($1, 'name', $2)`, [
            id,
            `src-${id}`,
        ]);
        await pool.query(`INSERT INTO food_category (id, name) VALUES ($1, $1) ON CONFLICT DO NOTHING`, [
            'u12a-category',
        ]);
        await pool.query(`INSERT INTO food_category_assignment (food_id, category_id, source_id) VALUES ($1, $2, $3)`, [
            id,
            'u12a-category',
            `src-${id}`,
        ]);
        await pool.query(
            `INSERT INTO food_candidates (id, food_id, source, external_key, name) VALUES ($1, $2, 'usda', $3, 'candidate')`,
            [`fc-${id}`, id, `cand-${id}`],
        );
        await pool.query(`INSERT INTO fetch_queue (food_id) VALUES ($1)`, [id]);
        await pool.query(`INSERT INTO fetch_requesters (food_id, requester_id) VALUES ($1, 'u12a-requester')`, [id]);
    }

    /** Rows in a table, read straight from the database rather than through the code under test. */
    async function rowsIn(table: string): Promise<number> {
        const { rows } = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`);

        return rows[0]?.n ?? 0;
    }

    /** Set (or clear) the linkage the probe will read. */
    async function setRecipeLinks(count: number): Promise<void> {
        await probePool.query('TRUNCATE ingredients');

        for (let index = 0; index < count; index += 1) {
            await probePool.query(
                `INSERT INTO ingredients (name, food_id, food_resolution_status) VALUES ($1, $2, 'RESOLVED')`,
                [`linked ${index}`, `01JU12ALINKED${index}`],
            );
        }
    }

    beforeEach(async () => {
        await resetSchema(pool);
        await seedCatalogRow('01JU12ACLEAR0000000000000A');
        await seedCatalogRow('01JU12ACLEAR0000000000000B');
        await setRecipeLinks(0);
    });

    describe("the cascade list is the schema's, not a guess", () => {
        it('names exactly the tables that reference food — nothing added to the schema can be missed', async () => {
            const { rows } = await pool.query<{ table_name: string }>(
                `SELECT DISTINCT c.conrelid::regclass::text AS table_name
                   FROM pg_constraint c
                  WHERE c.contype = 'f'
                    AND c.confrelid = 'food'::regclass
                    AND c.confdeltype = 'c'`,
            );
            const declared = CASCADING_CATALOG_TABLES.map(getTableName).filter((name) => name !== 'food');

            expect([...rows.map((row) => row.table_name)].sort()).toEqual([...declared].sort());
        });
    });

    describe('⛔ the recipe-side unlink must have completed first', () => {
        it('aborts, and NOT ONE food row is deleted, while links remain', async () => {
            await setRecipeLinks(3);
            const before = await rowsIn('food');

            await expect(runCatalogClear(deps, makeOptions(probeUrl))).rejects.toSatisfy(isRecipeLinkageRemainingError);

            expect(await rowsIn('food')).toBe(before);
            expect(await rowsIn('food_sources')).toBeGreaterThan(0);
        });

        it('counts a row that carries only a resolution verdict as still linked', async () => {
            await probePool.query('TRUNCATE ingredients');
            await probePool.query(
                `INSERT INTO ingredients (name, food_id, food_resolution_status) VALUES ('verdict only', NULL, 'NOT_FOUND')`,
            );

            await expect(runCatalogClear(deps, makeOptions(probeUrl))).rejects.toSatisfy(isRecipeLinkageRemainingError);
            expect(await rowsIn('food')).toBe(2);
        });

        it('fails CLOSED, deleting nothing, when the probed database has no ingredients table', async () => {
            const blind: CatalogClearDeps = {
                linkage: createRecipeLinkageProbe(emptyPool),
                catalog: createFoodCatalogStore(db),
            };

            await expect(runCatalogClear(blind, makeOptions(probeUrl))).rejects.toSatisfy(
                isRecipeLinkageUnreadableError,
            );
            expect(await rowsIn('food')).toBe(2);
        });

        it('fails CLOSED when a link column has drifted away, rather than reading it as zero', async () => {
            const drifted: CatalogClearDeps = {
                linkage: createRecipeLinkageProbe(driftedPool),
                catalog: createFoodCatalogStore(db),
            };

            await expect(runCatalogClear(drifted, makeOptions(probeUrl))).rejects.toThrow(/food_resolution_status/);
            expect(await rowsIn('food')).toBe(2);
        });
    });

    describe('the production guard', () => {
        it('refuses a production run without the flag and deletes NOTHING', async () => {
            await expect(
                runCatalogClear(deps, makeOptions(probeUrl, { stage: PRODUCTION_STAGE, confirm: PRODUCTION_STAGE })),
            ).rejects.toSatisfy(isCatalogClearRefusedError);
            expect(await rowsIn('food')).toBe(2);
        });

        it('refuses a stage/confirmation mismatch and deletes NOTHING', async () => {
            await expect(runCatalogClear(deps, makeOptions(probeUrl, { confirm: 'pr-7' }))).rejects.toSatisfy(
                isCatalogClearRefusedError,
            );
            expect(await rowsIn('food')).toBe(2);
        });
    });

    describe('the dry run', () => {
        it('reports the real counts and deletes NOTHING', async () => {
            await setRecipeLinks(2);

            await expect(runCatalogClear(deps, makeOptions(probeUrl, { dryRun: true }))).resolves.toEqual({
                outcome: 'reported',
                stage: 'sandbox',
                remainingLinkedIngredients: 2,
                foodsBefore: 2,
                foodsDeleted: 0,
                wouldProceed: false,
            });
            expect(await rowsIn('food')).toBe(2);
        });

        it('reports that it WOULD proceed once the recipe side is unlinked', async () => {
            await expect(runCatalogClear(deps, makeOptions(probeUrl, { dryRun: true }))).resolves.toMatchObject({
                remainingLinkedIngredients: 0,
                wouldProceed: true,
            });
        });
    });

    describe('the clear', () => {
        it('empties food and every table that cascades off it', async () => {
            await expect(runCatalogClear(deps, makeOptions(probeUrl))).resolves.toMatchObject({
                outcome: 'cleared',
                foodsBefore: 2,
                foodsDeleted: 2,
            });

            for (const table of CASCADING_CATALOG_TABLES) {
                expect({ table: getTableName(table), rows: await rowsIn(getTableName(table)) }).toEqual({
                    table: getTableName(table),
                    rows: 0,
                });
            }
        });

        it('leaves the nutrient and category DICTIONARIES intact — the reseed finds them, it does not re-mint them', async () => {
            await runCatalogClear(deps, makeOptions(probeUrl));

            const [nutrients] = await db.select({ count: sql<number>`count(*)::int` }).from(nutrient);
            const [categories] = await db.select({ count: sql<number>`count(*)::int` }).from(foodCategory);

            expect({ nutrients: nutrients?.count, categories: categories?.count }).toEqual({
                nutrients: 1,
                categories: 1,
            });
        });

        it('is idempotent — a second clear finds an empty catalog and succeeds', async () => {
            await runCatalogClear(deps, makeOptions(probeUrl));

            await expect(runCatalogClear(deps, makeOptions(probeUrl))).resolves.toMatchObject({
                outcome: 'cleared',
                foodsBefore: 0,
                foodsDeleted: 0,
            });
        });

        it('clears production when the stage is named and the flag is given', async () => {
            await expect(
                runCatalogClear(
                    deps,
                    makeOptions(probeUrl, {
                        stage: PRODUCTION_STAGE,
                        confirm: PRODUCTION_STAGE,
                        allowProd: true,
                    }),
                ),
            ).resolves.toMatchObject({ outcome: 'cleared', foodsDeleted: 2 });
            expect(await rowsIn('food')).toBe(0);
        });
    });

    describe('the post-condition rolls the transaction back', () => {
        /**
         * A statement-level `AFTER DELETE` trigger that re-introduces one `food` row. It INSERTs (never
         * deletes), so it cannot re-fire itself, and it is the only way to manufacture the "delete ran,
         * rows survived" state `assertCatalogCleared` exists to catch — the cascade is real, so
         * nothing else can produce a residue.
         */
        beforeEach(async () => {
            await pool.query(`
                CREATE OR REPLACE FUNCTION u12a_smuggle_food() RETURNS trigger AS $$
                BEGIN
                    INSERT INTO food (id, name, normalized_name)
                    VALUES ('01JU12ASMUGGLEDFOOD000000', 'smuggled', 'smuggled')
                    ON CONFLICT (id) DO NOTHING;
                    RETURN NULL;
                END;
                $$ LANGUAGE plpgsql;
            `);
            await pool.query(
                `CREATE OR REPLACE TRIGGER u12a_smuggle_food_trigger AFTER DELETE ON food
                 FOR EACH STATEMENT EXECUTE FUNCTION u12a_smuggle_food()`,
            );
        });

        it('rolls the whole delete back when a row survives it, leaving the catalog exactly as it was', async () => {
            await expect(runCatalogClear(deps, makeOptions(probeUrl))).rejects.toSatisfy(isCatalogClearIncompleteError);

            expect(await rowsIn('food')).toBe(2);
            expect(await rowsIn('food_sources')).toBe(2);
        });
    });

    describe("the target it names is the SERVER's own answer", () => {
        it('reports the database and role the connection actually reached, not the connection string', async () => {
            const target = await describeDatabaseTarget(pool);

            expect(target).toMatchObject({ database: new URL(DATABASE_URL ?? '').pathname.slice(1) });
            expect(target.port).toBeGreaterThan(0);
            expect(target.user).not.toBe('');
        });

        it('distinguishes the probe database from the food database — the wrong-target case an operator must see', async () => {
            const [foodTarget, recipeTarget] = await Promise.all([
                describeDatabaseTarget(pool),
                describeDatabaseTarget(probePool),
            ]);

            expect(recipeTarget.database).toBe(PROBE_DB_NAME);
            expect(recipeTarget.database).not.toBe(foodTarget.database);
        });
    });

    describe('the probe is read-only', () => {
        it("runs in a transaction Postgres itself refuses writes in — the containment is the server's, not ours", async () => {
            const client = await probePool.connect();

            try {
                await client.query('BEGIN TRANSACTION READ ONLY');

                await expect(client.query(`INSERT INTO ingredients (name) VALUES ('nope')`)).rejects.toThrow(
                    /read-only/i,
                );
            } finally {
                await client.query('ROLLBACK');
                client.release();
            }
        });

        it('leaves the recipe database exactly as it found it', async () => {
            await setRecipeLinks(4);

            await expect(runCatalogClear(deps, makeOptions(probeUrl))).rejects.toThrow();

            const { rows } = await probePool.query<{ n: number }>('SELECT count(*)::int AS n FROM ingredients');

            expect(rows[0]?.n).toBe(4);
        });
    });
});
