/**
 * ADR-0040 — the test-principal reset, driven through the REAL `handler` against real PostgreSQL (as `recipe_app`,
 * ADR-0039) and real S3 (LocalStack).
 *
 * **Why the handler and not the seams.** Every sibling in this folder drives exported `db`-taking functions, because
 * `getRecipeDb()` mints an RDS-IAM token no local Postgres honours. This suite substitutes exactly that one module —
 * `common/db.js` returns a pool on the service role's URL — and points the worker's own module-level `S3Client` at
 * LocalStack, so what runs is the real dispatch → claim → registry re-check → purge → both-bucket owner-prefix sweep →
 * CDN (no-op, no distribution configured) → `completed` sequence. A seam-by-seam test cannot prove that ordering,
 * and a fake database cannot prove the purge is FK-SAFE: whether `recipes.cloned_from_id`, the correction tiers'
 * `corroborated_a`/`corroborated_b`/`superseded_by` (all `NO ACTION`) and `recipe_ingredients.ingredient_id` let the
 * deletes through is decided only by PostgreSQL evaluating the real constraints against real rows.
 *
 * What is proven, per case:
 *   - a principal with public, private and tombstoned recipes, versions, photos, collections, a rating on a
 *     bystander's recipe, a bystander's clone of its recipe, private foods (one a bystander still lines against),
 *     analytics events, and correction rows — including a corroboration binding citing its row and supersession
 *     pointers in both directions — ends with NOTHING left, while every bystander row survives intact;
 *   - a second reset of the same slot runs cleanly (the registry is kept);
 *   - a duplicate delivery after completion purges nothing the next run has written;
 *   - ⛔ a duplicate delivery WHILE the job is running purges nothing either, and two concurrent deliveries claim the
 *     job exactly once — a delivery claims only a `queued` job (LOW-5);
 *   - an unregistered owner's reset deletes nothing and fails the delivery.
 */
import type { SQSEvent } from 'aws-lambda';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as S3Module from '@aws-sdk/client-s3';
import { CreateBucketCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { ownerMediaPrefix, recipeMediaPrefix } from '@kitchensink/recipe-core';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { isValid as isValidUlid } from 'ulidx';

const { dbHolder } = vi.hoisted(() => ({
    dbHolder: { db: undefined as NodePgDatabase<Record<string, never>> | undefined },
}));

// The ONE production seam substituted: the RDS-IAM connection. Everything the handler does to the database runs.
vi.mock('../../../src/common/db.js', () => ({
    getRecipeDb: (): NodePgDatabase<Record<string, never>> => {
        if (dbHolder.db === undefined) {
            throw new Error('test setup: the recipe database handle was not initialised');
        }

        return dbHolder.db;
    },
}));

// The worker builds `new S3Client({})` at module scope; point every client at LocalStack rather than AWS.
vi.mock('@aws-sdk/client-s3', async (importOriginal) => {
    const actual = await importOriginal<typeof S3Module>();

    class LocalStackS3Client extends actual.S3Client {
        constructor(config: ConstructorParameters<typeof actual.S3Client>[0] = {}) {
            super({
                ...config,
                endpoint: process.env['S3_ENDPOINT'],
                forcePathStyle: true,
                region: process.env['AWS_REGION'] ?? 'us-east-1',
                credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
            });
        }
    }

    return { ...actual, S3Client: LocalStackS3Client };
});

import {
    claimTestResetJob,
    handler,
    isMisroutedErasureMessageError,
} from '../../../src/handlers/accountErasureWorker.js';
import { makeSqsRecord } from '../../../src/handlers/__fixtures__/messages.js';
import { hasTestDatabase, recipeWorkersDb } from '../roleDb.js';

const roleDb = recipeWorkersDb();
const S3_ENDPOINT = process.env['S3_ENDPOINT'];
const canRun = hasTestDatabase && Boolean(S3_ENDPOINT);

/** The registered test principal being reset. */
const PRINCIPAL = '01JTESTPR1NC1PA1RESET00000';
/** A real user whose data the principal's content touches — every row of theirs must survive. */
const BYSTANDER = '01JTESTBYSTANDER0000000000';
/** A second real cook whose correction the principal's row corroborated. */
const CORROBORATOR = '01JTESTC0RR0B0RAT0R0000000';
/** An owner with a reset job but NO registry row. */
const UNREGISTERED = '01JTESTNREG1STERED00000000';

const MEDIA_BUCKET = `recipe-workers-reset-media-${Date.now()}`;
const ARCHIVE_BUCKET = `recipe-workers-reset-archive-${Date.now()}`;

type CountRow = { readonly count: number };

const runHandler = handler as unknown as (event: SQSEvent) => Promise<void>;

/** A `testPrincipalReset` event for one owner. */
const resetEvent = (ownerId: string): SQSEvent => ({
    Records: [
        makeSqsRecord(JSON.stringify({ kind: 'testPrincipalReset', ownerId, requestedAt: '2026-09-13T00:00:00.000Z' })),
    ],
});

describe.skipIf(!canRun)('test-principal reset — the real handler on the real schema (ADR-0040)', () => {
    let pool: pg.Pool;
    let db: NodePgDatabase<Record<string, never>>;
    let s3: S3Client;

    beforeAll(async () => {
        for (const id of [PRINCIPAL, BYSTANDER, CORROBORATOR, UNREGISTERED]) {
            expect(isValidUlid(id), `${id} must be a real ULID or the handler refuses it at the boundary`).toBe(true);
        }

        pool = new pg.Pool({ connectionString: roleDb.appUrl });
        db = drizzle(pool);
        dbHolder.db = db;
        s3 = new S3Client({});
        await s3.send(new CreateBucketCommand({ Bucket: MEDIA_BUCKET }));
        await s3.send(new CreateBucketCommand({ Bucket: ARCHIVE_BUCKET }));
    });

    beforeEach(async () => {
        await roleDb.truncate();
        process.env['RECIPE_MEDIA_BUCKET'] = MEDIA_BUCKET;
        process.env['RECIPE_ARCHIVE_BUCKET'] = ARCHIVE_BUCKET;
        delete process.env['CLOUDFRONT_DISTRIBUTION_ID'];
    });

    afterEach(async () => {
        delete process.env['RECIPE_MEDIA_BUCKET'];
        delete process.env['RECIPE_ARCHIVE_BUCKET'];
        await roleDb.truncate();
    });

    afterAll(async () => {
        s3?.destroy();
        dbHolder.db = undefined;
        await pool?.end();
    });

    /** Insert and return one id. */
    async function insertReturningId(statement: ReturnType<typeof sql>): Promise<string> {
        const result = await db.execute<{ id: string }>(statement);
        const id = result.rows[0]?.id;

        if (id === undefined) {
            throw new Error('test setup: an insert returned no id');
        }

        return id;
    }

    async function count(statement: ReturnType<typeof sql>): Promise<number> {
        const result = await db.execute<CountRow>(statement);

        return result.rows[0]?.count ?? -1;
    }

    async function insertRecipe(
        ownerId: string,
        title: string,
        options: {
            visibility?: 'public' | 'private';
            status?: 'draft' | 'published';
            deleted?: boolean;
            clonedFromId?: string;
        } = {},
    ): Promise<string> {
        return insertReturningId(sql`
            INSERT INTO recipes
                (owner_id, title, servings, prep_time_minutes, cook_time_minutes, total_time_minutes,
                 visibility, status, deleted_at, cloned_from_id, author_handle)
            VALUES (${ownerId}, ${title}, 2, 5, 10, 15, ${options.visibility ?? 'private'},
                    ${options.status ?? 'published'}, ${options.deleted === true ? sql`now()` : sql`NULL`},
                    ${options.clonedFromId ?? null}, ${`handle of ${ownerId}`})
            RETURNING id
        `);
    }

    async function insertPrivateFood(ownerId: string, name: string): Promise<string> {
        return insertReturningId(sql`
            INSERT INTO ingredients (name, is_user_entered, food_id, food_resolution_status, food_owner_id)
            VALUES (${name}, false, ${`01JTESTF00D${name.length.toString().padStart(15, '0')}`}, 'RESOLVED', ${ownerId})
            RETURNING id
        `);
    }

    async function lineRecipeAgainst(recipeId: string, ingredientId: string): Promise<void> {
        await db.execute(sql`
            INSERT INTO recipe_ingredients (recipe_id, ingredient_id, ingredient_name, quantity, unit, sort_order)
            VALUES (${recipeId}, ${ingredientId}, 'probe', 1, 'cup', 0)
        `);
    }

    async function insertMapping(
        userId: string | null,
        key: string,
        options: { corroborates?: readonly [string, string] } = {},
    ): Promise<string> {
        const pair = options.corroborates;

        return insertReturningId(sql`
            INSERT INTO ingredient_resolution_mappings
                (normalized_key, source_phrase, food_id, scope, origin, user_id, surfacing, corroborated_a, corroborated_b)
            VALUES (${key}, ${pair === undefined ? key : null}, '01JTESTF00DMAPP1NG000000000',
                    ${pair === undefined ? 'author' : 'global'}, ${pair === undefined ? 'author' : 'corroboration'},
                    ${userId}, 'recipe-line', ${pair?.[0] ?? null}, ${pair?.[1] ?? null})
            RETURNING id
        `);
    }

    async function insertCorrection(
        userId: string | null,
        key: string,
        options: { corroborates?: readonly [string, string] } = {},
    ): Promise<string> {
        const pair = options.corroborates;

        return insertReturningId(sql`
            INSERT INTO ingredient_parse_corrections
                (normalized_key, source_line, corrected_facts, scope, origin, user_id, surfacing,
                 corroborated_a, corroborated_b)
            VALUES (${key}, ${pair === undefined ? key : null}, ${'{"unit":"cup"}'}::jsonb,
                    ${pair === undefined ? 'author' : 'global'}, ${pair === undefined ? 'author' : 'corroboration'},
                    ${userId}, 'line-editor', ${pair?.[0] ?? null}, ${pair?.[1] ?? null})
            RETURNING id
        `);
    }

    /** Point `retired`'s successor at `successor`, retiring it. */
    async function supersede(table: 'mappings' | 'corrections', retired: string, successor: string): Promise<void> {
        const statement =
            table === 'mappings'
                ? sql`UPDATE ingredient_resolution_mappings SET superseded_at = now(), superseded_by = ${successor} WHERE id = ${retired}`
                : sql`UPDATE ingredient_parse_corrections SET superseded_at = now(), superseded_by = ${successor} WHERE id = ${retired}`;

        await db.execute(statement);
    }

    async function putObject(bucket: string, key: string): Promise<void> {
        await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: 'probe' }));
    }

    async function listKeys(bucket: string, prefix: string): Promise<string[]> {
        const listed = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }));

        return (listed.Contents ?? []).flatMap((entry) => (entry.Key === undefined ? [] : [entry.Key]));
    }

    async function registerAndQueue(ownerId: string, registered = true): Promise<void> {
        if (registered) {
            await db.execute(sql`INSERT INTO test_principals (user_id) VALUES (${ownerId}) ON CONFLICT DO NOTHING`);
        }

        await db.execute(sql`INSERT INTO test_reset_jobs (user_id) VALUES (${ownerId})`);
    }

    async function jobs(ownerId: string): Promise<{ status: string; attempts: number; last_error: string | null }[]> {
        const result = await db.execute<{ status: string; attempts: number; last_error: string | null }>(sql`
            SELECT status, attempts, last_error FROM test_reset_jobs WHERE user_id = ${ownerId} ORDER BY created_at
        `);

        return [...result.rows];
    }

    it('purges EVERYTHING the principal owns, leaves every bystander row intact, completes, and resets again', async () => {
        await registerAndQueue(PRINCIPAL);

        // ── The principal's estate ─────────────────────────────────────────────────────────────────────────
        const publicRecipe = await insertRecipe(PRINCIPAL, 'Public', { visibility: 'public', status: 'published' });
        const privateRecipe = await insertRecipe(PRINCIPAL, 'Private');
        const tombstone = await insertRecipe(PRINCIPAL, 'Tombstoned draft', { status: 'draft', deleted: true });
        const principalRecipes = [publicRecipe, privateRecipe, tombstone];

        await db.execute(
            sql`INSERT INTO recipe_steps (recipe_id, step_number, instruction) VALUES (${publicRecipe}, 1, 'Stir')`,
        );
        await db.execute(sql`
            INSERT INTO recipe_photos (recipe_id, s3_key, content_type)
            VALUES (${publicRecipe}, ${`${recipeMediaPrefix(PRINCIPAL, publicRecipe)}photos/cover`}, 'image/jpeg')
        `);
        await db.execute(sql`
            INSERT INTO recipe_versions (recipe_id, version_number, snapshot, created_by, editor_handle)
            VALUES (${publicRecipe}, 1, ${JSON.stringify({ version: 1 })}::jsonb, ${PRINCIPAL}, 'probe')
        `);
        await db.execute(sql`
            INSERT INTO author_handles (user_id, display_name, source_timestamp) VALUES (${PRINCIPAL}, 'Probe', now())
        `);
        const parseJob = await insertReturningId(sql`
            INSERT INTO recipe_parse_jobs (owner_id, expires_at) VALUES (${PRINCIPAL}, now() + interval '1 day') RETURNING id
        `);
        await db.execute(sql`
            INSERT INTO recipe_parse_job_lines (job_id, line_index, source_line, line_digest)
            VALUES (${parseJob}, 0, '2 cups flour', 'digest')
        `);

        // ── The bystanders' world, entangled with the principal's ─────────────────────────────────────────
        const bystanderRecipe = await insertRecipe(BYSTANDER, 'Bystander public', { visibility: 'public' });
        const bystanderClone = await insertRecipe(BYSTANDER, 'Clone of the principal', { clonedFromId: publicRecipe });
        // A rating by the principal AND one by a real cook on the bystander's recipe: the trigger must re-derive 4.0/1.
        await db.execute(
            sql`INSERT INTO recipe_ratings (recipe_id, user_id, stars) VALUES (${bystanderRecipe}, ${PRINCIPAL}, 2)`,
        );
        await db.execute(
            sql`INSERT INTO recipe_ratings (recipe_id, user_id, stars) VALUES (${bystanderRecipe}, ${CORROBORATOR}, 4)`,
        );
        // A bystander's rating on the principal's recipe goes with that recipe.
        await db.execute(
            sql`INSERT INTO recipe_ratings (recipe_id, user_id, stars) VALUES (${publicRecipe}, ${BYSTANDER}, 5)`,
        );

        const principalCollection = await insertReturningId(sql`
            INSERT INTO collections (owner_id, name, visibility) VALUES (${PRINCIPAL}, 'Probe', 'public') RETURNING id
        `);
        await db.execute(
            sql`INSERT INTO recipe_collections (collection_id, recipe_id) VALUES (${principalCollection}, ${bystanderRecipe})`,
        );
        const bystanderCollection = await insertReturningId(sql`
            INSERT INTO collections (owner_id, name, visibility) VALUES (${BYSTANDER}, 'Mine', 'private') RETURNING id
        `);
        await db.execute(
            sql`INSERT INTO recipe_collections (collection_id, recipe_id) VALUES (${bystanderCollection}, ${publicRecipe})`,
        );
        await db.execute(
            sql`INSERT INTO recipe_collections (collection_id, recipe_id) VALUES (${bystanderCollection}, ${bystanderRecipe})`,
        );

        const referencedFood = await insertPrivateFood(PRINCIPAL, 'referenced by a bystander');
        const unreferencedFood = await insertPrivateFood(PRINCIPAL, 'unreferenced');
        await lineRecipeAgainst(bystanderRecipe, referencedFood);
        await lineRecipeAgainst(privateRecipe, referencedFood);

        await db.execute(sql`
            INSERT INTO analytics_events (event_id, event_type, user_id, recipe_id, query_text, payload, occurred_at)
            VALUES (NULL, 'recipe_saved', ${PRINCIPAL}, ${bystanderRecipe}, NULL, '{}'::jsonb, now()),
                   (gen_random_uuid(), 'query_outcome', ${PRINCIPAL}, NULL, 'saffron', '{}'::jsonb, now()),
                   (NULL, 'recipe_saved', ${BYSTANDER}, ${bystanderRecipe}, NULL, '{}'::jsonb, now())
        `);

        // ── Correction tiers: a corroboration binding citing the principal, and supersession both ways ────────
        const principalMapping = await insertMapping(PRINCIPAL, 'plain flour');
        const corroboratorMapping = await insertMapping(CORROBORATOR, 'plain flour');
        const binding = await insertMapping(null, 'plain flour', {
            corroborates: [principalMapping, corroboratorMapping],
        });
        const principalOldMapping = await insertMapping(PRINCIPAL, 'caster sugar');
        // Retired BEFORE its successor lands: `idx_resolution_mappings_live_user` allows one live row per cook.
        await db.execute(
            sql`UPDATE ingredient_resolution_mappings SET superseded_at = now() WHERE id = ${principalOldMapping}`,
        );
        const principalNewMapping = await insertMapping(PRINCIPAL, 'caster sugar');
        await supersede('mappings', principalOldMapping, principalNewMapping); // a pointer INSIDE the doomed set
        const bystanderRetiredMapping = await insertMapping(BYSTANDER, 'icing sugar');
        await supersede('mappings', bystanderRetiredMapping, principalNewMapping); // a real row pointing INTO the set

        const principalCorrection = await insertCorrection(PRINCIPAL, '2 cups flour');
        const corroboratorCorrection = await insertCorrection(CORROBORATOR, '2 cups flour');
        const correctionBinding = await insertCorrection(null, '2 cups flour', {
            corroborates: [corroboratorCorrection, principalCorrection],
        });
        const bystanderRetiredCorrection = await insertCorrection(BYSTANDER, '1 egg');
        await supersede('corrections', bystanderRetiredCorrection, principalCorrection);

        // ── Objects: under the principal's prefix in BOTH buckets (incl. an orphan with no row), and a bystander's ──
        const principalKeys = [
            `${recipeMediaPrefix(PRINCIPAL, publicRecipe)}photos/cover`,
            `${recipeMediaPrefix(PRINCIPAL, '00000000-0000-4000-8000-00000000dead')}orphan.jpg`,
        ];

        for (const key of principalKeys) {
            await putObject(MEDIA_BUCKET, key);
        }

        await putObject(ARCHIVE_BUCKET, `${recipeMediaPrefix(PRINCIPAL, publicRecipe)}versions/1.json`);
        const bystanderKey = `${recipeMediaPrefix(BYSTANDER, bystanderRecipe)}photos/cover`;
        await putObject(MEDIA_BUCKET, bystanderKey);
        await putObject(ARCHIVE_BUCKET, `${recipeMediaPrefix(BYSTANDER, bystanderRecipe)}versions/1.json`);

        // POSITIVE first, so every zero below is a claim about rows that existed.
        expect(await count(sql`SELECT count(*)::int AS count FROM recipes WHERE owner_id = ${PRINCIPAL}`)).toBe(3);
        expect(await listKeys(MEDIA_BUCKET, ownerMediaPrefix(PRINCIPAL))).toHaveLength(2);
        const signalsBefore = await db.execute<{ save_count: string }>(
            sql`SELECT save_count FROM recipe_impact_signals WHERE recipe_id = ${bystanderRecipe}`,
        );
        expect(Number(signalsBefore.rows[0]?.save_count)).toBe(2);

        await runHandler(resetEvent(PRINCIPAL));

        // ── Nothing of the principal's remains ───────────────────────────────────────────────────────────────
        const principalRowCounts = await db.execute<Record<string, number>>(sql`
            SELECT
                (SELECT count(*)::int FROM recipes WHERE owner_id = ${PRINCIPAL}) AS recipes,
                (SELECT count(*)::int FROM recipe_steps WHERE recipe_id = ANY(${`{${principalRecipes.join(',')}}`}::uuid[])) AS steps,
                (SELECT count(*)::int FROM recipe_photos WHERE recipe_id = ANY(${`{${principalRecipes.join(',')}}`}::uuid[])) AS photos,
                (SELECT count(*)::int FROM recipe_versions WHERE created_by = ${PRINCIPAL}) AS versions,
                (SELECT count(*)::int FROM recipe_ratings WHERE user_id = ${PRINCIPAL}) AS ratings,
                (SELECT count(*)::int FROM collections WHERE owner_id = ${PRINCIPAL}) AS collections,
                (SELECT count(*)::int FROM author_handles WHERE user_id = ${PRINCIPAL}) AS handles,
                (SELECT count(*)::int FROM recipe_parse_jobs WHERE owner_id = ${PRINCIPAL}) AS parse_jobs,
                (SELECT count(*)::int FROM recipe_parse_job_lines WHERE job_id = ${parseJob}) AS parse_lines,
                (SELECT count(*)::int FROM ingredients WHERE id = ${unreferencedFood}) AS unreferenced_food,
                (SELECT count(*)::int FROM analytics_events WHERE user_id = ${PRINCIPAL}) AS events,
                (SELECT count(*)::int FROM ingredient_resolution_mappings WHERE user_id = ${PRINCIPAL}) AS mappings,
                (SELECT count(*)::int FROM ingredient_resolution_mappings WHERE id = ${binding}) AS mapping_binding,
                (SELECT count(*)::int FROM ingredient_parse_corrections WHERE user_id = ${PRINCIPAL}) AS corrections,
                (SELECT count(*)::int FROM ingredient_parse_corrections WHERE id = ${correctionBinding}) AS correction_binding
        `);
        expect(principalRowCounts.rows[0]).toEqual({
            recipes: 0,
            steps: 0,
            photos: 0,
            versions: 0,
            ratings: 0,
            collections: 0,
            handles: 0,
            parse_jobs: 0,
            parse_lines: 0,
            unreferenced_food: 0,
            events: 0,
            mappings: 0,
            mapping_binding: 0,
            corrections: 0,
            correction_binding: 0,
        });
        expect(await listKeys(MEDIA_BUCKET, ownerMediaPrefix(PRINCIPAL))).toEqual([]);
        expect(await listKeys(ARCHIVE_BUCKET, ownerMediaPrefix(PRINCIPAL))).toEqual([]);

        // ── Every bystander row survives, repaired only where the principal's rows were entangled ─────────────
        const clone = await db.execute<{ cloned_from_id: string | null }>(
            sql`SELECT cloned_from_id FROM recipes WHERE id = ${bystanderClone}`,
        );
        expect(clone.rows).toEqual([{ cloned_from_id: null }]);
        const rated = await db.execute<{ average_rating: string; rating_count: number }>(
            sql`SELECT average_rating, rating_count FROM recipes WHERE id = ${bystanderRecipe}`,
        );
        expect(Number(rated.rows[0]?.average_rating)).toBe(4);
        expect(rated.rows[0]?.rating_count).toBe(1);
        expect(
            await count(
                sql`SELECT count(*)::int AS count FROM recipe_collections WHERE collection_id = ${bystanderCollection}`,
            ),
        ).toBe(1);
        const food = await db.execute<{ food_owner_id: string }>(
            sql`SELECT food_owner_id FROM ingredients WHERE id = ${referencedFood}`,
        );
        expect(food.rows).toEqual([{ food_owner_id: PRINCIPAL }]);
        expect(await count(sql`SELECT count(*)::int AS count FROM analytics_events WHERE user_id = ${BYSTANDER}`)).toBe(
            1,
        );
        // 0043 has no DELETE trigger: the recipe-keyed count does not decrement.
        const signalsAfter = await db.execute<{ save_count: string }>(
            sql`SELECT save_count FROM recipe_impact_signals WHERE recipe_id = ${bystanderRecipe}`,
        );
        expect(Number(signalsAfter.rows[0]?.save_count)).toBe(2);
        // The corroborator keeps their own live author rows; only the bindings the principal contributed to went.
        expect(
            await count(sql`
                SELECT count(*)::int AS count FROM ingredient_resolution_mappings
                 WHERE id = ${corroboratorMapping} AND superseded_at IS NULL
            `),
        ).toBe(1);
        expect(
            await count(sql`
                SELECT count(*)::int AS count FROM ingredient_parse_corrections
                 WHERE id = ${corroboratorCorrection} AND superseded_at IS NULL
            `),
        ).toBe(1);
        // A real row the principal's row superseded stays RETIRED, with its successor pointer cleared.
        const retiredMapping = await db.execute<{ retired: boolean; superseded_by: string | null }>(sql`
            SELECT superseded_at IS NOT NULL AS retired, superseded_by FROM ingredient_resolution_mappings
             WHERE id = ${bystanderRetiredMapping}
        `);
        expect(retiredMapping.rows).toEqual([{ retired: true, superseded_by: null }]);
        const retiredCorrection = await db.execute<{ retired: boolean; superseded_by: string | null }>(sql`
            SELECT superseded_at IS NOT NULL AS retired, superseded_by FROM ingredient_parse_corrections
             WHERE id = ${bystanderRetiredCorrection}
        `);
        expect(retiredCorrection.rows).toEqual([{ retired: true, superseded_by: null }]);
        expect(await listKeys(MEDIA_BUCKET, ownerMediaPrefix(BYSTANDER))).toEqual([bystanderKey]);
        expect(await listKeys(ARCHIVE_BUCKET, ownerMediaPrefix(BYSTANDER))).toHaveLength(1);

        // ── The bookkeeping: the registry is KEPT, the job is completed ──────────────────────────────────────
        expect(await count(sql`SELECT count(*)::int AS count FROM test_principals WHERE user_id = ${PRINCIPAL}`)).toBe(
            1,
        );
        expect(await jobs(PRINCIPAL)).toEqual([{ status: 'completed', attempts: 1, last_error: null }]);

        // ── A SECOND reset of the same slot runs cleanly ─────────────────────────────────────────────────────
        await db.execute(sql`INSERT INTO test_reset_jobs (user_id) VALUES (${PRINCIPAL})`);
        const nextRunRecipe = await insertRecipe(PRINCIPAL, 'Next run', { visibility: 'public' });
        await putObject(MEDIA_BUCKET, `${recipeMediaPrefix(PRINCIPAL, nextRunRecipe)}photos/cover`);

        await runHandler(resetEvent(PRINCIPAL));

        expect(await count(sql`SELECT count(*)::int AS count FROM recipes WHERE owner_id = ${PRINCIPAL}`)).toBe(0);
        expect(await listKeys(MEDIA_BUCKET, ownerMediaPrefix(PRINCIPAL))).toEqual([]);
        expect((await jobs(PRINCIPAL)).map((job) => job.status)).toEqual(['completed', 'completed']);
    });

    it('acknowledges a duplicate delivery of a FINISHED reset without purging what the next run wrote', async () => {
        await registerAndQueue(PRINCIPAL);
        await runHandler(resetEvent(PRINCIPAL));

        // The next test run starts writing the moment the reset completes…
        const nextRunRecipe = await insertRecipe(PRINCIPAL, 'Next run fixture', { visibility: 'public' });
        const nextRunKey = `${recipeMediaPrefix(PRINCIPAL, nextRunRecipe)}photos/cover`;
        await putObject(MEDIA_BUCKET, nextRunKey);

        // …and SQS redelivers the old message.
        await expect(runHandler(resetEvent(PRINCIPAL))).resolves.toBeUndefined();

        expect(await count(sql`SELECT count(*)::int AS count FROM recipes WHERE id = ${nextRunRecipe}`)).toBe(1);
        expect(await listKeys(MEDIA_BUCKET, ownerMediaPrefix(PRINCIPAL))).toEqual([nextRunKey]);
    });

    it('⛔ acknowledges a duplicate delivery of a RUNNING reset without purging what that run has not yet reached', async () => {
        // The first delivery has claimed the job and is mid-purge (simulated by the claim alone). A genuine SQS
        // duplicate arrives. Before LOW-5 it re-claimed the `running` job and ran a second purge beside the first,
        // whose READ COMMITTED statements and owner-prefix sweep would reach writes made after the first finished.
        await registerAndQueue(PRINCIPAL);
        expect(await claimTestResetJob(db, PRINCIPAL)).toMatchObject({ attempts: 1 });
        const written = await insertRecipe(PRINCIPAL, 'Written while the first purge runs', { visibility: 'private' });
        const key = `${recipeMediaPrefix(PRINCIPAL, written)}photos/cover`;
        await putObject(MEDIA_BUCKET, key);

        await expect(runHandler(resetEvent(PRINCIPAL))).resolves.toBeUndefined();

        expect(await count(sql`SELECT count(*)::int AS count FROM recipes WHERE id = ${written}`)).toBe(1);
        // `toContain`, not `toEqual`: the buckets outlive each case, so an earlier case's un-purged object may share the
        // prefix. What this case owns is that ITS object survived.
        expect(await listKeys(MEDIA_BUCKET, ownerMediaPrefix(PRINCIPAL))).toContain(key);
        // Still the first delivery's: running, one attempt, no annotation.
        expect(await jobs(PRINCIPAL)).toEqual([{ status: 'running', attempts: 1, last_error: null }]);
    });

    it('⛔ lets exactly ONE of two concurrent deliveries claim a queued reset', async () => {
        await registerAndQueue(PRINCIPAL);

        // Two pooled connections, so the two UPDATEs genuinely contend on the row rather than running in sequence.
        const claims = await Promise.all([claimTestResetJob(db, PRINCIPAL), claimTestResetJob(db, PRINCIPAL)]);

        expect(claims.filter((claim) => claim !== undefined)).toHaveLength(1);
        expect(await jobs(PRINCIPAL)).toEqual([{ status: 'running', attempts: 1, last_error: null }]);
    });

    it('⛔ runs two concurrent duplicate deliveries end to end as ONE purge that completes once', async () => {
        await registerAndQueue(PRINCIPAL);
        await insertRecipe(PRINCIPAL, 'Estate', { visibility: 'private' });

        const outcomes = await Promise.allSettled([
            runHandler(resetEvent(PRINCIPAL)),
            runHandler(resetEvent(PRINCIPAL)),
        ]);

        expect(outcomes.map((outcome) => outcome.status)).toEqual(['fulfilled', 'fulfilled']);
        expect(await count(sql`SELECT count(*)::int AS count FROM recipes WHERE owner_id = ${PRINCIPAL}`)).toBe(0);
        // ONE claim: attempts would read 2 had the loser re-claimed the running job.
        expect(await jobs(PRINCIPAL)).toEqual([{ status: 'completed', attempts: 1, last_error: null }]);
    });

    it('REFUSES an owner the registry does not name: deletes nothing, fails the delivery, stays non-terminal', async () => {
        await registerAndQueue(UNREGISTERED, false);
        const recipe = await insertRecipe(UNREGISTERED, 'Real data', { visibility: 'public' });
        const key = `${recipeMediaPrefix(UNREGISTERED, recipe)}photos/cover`;
        await putObject(MEDIA_BUCKET, key);

        const outcome = await runHandler(resetEvent(UNREGISTERED)).catch((error: unknown) => error);

        expect(isMisroutedErasureMessageError(outcome)).toBe(true);
        expect(await count(sql`SELECT count(*)::int AS count FROM recipes WHERE id = ${recipe}`)).toBe(1);
        expect(await listKeys(MEDIA_BUCKET, ownerMediaPrefix(UNREGISTERED))).toEqual([key]);
        // Released back to `queued` (non-terminal) with the reason, so SQS's redelivery re-claims it and fails again
        // toward the DLQ, and the sweeper's give-up path can later retire it. Left `running`, every redelivery would
        // claim nothing and acknowledge itself as a duplicate.
        const [job] = await jobs(UNREGISTERED);
        expect(job?.status).toBe('queued');
        expect(job?.attempts).toBe(1);
        expect(job?.last_error).toContain('test_principals');
    });

    it('FAILS a reset for an owner with no job row in this database, touching nothing', async () => {
        await db.execute(sql`INSERT INTO test_principals (user_id) VALUES (${PRINCIPAL})`);
        const recipe = await insertRecipe(PRINCIPAL, 'Untouched');

        const outcome = await runHandler(resetEvent(PRINCIPAL)).catch((error: unknown) => error);

        expect(isMisroutedErasureMessageError(outcome)).toBe(true);
        expect(await count(sql`SELECT count(*)::int AS count FROM recipes WHERE id = ${recipe}`)).toBe(1);
    });
});
