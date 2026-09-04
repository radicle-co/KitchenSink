import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CreateBucketCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import pg from 'pg';

import {
    loadVersionSnapshot,
    pruneArchivedVersion,
    snapshotObjectKey,
} from '../../../src/handlers/versionArchiveWorker.js';
import {
    claimPendingArchives,
    countBacklog,
    oldestPendingArchiveAgeSeconds,
    toArchiveMessage,
} from '../../../src/handlers/archiveSweeper.js';
import { disposableDatabaseUrl } from '../disposableDatabaseUrl.js';

/**
 * T133 — the async version-archive path, against real Postgres + real S3 (LocalStack).
 *
 * Proves the FR-007b-i drain end to end — enqueue → claim → archive → prune → outbox cleared — with the
 * pieces the unit suites necessarily fake: the actual SQL against the real schema, real S3 semantics,
 * and above all the `ON DELETE CASCADE` that makes *"pending-archive records MUST only be deleted after
 * a successful S3 confirmation"* a property of the database rather than a rule someone must remember.
 *
 * The handlers' own `getRecipeDb()` mints an RDS-IAM auth token, which no local Postgres can honour, so
 * these drive the exported `db`-taking seams (`claimPendingArchives`, `loadVersionSnapshot`,
 * `pruneArchivedVersion`) over a local pool. That is the real SQL on the real schema — only the
 * connection differs.
 *
 * Runs only with both harnesses up (`DATABASE_URL` + `S3_ENDPOINT`); otherwise skipped in lockstep.
 */

const DATABASE_URL = disposableDatabaseUrl();
const S3_ENDPOINT = process.env['S3_ENDPOINT'];
const canRun = Boolean(DATABASE_URL) && Boolean(S3_ENDPOINT);

const BUCKET = process.env['S3_BUCKET_VERSIONS'] ?? 'commise-versions';
const OWNER = '01JARCHIVE0OWNER000000000A';

const SNAPSHOT = {
    version: 1,
    title: 'Archived Soup',
    description: 'the body that must survive',
    steps: [],
    ingredients: [],
    servings: 2,
    prepTimeMinutes: 5,
    cookTimeMinutes: 10,
};

describe.skipIf(!canRun)('version-archive drain (T133 integration)', () => {
    let pool: pg.Pool;
    let db: NodePgDatabase<Record<string, never>>;
    let s3: S3Client;
    let recipeId: string;

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

        const recipe = await db.execute<{ id: string }>(sql`
            INSERT INTO recipes (owner_id, title, ingredient_names_text, visibility, servings,
                                 prep_time_minutes, cook_time_minutes, total_time_minutes)
            VALUES (${OWNER}, 'Archive Host', 'flour', 'private', 1, 5, 10, 15)
            RETURNING id
        `);
        recipeId = recipe.rows[0]!.id;
    });

    afterAll(async () => {
        await db.execute(sql`DELETE FROM recipes WHERE owner_id = ${OWNER}`);
        await pool.end();
    });

    /** Seed a version + its outbox row, exactly as recipe-service's enforceRetention would. */
    async function seedPendingVersion(versionNumber: number): Promise<{ versionId: string }> {
        const version = await db.execute<{ id: string }>(sql`
            INSERT INTO recipe_versions (recipe_id, version_number, snapshot, created_by)
            VALUES (${recipeId}, ${versionNumber}, ${JSON.stringify(SNAPSHOT)}::jsonb, ${OWNER})
            RETURNING id
        `);
        const versionId = version.rows[0]!.id;

        await db.execute(sql`
            INSERT INTO recipe_version_pending_archives (recipe_version_id, recipe_id, version_number)
            VALUES (${versionId}, ${recipeId}, ${versionNumber})
        `);

        return { versionId };
    }

    async function pendingCountFor(versionId: string): Promise<number> {
        const result = await db.execute<{ count: number }>(sql`
            SELECT count(*)::int AS count FROM recipe_version_pending_archives
            WHERE recipe_version_id = ${versionId}
        `);

        return result.rows[0]?.count ?? 0;
    }

    it('drains enqueue → claim → archive → prune, leaving the object in S3 and the outbox clear', async () => {
        const { versionId } = await seedPendingVersion(101);

        // 1. The sweeper claims it and builds the worker's message.
        const claimed = await claimPendingArchives(db);
        const row = claimed.find((candidate) => candidate.recipe_version_id === versionId);
        expect(row, 'the fresh outbox row must be claimable').toBeDefined();
        // created_by comes from the JOIN — the message's ownerId, and therefore the key's prefix.
        expect(row?.created_by).toBe(OWNER);

        const message = toArchiveMessage(row!, new Date().toISOString());

        // 2. The worker loads the real row and archives the real body.
        const snapshot = await loadVersionSnapshot(db, message);
        expect(snapshot.snapshot).toMatchObject({ title: 'Archived Soup' });

        const key = snapshotObjectKey(message);
        await s3.send(
            new PutObjectCommand({
                Bucket: BUCKET,
                Key: key,
                ContentType: 'application/json',
                Body: JSON.stringify(snapshot),
            }),
        );

        // 3. Only now: prune.
        await pruneArchivedVersion(db, versionId);

        // The object is really in S3, at the canonical ARCH-BE-3 key, with the snapshot intact.
        const fetched = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
        const body = JSON.parse(await fetched.Body!.transformToString()) as { snapshot: { title: string } };
        expect(key).toBe(`recipes/${OWNER}/${recipeId}/versions/101.json`);
        expect(body.snapshot.title).toBe('Archived Soup');

        // The version is pruned...
        const versions = await db.execute<{ count: number }>(sql`
            SELECT count(*)::int AS count FROM recipe_versions WHERE id = ${versionId}
        `);
        expect(versions.rows[0]?.count).toBe(0);

        // ...and its outbox row went with it. THIS is the FR-007b-i guarantee, and it holds because the
        // FK cascades — not because any code remembered to delete it.
        expect(await pendingCountFor(versionId)).toBe(0);
    });

    it('keeps the outbox row when the archive never happens — the debt survives', async () => {
        const { versionId } = await seedPendingVersion(102);

        // No S3 write, no prune: the worker threw, or never ran. Both the payload and the record of the
        // debt must still be here, or the snapshot is lost with nothing to replay.
        expect(await pendingCountFor(versionId)).toBe(1);

        const stillThere = await db.execute<{ count: number }>(sql`
            SELECT count(*)::int AS count FROM recipe_versions WHERE id = ${versionId}
        `);
        expect(stillThere.rows[0]?.count).toBe(1);

        // And it is still claimable, so the next sweep re-dispatches it.
        const claimed = await claimPendingArchives(db);
        expect(claimed.some((row) => row.recipe_version_id === versionId)).toBe(true);
    });

    it('counts the real backlog, unbounded by the sweep batch (the T138 alarm depends on it)', async () => {
        const backlog = await countBacklog(db);

        // Both seeded rows above are outstanding (102 was never archived; 101 was pruned).
        expect(backlog).toBeGreaterThanOrEqual(1);
        expect(typeof backlog).toBe('number');
    });

    it('ages the oldest un-archived row off created_at against the real schema (the FR-007b-i age alarm)', async () => {
        // Proves the age SQL — EXTRACT(EPOCH FROM (now() - created_at)), MAX, COALESCE, ::int — is valid
        // against the real Postgres schema, not just a mock. Row 102 is still outstanding from the test
        // above; its created_at is seconds ago, so the age is a small non-negative integer, never null.
        const age = await oldestPendingArchiveAgeSeconds(db);

        expect(typeof age).toBe('number');
        expect(Number.isInteger(age)).toBe(true);
        expect(age).toBeGreaterThanOrEqual(0);
        // A row seeded within this run cannot be older than the whole suite; a wide bound keeps the
        // assertion meaningful (it would catch a units bug — ms vs s — or a wrong column) without flaking.
        expect(age).toBeLessThan(3600);
    });

    it('reports age 0 (never null) once the outbox is fully drained', async () => {
        // COALESCE(..., 0) is the load-bearing clause: an empty table must yield 0, not NULL, or the alarm
        // flaps into INSUFFICIENT_DATA the moment the backlog clears. Drain every outstanding row for this
        // host recipe, then assert 0 — scoped to this suite's owner so it cannot race a parallel writer
        // (the integration config runs files serially, and rows are owner-scoped to OWNER).
        await db.execute(sql`
            DELETE FROM recipe_version_pending_archives
            WHERE recipe_id = ${recipeId}
        `);

        expect(await oldestPendingArchiveAgeSeconds(db)).toBe(0);
    });
});
