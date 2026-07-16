import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CreateBucketCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import pg from 'pg';

import {
    claimErasureJob,
    eraseRecipeObjects,
    eraseRecipeRows,
    markErasureJobCompleted,
    ownerMediaPrefix,
    recordErasureJobError,
} from '../../../src/handlers/account-erasure-worker.js';

/**
 * T137 (worker half) — the account-erasure worker's DESTRUCTIVE seams against real Postgres + real S3
 * (LocalStack), the GDPR right-to-erasure path (C-007 / D7).
 *
 * **Why this file has to exist, next to the unit suite that already covers this handler.** The unit
 * tier (`src/handlers/__tests__/account-erasure-worker.test.ts`) drives the whole `handler` over a fake
 * db + a mocked S3, and it exhaustively pins the ORCHESTRATION — claim-before-work, rows-before-objects,
 * `completed`-only-after-both-sweeps, dual-bucket order, fail-fast on a missing bucket. None of that is
 * re-asserted here. What a fake db CANNOT establish — and what this tier is exclusively for — is whether
 * the real schema actually does what the handler assumes:
 *
 *   - **The cascade graph is real, not remembered.** `eraseRecipeRows` issues one detach UPDATE and two
 *     DELETEs; every child table (`recipe_steps`, `recipe_ingredients`, `recipe_photos`,
 *     `recipe_versions`, `recipe_collections`, `recipe_version_pending_archives`) is expected to vanish
 *     by `ON DELETE CASCADE`, and `collections` cascades to its own memberships. A mock proves the
 *     statements ran; only Postgres proves the cascades fire and that `ingredients` (shared, owner-less)
 *     is left standing.
 *   - **`cloned_from_id` is NO ACTION.** The self-FK has no `ON DELETE` clause. Another user's clone
 *     pointing at the erased owner's recipe makes the raw DELETE throw `recipes_cloned_from_id_fkey` — a
 *     fact that exists only in `pg_constraint`, invisible to a fake db. This is the single reason the
 *     detach-UPDATE exists, so a test with real FKs is the only thing that can keep it honest.
 *   - **No `deleted_at` filter.** Whether a tombstoned recipe is really deleted (not skipped by a
 *     read-path habit) is a property of the emitted SQL against a real row, not of a mock's call log.
 *   - **The prefix sweep is real S3.** That both named buckets clear under one owner prefix, and that a
 *     different owner's objects are untouched, is genuine `ListObjectsV2`/`DeleteObjects` semantics.
 *
 * Like the T133 archive integration alongside it, the handler's own `getRecipeDb()` mints an RDS-IAM
 * token no local Postgres can honour, so these drive the exported `db`-taking seams over a local pool.
 * That is the REAL SQL on the REAL schema — only the connection differs. Requires the schema to already
 * be present (the recipe-service integration run migrates `kitchensink_recipes*`); runs only with both
 * harnesses up (`DATABASE_URL` + `S3_ENDPOINT`), otherwise skipped in lockstep.
 */

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];
const S3_ENDPOINT = process.env['S3_ENDPOINT'];
const canRun = Boolean(DATABASE_URL) && Boolean(S3_ENDPOINT);

/** The owner erased by the tests. */
const OWNER_A = '01JERASEWORKER00OWNERA0000A';

/** A bystander owner whose recipes, clone, collection and objects MUST all survive A's erasure. */
const OWNER_B = '01JERASEWORKER00OWNERB0000B';

/** A distinct owner for the job-lifecycle test, so it never contends on A's active-job index. */
const OWNER_JOB = '01JERASEWORKER000JOBOWNER0J';

/** A shared, owner-less catalog ingredient — the row that must SURVIVE an erasure. */
const SHARED_INGREDIENT_ID = '00000000-0000-4000-8000-00000e7a5e01';

/** Both buckets an owner's objects live in — keyed under the SAME owner prefix (ARCH-BE-3). */
const MEDIA_BUCKET = process.env['S3_BUCKET_PHOTOS'] ?? 'commise-photos';
const ARCHIVE_BUCKET = process.env['S3_BUCKET_VERSIONS'] ?? 'commise-versions';

/**
 * A `type`, not an `interface`, so it carries the implicit index signature Drizzle's `execute<T>`
 * requires of a row shape (`T extends Record<string, unknown>`) — the same reason the worker's own
 * `ErasureJobClaim` is a type. A named interface would fail that constraint.
 */
type CountRow = {
    readonly count: number;
};

describe.skipIf(!canRun)('account-erasure worker — DB cascade + dual-bucket sweep (T137 integration)', () => {
    let pool: pg.Pool;
    let db: NodePgDatabase<Record<string, never>>;
    let s3: S3Client;

    beforeAll(async () => {
        pool = new pg.Pool({ connectionString: DATABASE_URL });
        db = drizzle(pool);
        s3 = new S3Client({
            endpoint: S3_ENDPOINT,
            region: process.env['AWS_REGION'] ?? 'us-east-1',
            forcePathStyle: true,
            credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
        });

        // The two named buckets are provisioned by the harness; CreateBucket is a no-op if they exist.
        await s3.send(new CreateBucketCommand({ Bucket: MEDIA_BUCKET })).catch(() => undefined);
        await s3.send(new CreateBucketCommand({ Bucket: ARCHIVE_BUCKET })).catch(() => undefined);
    });

    afterEach(async () => {
        // Owner-scoped teardown so a failed run never leaks a fixture into the next. Detach any surviving
        // clone first (its cloned_from_id may still point at an A recipe), then delete every owner's rows.
        await db.execute(sql`
            UPDATE recipes SET cloned_from_id = NULL
            WHERE cloned_from_id IN (SELECT id FROM recipes WHERE owner_id IN (${OWNER_A}, ${OWNER_B}))
        `);
        await db.execute(sql`DELETE FROM recipes WHERE owner_id IN (${OWNER_A}, ${OWNER_B})`);
        await db.execute(sql`DELETE FROM collections WHERE owner_id IN (${OWNER_A}, ${OWNER_B})`);
        await db.execute(sql`DELETE FROM ingredients WHERE id = ${SHARED_INGREDIENT_ID}`);
        await db.execute(
            sql`DELETE FROM account_erasure_jobs WHERE owner_id IN (${OWNER_A}, ${OWNER_B}, ${OWNER_JOB})`,
        );
    });

    afterAll(async () => {
        s3?.destroy();
        await pool.end();
    });

    /** Insert one recipe and return its generated id. `deletedAt` set → a tombstone. */
    async function insertRecipe(
        ownerId: string,
        title: string,
        options: { clonedFromId?: string; deletedAt?: boolean } = {},
    ): Promise<string> {
        const result = await db.execute<{ id: string }>(sql`
            INSERT INTO recipes
                (owner_id, title, servings, prep_time_minutes, cook_time_minutes, total_time_minutes,
                 cloned_from_id, deleted_at)
            VALUES
                (${ownerId}, ${title}, 2, 5, 10, 15,
                 ${options.clonedFromId ?? null}, ${options.deletedAt ? sql`now()` : sql`NULL`})
            RETURNING id
        `);

        return result.rows[0]!.id;
    }

    /** Count rows in `table` where `column = value`. `table`/`column` are test-controlled literals. */
    async function count(table: string, column: string, value: string): Promise<number> {
        const result = await db.execute<CountRow>(
            sql`SELECT count(*)::int AS count FROM ${sql.raw(table)} WHERE ${sql.raw(column)} = ${value}`,
        );

        return result.rows[0]?.count ?? 0;
    }

    it('erases every owned row incl. tombstones, fires all cascades, and leaves other owners intact', async () => {
        // The shared, owner-less ingredient every recipe line points at. Must survive.
        await db.execute(sql`
            INSERT INTO ingredients (id, name, is_user_entered) VALUES (${SHARED_INGREDIENT_ID}, 'Shared Salt', true)
        `);

        // ── OWNER_A's estate ────────────────────────────────────────────────────────────────────────
        // An ACTIVE recipe carrying one of every child row, to prove the six cascades from recipes.id.
        const active = await insertRecipe(OWNER_A, 'Active Recipe');
        await db.execute(
            sql`INSERT INTO recipe_steps (recipe_id, step_number, instruction) VALUES (${active}, 1, 'Stir')`,
        );
        await db.execute(sql`
            INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit, ingredient_name)
            VALUES (${active}, ${SHARED_INGREDIENT_ID}, 1, 'tsp', 'Shared Salt')
        `);
        await db.execute(sql`
            INSERT INTO recipe_photos (recipe_id, s3_key, content_type)
            VALUES (${active}, ${`${ownerMediaPrefix(OWNER_A)}${active}/cover.jpg`}, 'image/jpeg')
        `);
        const version = await db.execute<{ id: string }>(sql`
            INSERT INTO recipe_versions (recipe_id, version_number, snapshot, created_by)
            VALUES (${active}, 1, ${JSON.stringify({ version: 1 })}::jsonb, ${OWNER_A})
            RETURNING id
        `);
        const versionId = version.rows[0]!.id;
        await db.execute(sql`
            INSERT INTO recipe_version_pending_archives (recipe_version_id, recipe_id, version_number)
            VALUES (${versionId}, ${active}, 1)
        `);

        // A TOMBSTONED recipe — the mutation target for the "no deleted_at filter" rule.
        const tombstoned = await insertRecipe(OWNER_A, 'Tombstoned Recipe', { deletedAt: true });

        // A recipe OWNER_B has cloned: the NO-ACTION self-FK. Its detach is the other mutation target.
        const clonedSource = await insertRecipe(OWNER_A, 'Cloned Source');

        // OWNER_A's OWN clone of their own recipe — deleted in the SAME statement as its source, so the
        // end-of-statement NO ACTION check must pass (the referencing row is already gone). No detach.
        const selfSource = await insertRecipe(OWNER_A, 'Self Source');
        const selfClone = await insertRecipe(OWNER_A, 'Self Clone', { clonedFromId: selfSource });

        // ── OWNER_B's estate (all must survive) ───────────────────────────────────────────────────────
        const foreignClone = await insertRecipe(OWNER_B, 'B Clone', { clonedFromId: clonedSource });
        const bOwnedRecipe = await insertRecipe(OWNER_B, 'B Own Recipe');

        // collections.id cascade, ISOLATED from recipe deletion: A's collection holds B's SURVIVING
        // recipe, so that membership can only disappear via the collection's own cascade, not the recipe's.
        const aCollectionRow = await db.execute<{ id: string }>(sql`
            INSERT INTO collections (owner_id, name) VALUES (${OWNER_A}, 'A Collection') RETURNING id
        `);
        const aCollection = aCollectionRow.rows[0]!.id;
        await db.execute(
            sql`INSERT INTO recipe_collections (collection_id, recipe_id) VALUES (${aCollection}, ${bOwnedRecipe})`,
        );

        // recipes.id cascade, ISOLATED from collection deletion: B's collection holds A's ACTIVE recipe,
        // so that membership can only disappear via the recipe's cascade, not the collection's.
        const bCollectionRow = await db.execute<{ id: string }>(sql`
            INSERT INTO collections (owner_id, name) VALUES (${OWNER_B}, 'B Collection') RETURNING id
        `);
        const bCollection = bCollectionRow.rows[0]!.id;
        await db.execute(
            sql`INSERT INTO recipe_collections (collection_id, recipe_id) VALUES (${bCollection}, ${active})`,
        );

        // ── Erase. If the detach were removed, deleting clonedSource would throw the real FK error here. ─
        await eraseRecipeRows(db, OWNER_A);

        // Every recipe A owned is gone — active, tombstone, cloned-source, and both self-clone rows.
        expect(await count('recipes', 'owner_id', OWNER_A)).toBe(0);
        // Named explicitly so the tombstone assertion is unmissable: adding `deleted_at IS NULL` to the
        // DELETE leaves this row behind and flips this to 1.
        expect(await count('recipes', 'id', tombstoned)).toBe(0);
        void selfClone;

        // All six cascades from the active recipe's id fired.
        expect(await count('recipe_steps', 'recipe_id', active)).toBe(0);
        expect(await count('recipe_ingredients', 'recipe_id', active)).toBe(0);
        expect(await count('recipe_photos', 'recipe_id', active)).toBe(0);
        expect(await count('recipe_versions', 'recipe_id', active)).toBe(0);
        expect(await count('recipe_version_pending_archives', 'recipe_id', active)).toBe(0);
        // recipes.id → recipe_collections cascade (membership in B's SURVIVING collection removed).
        expect(await count('recipe_collections', 'recipe_id', active)).toBe(0);

        // A's collection is gone, and collections.id → recipe_collections cascade removed its membership...
        expect(await count('collections', 'owner_id', OWNER_A)).toBe(0);
        expect(await count('recipe_collections', 'collection_id', aCollection)).toBe(0);

        // ── Survivors ────────────────────────────────────────────────────────────────────────────────
        // The shared ingredient — owner-less, referenced by every user — is NOT swept.
        expect(await count('ingredients', 'id', SHARED_INGREDIENT_ID)).toBe(1);
        // B keeps both recipes and both collections.
        expect(await count('recipes', 'owner_id', OWNER_B)).toBe(2);
        expect(await count('collections', 'owner_id', OWNER_B)).toBe(1);
        // B's clone survives with its provenance link cut — the whole point of the detach.
        const clonedFrom = await db.execute<{ cloned_from_id: string | null }>(
            sql`SELECT cloned_from_id FROM recipes WHERE id = ${foreignClone}`,
        );
        expect(clonedFrom.rows[0]?.cloned_from_id).toBeNull();
    });

    it('deletes the erasing user’s ratings on OTHER users’ recipes and re-derives the survivors’ aggregate (CR-001)', async () => {
        // A third rater whose rating on B's recipe must SURVIVE A's erasure.
        const RATER_C = '01JERASEWORKER00RATERC0000C';

        // OWNER_B owns a recipe; both the erasing user (A) and a bystander (C) rate it.
        const bRecipe = await insertRecipe(OWNER_B, 'B Recipe rated by A and C');
        // A also owns a recipe that A rated — that rating goes by the recipes cascade, not the user sweep.
        const aRecipe = await insertRecipe(OWNER_A, 'A Own Recipe rated by A');

        await db.execute(sql`
            INSERT INTO recipe_ratings (recipe_id, user_id, stars) VALUES
                (${bRecipe}, ${OWNER_A}, 5),
                (${bRecipe}, ${RATER_C}, 3),
                (${aRecipe}, ${OWNER_A}, 4)
        `);

        // Trigger has already denormalized B's recipe to count 2, avg 4.00 ((5+3)/2).
        const before = await db.execute<{ rating_count: number; average_rating: string | null }>(
            sql`SELECT rating_count, average_rating FROM recipes WHERE id = ${bRecipe}`,
        );
        expect(before.rows[0]).toEqual({ rating_count: 2, average_rating: '4.00' });

        await eraseRecipeRows(db, OWNER_A);

        // A's rating on B's SURVIVING recipe is gone; C's survives; the statement-level trigger re-derived
        // B's recipe to the single remaining 3-star rating. (A's own recipe + its rating went by cascade.)
        expect(await count('recipe_ratings', 'user_id', OWNER_A)).toBe(0);
        expect(await count('recipe_ratings', 'user_id', RATER_C)).toBe(1);
        expect(await count('recipes', 'id', aRecipe)).toBe(0);
        const after = await db.execute<{ rating_count: number; average_rating: string | null }>(
            sql`SELECT rating_count, average_rating FROM recipes WHERE id = ${bRecipe}`,
        );
        // Re-derived by the trigger off the erasure bulk delete — NOT left stale at 2 / 4.00.
        expect(after.rows[0]).toEqual({ rating_count: 1, average_rating: '3.00' });
    });

    it('sweeps the owner prefix in BOTH the media and the version-archive bucket, sparing other owners', async () => {
        // Objects for A under the SAME owner prefix in EACH bucket (ARCH-BE-3), plus a B object in each.
        await s3.send(
            new PutObjectCommand({ Bucket: MEDIA_BUCKET, Key: `${ownerMediaPrefix(OWNER_A)}r1/cover.jpg`, Body: 'a' }),
        );
        await s3.send(
            new PutObjectCommand({ Bucket: ARCHIVE_BUCKET, Key: `${ownerMediaPrefix(OWNER_A)}r1/v/1.json`, Body: 'a' }),
        );
        await s3.send(
            new PutObjectCommand({ Bucket: MEDIA_BUCKET, Key: `${ownerMediaPrefix(OWNER_B)}r9/cover.jpg`, Body: 'b' }),
        );
        await s3.send(
            new PutObjectCommand({ Bucket: ARCHIVE_BUCKET, Key: `${ownerMediaPrefix(OWNER_B)}r9/v/1.json`, Body: 'b' }),
        );

        const listKeys = async (bucket: string, prefix: string): Promise<string[]> => {
            const listed = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }));

            return (listed.Contents ?? []).flatMap((entry) => (entry.Key ? [entry.Key] : []));
        };

        // The worker calls this once per bucket (media, then archive). Both are real S3 round trips.
        expect(await eraseRecipeObjects(s3, MEDIA_BUCKET, OWNER_A)).toBe(1);
        expect(await eraseRecipeObjects(s3, ARCHIVE_BUCKET, OWNER_A)).toBe(1);

        // A's prefix is empty in BOTH buckets...
        expect(await listKeys(MEDIA_BUCKET, ownerMediaPrefix(OWNER_A))).toEqual([]);
        expect(await listKeys(ARCHIVE_BUCKET, ownerMediaPrefix(OWNER_A))).toEqual([]);
        // ...and B's objects are untouched in BOTH — prefix scoping is real, not assumed.
        expect(await listKeys(MEDIA_BUCKET, ownerMediaPrefix(OWNER_B))).toHaveLength(1);
        expect(await listKeys(ARCHIVE_BUCKET, ownerMediaPrefix(OWNER_B))).toHaveLength(1);

        // Idempotent replay over an already-swept owner deletes nothing.
        expect(await eraseRecipeObjects(s3, MEDIA_BUCKET, OWNER_A)).toBe(0);

        // Clean up B's objects this test created (no owner-scoped DB teardown covers S3).
        await eraseRecipeObjects(s3, MEDIA_BUCKET, OWNER_B);
        await eraseRecipeObjects(s3, ARCHIVE_BUCKET, OWNER_B);
    });

    it('claims → completes → replays clean, and resumes a job left running by a crash', async () => {
        // A queued job, as ErasureService enqueues it.
        const queued = await db.execute<{ id: string }>(
            sql`INSERT INTO account_erasure_jobs (owner_id, status) VALUES (${OWNER_JOB}, 'queued') RETURNING id`,
        );
        const jobId = queued.rows[0]!.id;

        // First claim: queued → running, attempts counted.
        const firstClaim = await claimErasureJob(db, OWNER_JOB);
        expect(firstClaim?.id).toBe(jobId);
        const afterClaim = await db.execute<{ status: string; attempts: number }>(
            sql`SELECT status, attempts FROM account_erasure_jobs WHERE id = ${jobId}`,
        );
        expect(afterClaim.rows[0]).toEqual({ status: 'running', attempts: 1 });

        // A recorded error is NOT terminal: the row stays `running` so SQS/the sweeper can retry, and the
        // active-owner index still holds — only a real DB proves the status is untouched by the annotation.
        await recordErasureJobError(db, jobId, new Error('transient S3 blip'));
        const afterError = await db.execute<{ status: string; last_error: string }>(
            sql`SELECT status, last_error FROM account_erasure_jobs WHERE id = ${jobId}`,
        );
        expect(afterError.rows[0]?.status).toBe('running');
        expect(afterError.rows[0]?.last_error).toBe('transient S3 blip');

        // Redelivery RESUMES the still-running job (claims 'running' too) rather than no-oping.
        const resumeClaim = await claimErasureJob(db, OWNER_JOB);
        expect(resumeClaim?.id).toBe(jobId);

        // Completion is terminal and clears the prior error.
        await markErasureJobCompleted(db, jobId);
        const completed = await db.execute<{ status: string; last_error: string | null }>(
            sql`SELECT status, last_error FROM account_erasure_jobs WHERE id = ${jobId}`,
        );
        expect(completed.rows[0]).toEqual({ status: 'completed', last_error: null });

        // Replay over an already-erased owner finds no active job — a clean no-op, never an error.
        expect(await claimErasureJob(db, OWNER_JOB)).toBeUndefined();
    });
});
