import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CreateBucketCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import pg from 'pg';

import { recipeMediaPrefix } from '@kitchensink/recipe-core';

import { eraseRecipeObjects, ownerMediaPrefix } from '../../../src/handlers/accountErasureWorker.js';
import { readRecentlyCompletedOwners } from '../../../src/handlers/erasureOrphanSweeper.js';

/**
 * The archive-orphan sweep (the archive-resurrection backstop), against real Postgres + real S3
 * (LocalStack).
 *
 * **Why this file exists next to the unit suite.** The unit tier drives the handler over a fake db + a
 * mocked S3 and pins the ORCHESTRATION (completed-only query, per-owner sweep, orphans-deleted metric,
 * error isolation). None of that is re-asserted here. What a fake db cannot establish — and what this
 * tier is exclusively for — is whether the REAL `account_erasure_jobs` query actually selects the right
 * owners against a real clock, and whether the REAL S3 prefix sweep deletes an orphan while sparing a
 * live owner's objects. It reconstructs the handler's real behaviour by driving the two exported
 * `db`/`client`-taking seams the handler composes (`readRecentlyCompletedOwners`, then
 * `eraseRecipeObjects` per owner), because the handler's own `getRecipeDb()` mints an RDS-IAM token no
 * local Postgres can honour — the same seam-driving pattern the archive/erasure integration suites use.
 *
 * The properties it proves, each impossible to fake:
 *
 *   - **`completed`-only, against a real clock.** A `completed` owner within the look-back window is
 *     returned and its orphan is deleted; a `running` owner is NOT (its archives survive — the whole
 *     safety model, and the mutation guard: dropping the status filter deletes a live owner's data); a
 *     `completed` owner OLDER than the window is NOT (the interval predicate is real, not remembered).
 *   - **Real prefix scoping.** The sweep deletes ONLY the target owner's archive prefix — a bystander
 *     owner's object under a different prefix is untouched — via genuine `ListObjectsV2`/`DeleteObjects`.
 *   - **Idempotent replay.** A second sweep over an already-reconciled owner deletes nothing.
 *
 * Runs only with both harnesses up (`DATABASE_URL` + `S3_ENDPOINT`); otherwise skipped in lockstep.
 * Requires the schema to already be present (the recipe-service integration run migrates
 * `kitchensink_recipes*`).
 */

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];
const S3_ENDPOINT = process.env['S3_ENDPOINT'];
const canRun = Boolean(DATABASE_URL) && Boolean(S3_ENDPOINT);

/** The version-archive bucket — where a late archive PUT orphans an object under an erased owner. */
const ARCHIVE_BUCKET = process.env['S3_BUCKET_VERSIONS'] ?? 'commise-versions';

/** An owner whose erasure COMPLETED recently — the archive prefix that must be reconciled to empty. */
const OWNER_COMPLETED = '01JORPHAN00COMPLETED0OWNER0';

/** An owner whose erasure is still RUNNING — their archives are live and MUST survive the sweep. */
const OWNER_RUNNING = '01JORPHAN0000RUNNING0OWNER0';

/** An owner whose erasure completed LONG ago (outside the look-back window) — must NOT be re-listed. */
const OWNER_STALE = '01JORPHAN000000STALE0OWNER0';

/** A bystander with an object under a DIFFERENT prefix — real prefix scoping must spare it. */
const OWNER_BYSTANDER = '01JORPHAN000BYSTANDER0OWNER';

const ALL_OWNERS = [OWNER_COMPLETED, OWNER_RUNNING, OWNER_STALE, OWNER_BYSTANDER];

/** The single REMOVED recipe id each fixture owner's orphan lives under (CR-002 / U3a per-recipe scoping). */
const ORPHAN_RECIPE = 'r-orphan-00000000000000000000001';

describe.skipIf(!canRun)('erasure-orphan sweep — completed-owner reconciliation (integration)', () => {
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

        await s3.send(new CreateBucketCommand({ Bucket: ARCHIVE_BUCKET })).catch(() => undefined);
    });

    afterEach(async () => {
        await db.execute(sql`DELETE FROM account_erasure_jobs WHERE owner_id IN (${sql.join(ALL_OWNERS, sql`, `)})`);

        // S3 has no owner-scoped DB teardown — clear every removed-recipe prefix this suite may have planted.
        for (const owner of ALL_OWNERS) {
            await eraseRecipeObjects(s3, ARCHIVE_BUCKET, owner, ORPHAN_RECIPE);
        }
    });

    afterAll(async () => {
        s3?.destroy();
        await pool.end();
    });

    /**
     * Insert an erasure job with an explicit status, completion age, and — for a `completed` job — the
     * removed-recipe id set the sweeper reconciles (defaults to the one {@link ORPHAN_RECIPE}).
     */
    async function seedJob(
        ownerId: string,
        status: string,
        updatedMinutesAgo: number,
        removedRecipeIds: string[] = [ORPHAN_RECIPE],
    ): Promise<void> {
        await db.execute(sql`
            INSERT INTO account_erasure_jobs (owner_id, status, removed_recipe_ids, created_at, updated_at)
            VALUES (
                ${ownerId}, ${status}, ${JSON.stringify(removedRecipeIds)}::jsonb,
                now() - ${`${updatedMinutesAgo} minutes`}::interval,
                now() - ${`${updatedMinutesAgo} minutes`}::interval
            )
        `);
    }

    /** Plant one object under an owner's REMOVED-recipe archive prefix — the shape a late archive PUT orphans. */
    async function plantArchiveObject(ownerId: string): Promise<string> {
        const key = `${recipeMediaPrefix(ownerId, ORPHAN_RECIPE)}versions/1.json`;
        await s3.send(new PutObjectCommand({ Bucket: ARCHIVE_BUCKET, Key: key, Body: '{"orphan":true}' }));

        return key;
    }

    async function listPrefix(ownerId: string): Promise<string[]> {
        const listed = await s3.send(
            new ListObjectsV2Command({ Bucket: ARCHIVE_BUCKET, Prefix: ownerMediaPrefix(ownerId) }),
        );

        return (listed.Contents ?? []).flatMap((entry) => (entry.Key ? [entry.Key] : []));
    }

    /** Reconstruct the handler: read the completed owners, then sweep each removed recipe's prefix. */
    async function runSweep(): Promise<number> {
        const owners = await readRecentlyCompletedOwners(db);
        let deleted = 0;

        for (const { ownerId, removedRecipeIds } of owners) {
            for (const recipeId of removedRecipeIds ?? []) {
                deleted += await eraseRecipeObjects(s3, ARCHIVE_BUCKET, ownerId, recipeId);
            }
        }

        return deleted;
    }

    it('deletes an orphan under a recently-completed owner, spares a running owner and a bystander', async () => {
        await seedJob(OWNER_COMPLETED, 'completed', 5); // completed 5 min ago — inside the 24h window
        await seedJob(OWNER_RUNNING, 'running', 5); // still erasing — archives are live
        await plantArchiveObject(OWNER_COMPLETED);
        await plantArchiveObject(OWNER_RUNNING);
        await plantArchiveObject(OWNER_BYSTANDER); // no job at all — never selected

        const deleted = await runSweep();

        // Exactly the completed owner's orphan was deleted.
        expect(deleted).toBe(1);
        expect(await listPrefix(OWNER_COMPLETED)).toEqual([]);
        // The running owner's archives survive — this is the mutation guard: dropping the `completed`
        // filter (or widening it to the erasure sweeper's `queued`/`running`) would delete this live data.
        expect(await listPrefix(OWNER_RUNNING)).toHaveLength(1);
        // Prefix scoping is real: a bystander under a different prefix is untouched.
        expect(await listPrefix(OWNER_BYSTANDER)).toHaveLength(1);
    });

    it('does NOT re-list a completed owner whose completion is older than the look-back window', async () => {
        // 25h ago — just outside the 24h COMPLETED_LOOKBACK. Its prefix was cleaned by the erasure worker
        // long ago; re-scanning it forever would be pure waste, so the window must exclude it.
        await seedJob(OWNER_STALE, 'completed', 25 * 60);
        const survivor = await plantArchiveObject(OWNER_STALE); // (an object that should NOT be swept here)

        const owners = await readRecentlyCompletedOwners(db);

        expect(owners.map((o) => o.ownerId)).not.toContain(OWNER_STALE);
        // Because the sweep never selects it, an object under its prefix is left alone by this run.
        expect(await listPrefix(OWNER_STALE)).toEqual([survivor]);
    });

    it('is an idempotent no-op once the orphan is gone (the common, healthy case)', async () => {
        await seedJob(OWNER_COMPLETED, 'completed', 5);
        await plantArchiveObject(OWNER_COMPLETED);

        expect(await runSweep()).toBe(1); // first sweep deletes the orphan
        expect(await runSweep()).toBe(0); // second sweep finds a clean prefix
        expect(await listPrefix(OWNER_COMPLETED)).toEqual([]);
    });

    it('is a no-op when no owner has completed recently', async () => {
        await seedJob(OWNER_RUNNING, 'running', 5);
        await plantArchiveObject(OWNER_RUNNING);

        expect(await runSweep()).toBe(0);
        expect(await listPrefix(OWNER_RUNNING)).toHaveLength(1);
    });
});
