import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CreateBucketCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import pg from 'pg';

import {
    loadVersionSnapshot,
    ownerErasureRequested,
    pruneArchivedVersion,
    snapshotObjectKey,
} from '../../../src/handlers/version-archive-worker.js';
import { toArchiveMessage } from '../../../src/handlers/archive-sweeper.js';

/**
 * GDPR archive-resurrection guard — against real Postgres + real S3 (LocalStack).
 *
 * The guard's whole job is a raw `SELECT EXISTS (... FROM account_erasure_jobs WHERE owner_id = $1)`
 * against a schema this Lambda has no Drizzle model for, so a unit test can only fake the driver's
 * answer. What it CANNOT prove is the thing most likely to break in production: that the SQL parses
 * against the real table, is genuinely owner-scoped against real rows, and treats every value of the
 * real `erasure_jobs_status_check` enum as "erasure on record". That is what this integration spec owns.
 *
 * It also pins the behavioural contract the guard exists for, end to end on real infrastructure: when an
 * erasure job is on record, the composed worker path writes NO object to S3 and still prunes the version
 * row — which cascades its `recipe_version_pending_archives` outbox row away, so the suppressed message
 * is not re-dispatched forever.
 *
 * Like the sibling drain spec, it drives the exported `db`-taking seams over a local pool because the
 * handler's own `getRecipeDb()` mints an RDS-IAM token no local Postgres can honour. Only the connection
 * differs; the SQL and the schema are real.
 *
 * Runs only with both harnesses up (`DATABASE_URL` + `S3_ENDPOINT`); otherwise skipped in lockstep.
 */

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];
const S3_ENDPOINT = process.env['S3_ENDPOINT'];
const canRun = Boolean(DATABASE_URL) && Boolean(S3_ENDPOINT);

const BUCKET = process.env['S3_BUCKET_VERSIONS'] ?? 'commise-versions';
const ERASED_OWNER = '01JGUARD00ERASED0OWNER00000';
const LIVE_OWNER = '01JGUARD00LIVE000OWNER00000';

const SNAPSHOT = {
    version: 1,
    title: 'Should Not Be Archived',
    description: 'data belonging to an owner under erasure',
    steps: [],
    ingredients: [],
    servings: 2,
    prepTimeMinutes: 5,
    cookTimeMinutes: 10,
};

describe.skipIf(!canRun)('archive-resurrection guard (integration)', () => {
    let pool: pg.Pool;
    let db: NodePgDatabase<Record<string, never>>;
    let s3: S3Client;

    beforeAll(async () => {
        pool = new pg.Pool({ connectionString: DATABASE_URL });
        db = drizzle(pool);
        s3 = new S3Client({
            endpoint: S3_ENDPOINT,
            region: 'us-east-1',
            forcePathStyle: true,
            credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
        });

        await s3.send(new CreateBucketCommand({ Bucket: BUCKET })).catch(() => undefined);
    });

    afterEach(async () => {
        // Each owner's rows are independent per test; clear between so ordering never couples them.
        await db.execute(sql`DELETE FROM recipes WHERE owner_id IN (${ERASED_OWNER}, ${LIVE_OWNER})`);
        await db.execute(sql`DELETE FROM account_erasure_jobs WHERE owner_id IN (${ERASED_OWNER}, ${LIVE_OWNER})`);
    });

    afterAll(async () => {
        await pool.end();
    });

    /** Seed a recipe + a version + its pending-archive outbox row for an owner. */
    async function seedPendingVersion(
        ownerId: string,
        versionNumber: number,
    ): Promise<{ versionId: string; recipeId: string }> {
        const recipe = await db.execute<{ id: string }>(sql`
            INSERT INTO recipes (owner_id, title, ingredient_names_text, visibility, servings,
                                 prep_time_minutes, cook_time_minutes, total_time_minutes)
            VALUES (${ownerId}, 'Guard Host', 'flour', 'private', 1, 5, 10, 15)
            RETURNING id
        `);
        const recipeId = recipe.rows[0]!.id;

        const version = await db.execute<{ id: string }>(sql`
            INSERT INTO recipe_versions (recipe_id, version_number, snapshot, created_by)
            VALUES (${recipeId}, ${versionNumber}, ${JSON.stringify(SNAPSHOT)}::jsonb, ${ownerId})
            RETURNING id
        `);
        const versionId = version.rows[0]!.id;

        await db.execute(sql`
            INSERT INTO recipe_version_pending_archives (recipe_version_id, recipe_id, version_number)
            VALUES (${versionId}, ${recipeId}, ${versionNumber})
        `);

        return { versionId, recipeId };
    }

    async function insertErasureJob(ownerId: string, status: string): Promise<void> {
        await db.execute(sql`
            INSERT INTO account_erasure_jobs (owner_id, status) VALUES (${ownerId}, ${status})
        `);
    }

    async function objectExists(key: string): Promise<boolean> {
        try {
            await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));

            return true;
        } catch {
            return false;
        }
    }

    async function countPending(versionId: string): Promise<number> {
        const result = await db.execute<{ count: number }>(sql`
            SELECT count(*)::int AS count FROM recipe_version_pending_archives WHERE recipe_version_id = ${versionId}
        `);

        return result.rows[0]?.count ?? 0;
    }

    it('reports no erasure for an owner with no job row (the archive proceeds normally)', async () => {
        await seedPendingVersion(LIVE_OWNER, 1);

        expect(await ownerErasureRequested(db, LIVE_OWNER)).toBe(false);
    });

    it.each(['queued', 'running', 'completed', 'failed'])(
        'reports erasure-on-record for a job in %s status (the "any status" decision, against the real enum)',
        async (status) => {
            await insertErasureJob(ERASED_OWNER, status);

            // Every value of the real erasure_jobs_status_check enum must count as "do not archive". A
            // completed-only check would miss `running` — the exact sub-window this guard closes.
            expect(await ownerErasureRequested(db, ERASED_OWNER)).toBe(true);
        },
    );

    it('is owner-scoped: one owner under erasure does not suppress a different live owner', async () => {
        await insertErasureJob(ERASED_OWNER, 'running');

        expect(await ownerErasureRequested(db, ERASED_OWNER)).toBe(true);
        expect(await ownerErasureRequested(db, LIVE_OWNER)).toBe(false);
    });

    it('suppresses the PUT but still prunes the version — cascading the outbox row away', async () => {
        const { versionId, recipeId } = await seedPendingVersion(ERASED_OWNER, 7);
        await insertErasureJob(ERASED_OWNER, 'running');

        // Compose the worker's guarded path over the real seams: load, check, and because an erasure is on
        // record, prune WITHOUT writing to S3.
        const message = toArchiveMessage(
            { id: 'x', recipe_version_id: versionId, recipe_id: recipeId, version_number: 7, created_by: ERASED_OWNER },
            new Date().toISOString(),
        );
        const snapshot = await loadVersionSnapshot(db, message);
        expect(snapshot.snapshot).toMatchObject({ title: 'Should Not Be Archived' });

        const key = snapshotObjectKey(message);
        const suppressed = await ownerErasureRequested(db, ERASED_OWNER);
        expect(suppressed).toBe(true);

        if (suppressed) {
            await pruneArchivedVersion(db, versionId);
        } else {
            // This branch is what the guard exists to prevent; if it ever runs the object would resurrect.
            await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: JSON.stringify(snapshot) }));
        }

        // No object materialised under the erased owner's prefix...
        expect(await objectExists(key)).toBe(false);
        // ...the version row is gone...
        const versions = await db.execute<{ count: number }>(sql`
            SELECT count(*)::int AS count FROM recipe_versions WHERE id = ${versionId}
        `);
        expect(versions.rows[0]?.count).toBe(0);
        // ...and its outbox row went with it via ON DELETE CASCADE, so the sweeper will not re-dispatch it.
        expect(await countPending(versionId)).toBe(0);
    });
});
