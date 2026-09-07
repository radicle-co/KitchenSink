import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CreateBucketCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { pseudonymizedAuthorHandle, recipeMediaPrefix } from '@kitchensink/recipe-core';
import { sql } from 'drizzle-orm';
import pg from 'pg';

import {
    claimErasureJob,
    eraseRecipeObjects,
    eraseRecipeRows,
    erasureJobExistsForOwner,
    markErasureJobCompleted,
    ownerMediaPrefix,
    recordErasureJobError,
} from '../../../src/handlers/accountErasureWorker.js';
import { disposableDatabaseUrl } from '../disposableDatabaseUrl.js';

/**
 * T137 (worker half) — the SCOPED account-erasure worker's DESTRUCTIVE seams against real Postgres + real
 * S3 (LocalStack), the GDPR right-to-erasure path (C-007 / D7 / CR-002 / U3).
 *
 * **Why this file has to exist, next to the unit suite that already covers this handler.** The unit tier
 * drives the whole `handler` over a fake db + a mocked S3 and exhaustively pins the ORCHESTRATION and the
 * emitted SQL. What a fake db CANNOT establish — and what this tier is exclusively for — is whether the
 * REAL schema does what the handler assumes, now under the scoped (owner-only) erasure:
 *
 *   - **The two-axis keep/remove rule is real.** Only PostgreSQL evaluating `NOT (visibility='public' AND
 *     status='published')` against real rows proves an owner-only recipe (private OR draft) is removed while
 *     a truly-public recipe survives — a fake db can only prove the statement ran.
 *   - **The cascade graph is real.** Every child table (`recipe_steps`, `recipe_ingredients`,
 *     `recipe_photos`, `recipe_versions`, `recipe_collections`, `recipe_version_pending_archives`) vanishes
 *     with its REMOVED recipe by `ON DELETE CASCADE`; `ingredients` (shared, owner-less) is left standing.
 *   - **`cloned_from_id` is NO ACTION, and the survivor-scoped detach is the only thing that keeps the
 *     scoped delete from FK-failing.** The critical case only real FKs can prove: a DONATED clone the owner
 *     KEEPS, pointing at their OWN removed source, must be detached (`id NOT IN removed`) or the delete
 *     throws `recipes_cloned_from_id_fkey`. An `owner_id <> ownerId` guard would MISS it — this file is what
 *     proves the guard must be survivor-scoped.
 *   - **The author-handle residue scrub is real.** A kept recipe's denormalized `author_handle` becomes the
 *     pseudonym, and the `author_handles` read-model row is deleted — verifiable only against real rows.
 *   - **The per-removed-recipe S3 sweep spares a KEPT recipe's media** — genuine `ListObjectsV2`/`DeleteObjects`.
 *
 * The handler's own `getRecipeDb()` mints an RDS-IAM token no local Postgres can honour, so these drive the
 * exported `db`-taking seams over a local pool — REAL SQL on the REAL schema, only the connection differs.
 * Runs only with both harnesses up (`DATABASE_URL` + `S3_ENDPOINT`), otherwise skipped in lockstep.
 */

const DATABASE_URL = disposableDatabaseUrl();
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

/** Visibility/status shorthand for a recipe fixture. */
interface RecipeVisibilityOptions {
    readonly visibility?: 'public' | 'private';
    readonly status?: 'draft' | 'published';
    readonly clonedFromId?: string;
    readonly deletedAt?: boolean;
    readonly authorHandle?: string;
}

describe.skipIf(!canRun)('account-erasure worker — scoped erasure on the real schema (T137 integration)', () => {
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
        await db.execute(sql`DELETE FROM author_handles WHERE user_id IN (${OWNER_A}, ${OWNER_B})`);
        await db.execute(sql`DELETE FROM ingredients WHERE id = ${SHARED_INGREDIENT_ID}`);
        await db.execute(
            sql`DELETE FROM account_erasure_jobs WHERE owner_id IN (${OWNER_A}, ${OWNER_B}, ${OWNER_JOB})`,
        );
    });

    afterAll(async () => {
        s3?.destroy();
        await pool.end();
    });

    /**
     * Insert one recipe and return its generated id. Defaults to OWNER-ONLY (`private`, `published`) so a
     * fixture recipe is REMOVED unless a test makes it truly-public or donates it. `deletedAt` → a tombstone.
     */
    async function insertRecipe(
        ownerId: string,
        title: string,
        options: RecipeVisibilityOptions = {},
    ): Promise<string> {
        const result = await db.execute<{ id: string }>(sql`
            INSERT INTO recipes
                (owner_id, title, servings, prep_time_minutes, cook_time_minutes, total_time_minutes,
                 visibility, status, cloned_from_id, deleted_at, author_handle)
            VALUES
                (${ownerId}, ${title}, 2, 5, 10, 15,
                 ${options.visibility ?? 'private'}, ${options.status ?? 'published'},
                 ${options.clonedFromId ?? null}, ${options.deletedAt ? sql`now()` : sql`NULL`},
                 ${options.authorHandle ?? null})
            RETURNING id
        `);

        return result.rows[0]!.id;
    }

    /** Insert a `running` erasure job for an owner (so the removed-id capture has a target) and return its id. */
    async function insertRunningJob(ownerId: string, publishRecipeIds: string[] = []): Promise<string> {
        const row = await db.execute<{ id: string }>(sql`
            INSERT INTO account_erasure_jobs (owner_id, status, publish_recipe_ids)
            VALUES (${ownerId}, 'running', ${JSON.stringify(publishRecipeIds)}::jsonb)
            RETURNING id
        `);

        return row.rows[0]!.id;
    }

    /**
     * Count rows in `table` where `column = value`.
     *
     * `table` and `column` are IDENTIFIERS, and SQL has no parameter form for an identifier — which is exactly
     * the case the `sql.raw` ban's message points at. The answer is drizzle's own `sql.identifier`, not a raw
     * splice: it emits a properly quoted identifier and doubles any embedded quote, so a hostile name becomes
     * one harmless quoted identifier (verified: `a"; DROP TABLE t; --` renders as `"a""; DROP TABLE t; --"`)
     * rather than new SQL. `value` stays a bound parameter as before.
     */
    async function count(table: string, column: string, value: string): Promise<number> {
        const result = await db.execute<CountRow>(
            sql`SELECT count(*)::int AS count FROM ${sql.identifier(table)} WHERE ${sql.identifier(column)} = ${value}`,
        );

        return result.rows[0]?.count ?? 0;
    }

    async function recipeExists(id: string): Promise<boolean> {
        return (await count('recipes', 'id', id)) === 1;
    }

    it('removes OWNER-ONLY recipes (incl. tombstones + drafts), fires cascades, and KEEPS truly-public + donated', async () => {
        await db.execute(sql`
            INSERT INTO ingredients (id, name, is_user_entered) VALUES (${SHARED_INGREDIENT_ID}, 'Shared Salt', true)
        `);

        // ── OWNER_A's estate ────────────────────────────────────────────────────────────────────────
        // Owner-only ACTIVE (private) recipe carrying one of every child row → REMOVED (proves the cascades).
        const ownerOnly = await insertRecipe(OWNER_A, 'Private Recipe', { visibility: 'private', status: 'published' });
        await db.execute(
            sql`INSERT INTO recipe_steps (recipe_id, step_number, instruction) VALUES (${ownerOnly}, 1, 'Stir')`,
        );
        await db.execute(sql`
            INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit, ingredient_name)
            VALUES (${ownerOnly}, ${SHARED_INGREDIENT_ID}, 1, 'tsp', 'Shared Salt')
        `);
        await db.execute(sql`
            INSERT INTO recipe_photos (recipe_id, s3_key, content_type)
            VALUES (${ownerOnly}, ${`${recipeMediaPrefix(OWNER_A, ownerOnly)}photos/cover.jpg`}, 'image/jpeg')
        `);
        const version = await db.execute<{ id: string }>(sql`
            INSERT INTO recipe_versions (recipe_id, version_number, snapshot, created_by)
            VALUES (${ownerOnly}, 1, ${JSON.stringify({ version: 1 })}::jsonb, ${OWNER_A})
            RETURNING id
        `);
        await db.execute(sql`
            INSERT INTO recipe_version_pending_archives (recipe_version_id, recipe_id, version_number)
            VALUES (${version.rows[0]!.id}, ${ownerOnly}, 1)
        `);

        // A public-visibility DRAFT — owner-only REGARDLESS of visibility (the two-axis rule). REMOVED.
        const publicDraft = await insertRecipe(OWNER_A, 'Public Draft', { visibility: 'public', status: 'draft' });
        // A TOMBSTONED owner-only recipe — the "no deleted_at filter" mutation target. REMOVED.
        const tombstoned = await insertRecipe(OWNER_A, 'Tombstoned', { visibility: 'private', deletedAt: true });
        // A recipe OWNER_B has cloned — the NO-ACTION self-FK. Owner-only → REMOVED, so its clone detaches.
        const clonedSource = await insertRecipe(OWNER_A, 'Cloned Source', { visibility: 'private' });

        // A TRULY-PUBLIC recipe with a cleartext author handle → KEPT, handle scrubbed to the pseudonym.
        const keptPublic = await insertRecipe(OWNER_A, 'Public Recipe', {
            visibility: 'public',
            status: 'published',
            authorHandle: 'Alice Cleartext',
        });

        // A DONATED private recipe: elected to publish → flipped to public+published → KEPT.
        const donated = await insertRecipe(OWNER_A, 'Donated Recipe', {
            visibility: 'private',
            status: 'draft',
            authorHandle: 'Alice Cleartext',
        });

        // ── OWNER_B's estate (all must survive) ───────────────────────────────────────────────────────
        const foreignClone = await insertRecipe(OWNER_B, 'B Clone', { clonedFromId: clonedSource });
        await insertRecipe(OWNER_B, 'B Own Recipe');

        // A running job so the removed-id capture has a target.
        const jobId = await insertRunningJob(OWNER_A, [donated]);

        // ── Erase, donating `donated`. If the survivor detach were owner-id-scoped, `foreignClone` would
        //    still be handled — but the flip-then-delete of `clonedSource` proves the removed-set scoping. ─
        const { removedRecipeIds } = await eraseRecipeRows(db, OWNER_A, [donated]);

        // Owner-only recipes are gone (private, public-draft, tombstone, cloned-source).
        expect(await recipeExists(ownerOnly)).toBe(false);
        expect(await recipeExists(publicDraft)).toBe(false);
        expect(await recipeExists(tombstoned)).toBe(false);
        expect(await recipeExists(clonedSource)).toBe(false);
        // The kept + donated recipes SURVIVE.
        expect(await recipeExists(keptPublic)).toBe(true);
        expect(await recipeExists(donated)).toBe(true);

        // The donate flip set BOTH axes → community-visible.
        const donatedRow = await db.execute<{ visibility: string; status: string }>(
            sql`SELECT visibility, status FROM recipes WHERE id = ${donated}`,
        );
        expect(donatedRow.rows[0]).toEqual({ visibility: 'public', status: 'published' });

        // The captured removed set = exactly the owner-only, non-donated recipes.
        expect([...removedRecipeIds].sort()).toEqual([ownerOnly, publicDraft, tombstoned, clonedSource].sort());
        // ...and it was persisted on the job row (crash-convergence).
        const persisted = await db.execute<{ removed_recipe_ids: string[] }>(
            sql`SELECT removed_recipe_ids FROM account_erasure_jobs WHERE id = ${jobId}`,
        );
        expect([...(persisted.rows[0]?.removed_recipe_ids ?? [])].sort()).toEqual(removedRecipeIds.slice().sort());

        // Author-handle residue: KEPT rows carry the pseudonym, no cleartext; the read-model row is gone.
        const pseudonym = pseudonymizedAuthorHandle(OWNER_A);
        const keptHandles = await db.execute<{ author_handle: string | null }>(
            sql`SELECT author_handle FROM recipes WHERE owner_id = ${OWNER_A}`,
        );

        for (const row of keptHandles.rows) {
            expect(row.author_handle).toBe(pseudonym);
            expect(row.author_handle).not.toContain('Cleartext');
        }

        expect(await count('author_handles', 'user_id', OWNER_A)).toBe(0);

        // Cascades from the removed active recipe's id all fired.
        expect(await count('recipe_steps', 'recipe_id', ownerOnly)).toBe(0);
        expect(await count('recipe_ingredients', 'recipe_id', ownerOnly)).toBe(0);
        expect(await count('recipe_photos', 'recipe_id', ownerOnly)).toBe(0);
        expect(await count('recipe_versions', 'recipe_id', ownerOnly)).toBe(0);
        expect(await count('recipe_version_pending_archives', 'recipe_id', ownerOnly)).toBe(0);

        // Survivors: the shared ingredient, B's two recipes, and B's clone (provenance cut, no FK failure).
        expect(await count('ingredients', 'id', SHARED_INGREDIENT_ID)).toBe(1);
        expect(await count('recipes', 'owner_id', OWNER_B)).toBe(2);
        const clonedFrom = await db.execute<{ cloned_from_id: string | null }>(
            sql`SELECT cloned_from_id FROM recipes WHERE id = ${foreignClone}`,
        );
        expect(clonedFrom.rows[0]?.cloned_from_id).toBeNull();
    });

    it('detaches a DONATED clone of the owner’s OWN removed source (the survivor-scoped FK edge)', async () => {
        // THE case an `owner_id <> ownerId` detach guard would MISS: the owner clones their OWN private
        // recipe, then DONATES the clone. The clone is KEPT (flipped public+published) but points at the
        // REMOVED source. The delete of the source must not FK-fail — the survivor (`id NOT IN removed`)
        // detach is what makes this pass. Self-clone is allowed ("clone ... the caller's own").
        const source = await insertRecipe(OWNER_A, 'Private Source', { visibility: 'private', status: 'published' });
        const donatedClone = await insertRecipe(OWNER_A, 'Donated Clone', {
            visibility: 'private',
            status: 'draft',
            clonedFromId: source,
        });
        await insertRunningJob(OWNER_A, [donatedClone]);

        // Donate the clone; erase. With an owner-id-scoped detach this would throw recipes_cloned_from_id_fkey.
        await expect(eraseRecipeRows(db, OWNER_A, [donatedClone])).resolves.toBeDefined();

        // The source is removed; the donated clone survives, public+published, with its provenance cut.
        expect(await recipeExists(source)).toBe(false);
        const clone = await db.execute<{ visibility: string; status: string; cloned_from_id: string | null }>(
            sql`SELECT visibility, status, cloned_from_id FROM recipes WHERE id = ${donatedClone}`,
        );
        expect(clone.rows[0]).toEqual({ visibility: 'public', status: 'published', cloned_from_id: null });
    });

    it('does NOT corrupt a surviving public recipe’s provenance (detach scoped to the removed set)', async () => {
        // A owns a truly-public recipe P cloned from ANOTHER surviving recipe (B's). P is KEPT; its
        // cloned_from_id points at a SURVIVOR, so the scoped detach must leave it intact (only pointers to
        // REMOVED recipes are nulled). Owner-wide detach would wrongly cut this.
        const bSource = await insertRecipe(OWNER_B, 'B Source');
        const keptClone = await insertRecipe(OWNER_A, 'A Public Clone of B', {
            visibility: 'public',
            status: 'published',
            clonedFromId: bSource,
        });
        // Plus one owner-only recipe so there IS a removed set.
        await insertRecipe(OWNER_A, 'A Private', { visibility: 'private' });
        await insertRunningJob(OWNER_A);

        await eraseRecipeRows(db, OWNER_A, []);

        expect(await recipeExists(keptClone)).toBe(true);
        const row = await db.execute<{ cloned_from_id: string | null }>(
            sql`SELECT cloned_from_id FROM recipes WHERE id = ${keptClone}`,
        );
        // Provenance to a SURVIVING recipe is preserved.
        expect(row.rows[0]?.cloned_from_id).toBe(bSource);
    });

    it('deletes the erasing user’s ratings on OTHER users’ recipes and re-derives the survivors’ aggregate (CR-001)', async () => {
        const RATER_C = '01JERASEWORKER00RATERC0000C';

        // B's recipe (kept — owned by B) is rated by A and C; A's own owner-only recipe is rated by A.
        const bRecipe = await insertRecipe(OWNER_B, 'B Recipe rated by A and C');
        const aRecipe = await insertRecipe(OWNER_A, 'A Own Recipe rated by A', { visibility: 'private' });

        await db.execute(sql`
            INSERT INTO recipe_ratings (recipe_id, user_id, stars) VALUES
                (${bRecipe}, ${OWNER_A}, 5),
                (${bRecipe}, ${RATER_C}, 3),
                (${aRecipe}, ${OWNER_A}, 4)
        `);

        const before = await db.execute<{ rating_count: number; average_rating: string | null }>(
            sql`SELECT rating_count, average_rating FROM recipes WHERE id = ${bRecipe}`,
        );
        expect(before.rows[0]).toEqual({ rating_count: 2, average_rating: '4.00' });

        await insertRunningJob(OWNER_A);
        await eraseRecipeRows(db, OWNER_A, []);

        // A's rating on B's SURVIVING recipe is gone; C's survives; the statement-level trigger re-derived
        // B's aggregate; A's own (owner-only) recipe + its rating went by cascade.
        expect(await count('recipe_ratings', 'user_id', OWNER_A)).toBe(0);
        expect(await count('recipe_ratings', 'user_id', RATER_C)).toBe(1);
        expect(await recipeExists(aRecipe)).toBe(false);
        const after = await db.execute<{ rating_count: number; average_rating: string | null }>(
            sql`SELECT rating_count, average_rating FROM recipes WHERE id = ${bRecipe}`,
        );
        expect(after.rows[0]).toEqual({ rating_count: 1, average_rating: '3.00' });
    });

    it('sweeps a REMOVED recipe’s per-recipe prefix in BOTH buckets, sparing a KEPT recipe and other owners', async () => {
        const REMOVED = 'r-removed-000000000000000000000001';
        const KEPT = 'r-kept-00000000000000000000000002';
        const B_RECIPE = 'r-b-00000000000000000000000000003';

        // A removed recipe's objects (media + archive), a KEPT recipe's objects, and a B object.
        await s3.send(
            new PutObjectCommand({
                Bucket: MEDIA_BUCKET,
                Key: `${recipeMediaPrefix(OWNER_A, REMOVED)}photos/cover.jpg`,
                Body: 'a',
            }),
        );
        await s3.send(
            new PutObjectCommand({
                Bucket: ARCHIVE_BUCKET,
                Key: `${recipeMediaPrefix(OWNER_A, REMOVED)}versions/1.json`,
                Body: 'a',
            }),
        );
        await s3.send(
            new PutObjectCommand({
                Bucket: MEDIA_BUCKET,
                Key: `${recipeMediaPrefix(OWNER_A, KEPT)}photos/cover.jpg`,
                Body: 'k',
            }),
        );
        await s3.send(
            new PutObjectCommand({
                Bucket: MEDIA_BUCKET,
                Key: `${recipeMediaPrefix(OWNER_B, B_RECIPE)}cover.jpg`,
                Body: 'b',
            }),
        );

        const listKeys = async (bucket: string, prefix: string): Promise<string[]> => {
            const listed = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }));

            return (listed.Contents ?? []).flatMap((entry) => (entry.Key ? [entry.Key] : []));
        };

        // Sweep ONLY the removed recipe's prefix, per bucket.
        expect(await eraseRecipeObjects(s3, MEDIA_BUCKET, OWNER_A, REMOVED)).toBe(1);
        expect(await eraseRecipeObjects(s3, ARCHIVE_BUCKET, OWNER_A, REMOVED)).toBe(1);

        // The removed recipe's prefix is empty in BOTH buckets...
        expect(await listKeys(MEDIA_BUCKET, recipeMediaPrefix(OWNER_A, REMOVED))).toEqual([]);
        expect(await listKeys(ARCHIVE_BUCKET, recipeMediaPrefix(OWNER_A, REMOVED))).toEqual([]);
        // ...the KEPT recipe's media SURVIVES (the whole point of the scoped sweep)...
        expect(await listKeys(MEDIA_BUCKET, recipeMediaPrefix(OWNER_A, KEPT))).toHaveLength(1);
        // ...and B's object is untouched.
        expect(await listKeys(MEDIA_BUCKET, ownerMediaPrefix(OWNER_B))).toHaveLength(1);

        // Idempotent replay over an already-swept recipe deletes nothing.
        expect(await eraseRecipeObjects(s3, MEDIA_BUCKET, OWNER_A, REMOVED)).toBe(0);

        // Clean up the objects this test created (no owner-scoped DB teardown covers S3).
        await eraseRecipeObjects(s3, MEDIA_BUCKET, OWNER_A, KEPT);
        await eraseRecipeObjects(s3, MEDIA_BUCKET, OWNER_B, B_RECIPE);
    });

    it('claims → completes → replays clean, and resumes a job left running by a crash', async () => {
        const queued = await db.execute<{ id: string }>(
            sql`INSERT INTO account_erasure_jobs (owner_id, status) VALUES (${OWNER_JOB}, 'queued') RETURNING id`,
        );
        const jobId = queued.rows[0]!.id;

        const firstClaim = await claimErasureJob(db, OWNER_JOB);
        expect(firstClaim?.id).toBe(jobId);
        const afterClaim = await db.execute<{ status: string; attempts: number }>(
            sql`SELECT status, attempts FROM account_erasure_jobs WHERE id = ${jobId}`,
        );
        expect(afterClaim.rows[0]).toEqual({ status: 'running', attempts: 1 });

        await recordErasureJobError(db, jobId, new Error('transient S3 blip'));
        const afterError = await db.execute<{ status: string; last_error: string }>(
            sql`SELECT status, last_error FROM account_erasure_jobs WHERE id = ${jobId}`,
        );
        expect(afterError.rows[0]?.status).toBe('running');
        expect(afterError.rows[0]?.last_error).toBe('transient S3 blip');

        const resumeClaim = await claimErasureJob(db, OWNER_JOB);
        expect(resumeClaim?.id).toBe(jobId);

        await markErasureJobCompleted(db, jobId);
        const completed = await db.execute<{ status: string; last_error: string | null }>(
            sql`SELECT status, last_error FROM account_erasure_jobs WHERE id = ${jobId}`,
        );
        expect(completed.rows[0]).toEqual({ status: 'completed', last_error: null });

        expect(await claimErasureJob(db, OWNER_JOB)).toBeUndefined();
    });

    it('the interlock’s two predicates tell a completed REPLAY from a MISROUTED owner on the real schema', async () => {
        // `processRecord` refuses — and now FAILS the delivery (`MisroutedErasureMessageError`) — when the
        // claim returns nothing AND no row of any status exists. The handler cannot run here (its
        // `getRecipeDb()` mints an RDS-IAM token), so what this tier proves is that the two real queries the
        // decision is made from answer differently for the two cases the unit suite distinguishes by fake
        // rows: a `completed` row claims nothing yet EXISTS (replay → idempotent no-op, acknowledged), while
        // an owner with no row at all claims nothing AND does not exist (misroute → refused, redelivered).
        await db.execute(sql`INSERT INTO account_erasure_jobs (owner_id, status) VALUES (${OWNER_JOB}, 'completed')`);

        expect(await claimErasureJob(db, OWNER_JOB)).toBeUndefined();
        expect(await erasureJobExistsForOwner(db, OWNER_JOB)).toBe(true);

        // OWNER_A has no job row in this database at all — the misrouted shape.
        expect(await claimErasureJob(db, OWNER_A)).toBeUndefined();
        expect(await erasureJobExistsForOwner(db, OWNER_A)).toBe(false);
    });
});
