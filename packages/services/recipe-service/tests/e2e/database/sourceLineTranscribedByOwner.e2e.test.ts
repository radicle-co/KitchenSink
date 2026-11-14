/**
 * LOCAL e2e (`docs/CODING_STANDARDS.md` §7.1a): migration 0072, `ingredients.source_line_transcribed_by_owner`
 * (ADR-0090), on real Postgres under the production role model, migrated by recipe's own runner.
 *
 * The backfill is the risk this suite exists for, and only a real database can show it. A throwaway database is
 * migrated to just BEFORE 0072, seeded with recipes as the previous release would have left them, and then 0072 runs.
 * Its predicate is a TIME bound: a recipe with no clone pointer is proven not to be a clone only when it was created
 * after the latest erasure or purge job, because those two jobs are what NULL a clone's pointer. So:
 *
 * | Recipe | Backfilled |
 * | --- | --- |
 * | no pointer, created after every job | TRUE, on its lines that hold a source line |
 * | a clone with its pointer | FALSE |
 * | a clone whose pointer an erasure NULLed (created before the job) | FALSE |
 * | a non-clone created before the job (the accepted cost: indistinguishable from the row above) | FALSE |
 * | anything created inside a queued or running job's window (its last touch plus the bound) | FALSE |
 * | a recipe created after a stuck queued or running job's window closed | TRUE |
 *
 * And the schema itself: the column defaults to FALSE for an insert that does not name it (the previous release's
 * inserts), and the CHECK refuses a TRUE with no text to describe.
 *
 * It never skips: with no `DATABASE_ADMIN_URL` the provisioning throws.
 */
import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { readMigrationManifest } from '@kitchensink/db-schema-guard';
import { provisionRoleDatabase, type RoleDatabase } from '@kitchensink/service-test-harness';

import { runMigrations } from '../../../src/lambdas/migrate/handler.js';
import { migrationsDir, recipeDbSpec } from '../../support/roleDb.js';

/** The migrations under test, in order: 0072 adds the column and its CHECK as NOT VALID, 0073 validates it. */
const MIGRATIONS = [
    '0072_ingredient_source_line_transcribed_by_owner',
    '0073_ingredient_transcribed_by_owner_validate',
] as const;
const MIGRATION_FILES: readonly string[] = MIGRATIONS.map((name) => `${name}.sql`);
const DATABASE = 'recipe_transcribed_by_owner_test';

const COOK = '01JTRANSCRIBEDCOOK0000001';
const CLONER = '01JTRANSCRIBEDCLONER00001';
const ERASED = '01JTRANSCRIBEDERASED00001';

/** The job's last write. Every recipe below is placed a day either side of it. */
const JOB_AT = '2026-11-10T12:00:00Z';
const BEFORE_JOB = '2026-11-09T12:00:00Z';
const AFTER_JOB = '2026-11-11T12:00:00Z';
/** Inside an in-flight job's window: five minutes after its last touch, well under the 15-minute bound. */
const INSIDE_JOB_WINDOW = '2026-11-10T12:05:00Z';

/** Every migration except the two under test, so the database stands where the previous release left it. */
let beforeDir: string;
let handle: RoleDatabase;

/**
 * Insert one draft recipe with one transcribed line and one authored line.
 *
 * @param client - An owner session.
 * @param recipe - Its owner, creation time and clone pointer.
 * @returns The recipe id.
 * @sideEffect Inserts a binding, a recipe and two lines.
 */
async function seedRecipe(
    client: pg.PoolClient,
    recipe: { readonly ownerId: string; readonly createdAt: string; readonly clonedFromId: string | null },
): Promise<string> {
    const binding = await client.query<{ id: string }>(
        `INSERT INTO food_lookups (food_id) VALUES ('e2e-transcribed-' || gen_random_uuid()) RETURNING id`,
    );
    const inserted = await client.query<{ id: string }>(
        `INSERT INTO recipes (owner_id, title, prep_time_minutes, cook_time_minutes, total_time_minutes, servings,
                              status, cloned_from_id, created_at, updated_at)
         VALUES ($1, 'Bread', 5, 10, 15, 2, 'draft', $2, $3, $3) RETURNING id`,
        [recipe.ownerId, recipe.clonedFromId, recipe.createdAt],
    );
    const recipeId = inserted.rows[0]?.id;

    if (recipeId === undefined) {
        throw new Error('the recipe insert returned no id');
    }

    await client.query(
        `INSERT INTO ingredients (recipe_id, food_lookup_id, quantity, unit, source_line, sort_order)
         VALUES ($1, $2, 2, 'cup', '2 cups flour, sifted', 0), ($1, $2, 1, 'tsp', NULL, 1)`,
        [recipeId, binding.rows[0]?.id],
    );

    return recipeId;
}

/**
 * Each line's flag, in line order.
 *
 * @param client - An owner session.
 * @param recipeId - The recipe.
 * @returns `[source_line, flag]` per line.
 * @sideEffect Reads `ingredients`.
 */
async function flagsOf(client: pg.PoolClient, recipeId: string): Promise<[string | null, boolean][]> {
    const rows = await client.query<{ source_line: string | null; flag: boolean }>(
        `SELECT source_line, source_line_transcribed_by_owner AS flag FROM ingredients
          WHERE recipe_id = $1 ORDER BY sort_order`,
        [recipeId],
    );

    return rows.rows.map((row) => [row.source_line, row.flag]);
}

/**
 * Rebuild the database at the previous release, seed it, then run 0072 with recipe's own runner as the migrator.
 *
 * @param seed - The rows to seed before 0072 runs; returns what the assertions need.
 * @returns What `seed` returned.
 * @sideEffect Rebuilds the throwaway database and migrates it.
 */
async function migrateOver<T>(seed: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    await handle.reset();

    const seeded = await handle.asOwner(seed);
    const pool = new pg.Pool({ connectionString: handle.migratorUrl, max: 1 });

    try {
        const result = await runMigrations({
            pool,
            migrationsDir,
            expectManifestSha: readMigrationManifest(migrationsDir).sha,
            database: DATABASE,
        });

        // Not vacuous: 0072 and 0073 are the ONLY migrations this run applied.
        expect(result.applied).toStrictEqual([...MIGRATIONS]);
    } finally {
        await pool.end();
    }

    return seeded;
}

beforeAll(async () => {
    beforeDir = await mkdtemp(join(tmpdir(), 'recipe-migrations-'));

    for (const file of await readdir(migrationsDir)) {
        if (file.endsWith('.sql') && !MIGRATION_FILES.includes(file)) {
            await copyFile(join(migrationsDir, file), join(beforeDir, file));
        }
    }

    handle = await provisionRoleDatabase({ ...recipeDbSpec(DATABASE), migrationsDir: beforeDir });
});

afterAll(async () => {
    await rm(beforeDir, { recursive: true, force: true });
});

describe('migration 0072 backfill — TRUE only where the owner is proven to have written the line', () => {
    it('backfills an owner-created recipe made after the latest job, and no clone, either way', async () => {
        const ids = await migrateOver(async (client) => {
            await client.query(
                `INSERT INTO account_erasure_jobs (owner_id, status, created_at, updated_at)
                 VALUES ($1, 'completed', $2, $2)`,
                [ERASED, JOB_AT],
            );

            const owned = await seedRecipe(client, { ownerId: COOK, createdAt: AFTER_JOB, clonedFromId: null });

            return {
                owned,
                clone: await seedRecipe(client, { ownerId: CLONER, createdAt: AFTER_JOB, clonedFromId: owned }),
                // The erasure NULLed this clone's pointer: it existed before the job ran.
                detachedClone: await seedRecipe(client, { ownerId: CLONER, createdAt: BEFORE_JOB, clonedFromId: null }),
                // The accepted cost: an owner's own recipe from before the job looks exactly like the row above.
                ownedBeforeJob: await seedRecipe(client, { ownerId: COOK, createdAt: BEFORE_JOB, clonedFromId: null }),
            };
        });

        await handle.asOwner(async (client) => {
            expect(await flagsOf(client, ids.owned)).toStrictEqual([
                ['2 cups flour, sifted', true],
                [null, false],
            ]);
            expect(await flagsOf(client, ids.clone)).toStrictEqual([
                ['2 cups flour, sifted', false],
                [null, false],
            ]);
            expect(await flagsOf(client, ids.detachedClone)).toStrictEqual([
                ['2 cups flour, sifted', false],
                [null, false],
            ]);
            expect(await flagsOf(client, ids.ownedBeforeJob)).toStrictEqual([
                ['2 cups flour, sifted', false],
                [null, false],
            ]);
        });
    });

    it('counts a purge job too: a recipe made before a test reset stays FALSE', async () => {
        const ids = await migrateOver(async (client) => {
            await client.query(
                `INSERT INTO test_reset_jobs (user_id, status, created_at, updated_at) VALUES ($1, 'completed', $2, $2)`,
                [ERASED, JOB_AT],
            );

            return {
                before: await seedRecipe(client, { ownerId: CLONER, createdAt: BEFORE_JOB, clonedFromId: null }),
                after: await seedRecipe(client, { ownerId: COOK, createdAt: AFTER_JOB, clonedFromId: null }),
            };
        });

        await handle.asOwner(async (client) => {
            expect((await flagsOf(client, ids.before))[0]).toStrictEqual(['2 cups flour, sifted', false]);
            expect((await flagsOf(client, ids.after))[0]).toStrictEqual(['2 cups flour, sifted', true]);
        });
    });

    it("⛔ backfills nothing created inside a running job's window: its detach may already have committed", async () => {
        const ids = await migrateOver(async (client) => {
            await client.query(
                `INSERT INTO account_erasure_jobs (owner_id, status, created_at, updated_at)
                 VALUES ($1, 'running', $2, $2)`,
                [ERASED, JOB_AT],
            );

            return {
                inside: await seedRecipe(client, { ownerId: COOK, createdAt: INSIDE_JOB_WINDOW, clonedFromId: null }),
                after: await seedRecipe(client, { ownerId: COOK, createdAt: AFTER_JOB, clonedFromId: null }),
            };
        });

        await handle.asOwner(async (client) => {
            expect((await flagsOf(client, ids.inside))[0]).toStrictEqual(['2 cups flour, sifted', false]);
            // ⛔ The job has been idle a day. A worker invocation dies at its 5-minute timeout, so no detach can
            // commit after the window closes: a STUCK job must not freeze the backfill at zero rows forever.
            expect((await flagsOf(client, ids.after))[0]).toStrictEqual(['2 cups flour, sifted', true]);
        });
    });

    it('bounds a stuck QUEUED reset job the same way', async () => {
        const ids = await migrateOver(async (client) => {
            await client.query(
                `INSERT INTO test_reset_jobs (user_id, status, created_at, updated_at) VALUES ($1, 'queued', $2, $2)`,
                [ERASED, JOB_AT],
            );

            return {
                inside: await seedRecipe(client, { ownerId: COOK, createdAt: INSIDE_JOB_WINDOW, clonedFromId: null }),
                after: await seedRecipe(client, { ownerId: COOK, createdAt: AFTER_JOB, clonedFromId: null }),
            };
        });

        await handle.asOwner(async (client) => {
            expect((await flagsOf(client, ids.inside))[0]).toStrictEqual(['2 cups flour, sifted', false]);
            expect((await flagsOf(client, ids.after))[0]).toStrictEqual(['2 cups flour, sifted', true]);
        });
    });

    it('⛔ backfills nothing while a job touched just now is in flight', async () => {
        const owned = await migrateOver(async (client) => {
            const owned = await seedRecipe(client, { ownerId: COOK, createdAt: AFTER_JOB, clonedFromId: null });

            await client.query(
                `INSERT INTO account_erasure_jobs (owner_id, status, created_at, updated_at)
                 VALUES ($1, 'running', now(), now())`,
                [ERASED],
            );

            return owned;
        });

        await handle.asOwner(async (client) => {
            expect((await flagsOf(client, owned))[0]).toStrictEqual(['2 cups flour, sifted', false]);
        });
    });

    it('backfills every non-clone when no job has ever run, and still no clone', async () => {
        const ids = await migrateOver(async (client) => {
            const owned = await seedRecipe(client, { ownerId: COOK, createdAt: BEFORE_JOB, clonedFromId: null });

            return {
                owned,
                clone: await seedRecipe(client, { ownerId: CLONER, createdAt: AFTER_JOB, clonedFromId: owned }),
            };
        });

        await handle.asOwner(async (client) => {
            expect((await flagsOf(client, ids.owned))[0]).toStrictEqual(['2 cups flour, sifted', true]);
            expect((await flagsOf(client, ids.clone))[0]).toStrictEqual(['2 cups flour, sifted', false]);
        });
    });
});

describe('migration 0072 schema', () => {
    it('defaults to FALSE for an insert that does not name it, and refuses TRUE with no text', async () => {
        const recipeId = await migrateOver(async (client) =>
            seedRecipe(client, { ownerId: COOK, createdAt: AFTER_JOB, clonedFromId: null }),
        );
        const app = new pg.Pool({ connectionString: handle.appUrl, max: 1 });

        try {
            // As the SERVICE role, the way the previous release's insert reaches the table.
            const binding = await app.query<{ food_lookup_id: string }>(
                'SELECT food_lookup_id FROM ingredients WHERE recipe_id = $1 LIMIT 1',
                [recipeId],
            );
            const lookupId = binding.rows[0]?.food_lookup_id;
            const inserted = await app.query<{ flag: boolean }>(
                `INSERT INTO ingredients (recipe_id, food_lookup_id, quantity, unit, source_line, sort_order)
                 VALUES ($1, $2, 1, 'cup', '1 cup milk', 2) RETURNING source_line_transcribed_by_owner AS flag`,
                [recipeId, lookupId],
            );

            expect(inserted.rows[0]?.flag).toBe(false);

            const refused = await app
                .query(
                    `INSERT INTO ingredients (recipe_id, food_lookup_id, quantity, unit, source_line,
                                              source_line_transcribed_by_owner, sort_order)
                     VALUES ($1, $2, 1, 'cup', NULL, true, 3)`,
                    [recipeId, lookupId],
                )
                .then(
                    () => undefined,
                    (error: unknown) => error as { code?: string; constraint?: string },
                );

            expect(refused?.code).toBe('23514');
            expect(refused?.constraint).toBe('ingredients_transcribed_by_owner_has_source_line');

            // 0072 adds the CHECK as NOT VALID so its scan holds no ACCESS EXCLUSIVE lock; 0073 validates it.
            const constraint = await app.query<{ convalidated: boolean }>(
                `SELECT convalidated FROM pg_constraint
                  WHERE conname = 'ingredients_transcribed_by_owner_has_source_line'`,
            );

            expect(constraint.rows).toStrictEqual([{ convalidated: true }]);
        } finally {
            await app.end();
        }
    });
});
