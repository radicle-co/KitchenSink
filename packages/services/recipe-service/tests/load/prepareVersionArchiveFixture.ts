/**
 * Fixture prep for `versionArchiveRead.load.js` (W8-a.7).
 *
 * k6 scripts run inside the k6 binary's own JS runtime and can only import k6's built-in modules (see
 * `lib/common.js`'s docstring) — no `pg`, no `@aws-sdk/client-s3`. Seeding a recipe whose version 1 lives
 * ONLY in the S3 archive (never in `recipe_versions`) therefore has to happen OUTSIDE k6, the same way
 * `prepare-db.mjs` applies migrations + seeds the ingredient catalog before a k6 run.
 *
 * Mirrors `tests/e2e/versionArchiveFallback.e2e.test.ts`'s fixture, but SQL-only and idempotent (fixed
 * ids, `ON CONFLICT (id) DO NOTHING`) rather than create-via-API-then-delete: it inserts the `recipes`
 * row directly at `current_version = 1` and deliberately writes NO `recipe_versions` row for it — the
 * "evicted past the DB retention window" state the async version-archive worker would otherwise produce
 * — then PUTs the immutable snapshot to the S3 archive bucket at the shared `recipeVersionArchiveKey`
 * (the SAME key `versions.service.ts`'s S3 fallback reads, so this can never drift from the read side).
 *
 * `versionArchiveRead.load.js` addresses this fixture via the FIXED `ARCHIVE_FIXTURE_RECIPE_ID`
 * exported from `lib/common.js` (kept in sync with {@link ARCHIVE_FIXTURE_RECIPE_ID} below) — no id needs
 * threading through an env var between this script and the k6 run.
 *
 * Usage: `DATABASE_URL=postgres://... npx tsx tests/load/prepareVersionArchiveFixture.ts`
 * (`S3_ENDPOINT` / `S3_BUCKET_VERSIONS` / `S3_FORCE_PATH_STYLE` default to the LocalStack values the CI
 * load-test job's service container uses.)
 *
 * @sideEffect Connects to PostgreSQL and S3/LocalStack; inserts a row, deletes a row, and PUTs an object.
 */
import pg from 'pg';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

import { recipeVersionArchiveKey } from '@kitchensink/recipe-core';

const { Pool } = pg;

/**
 * Fixed owner + recipe id, so re-running this script is a no-op (mirrors `seed.ts`'s fixed-id idiom).
 * MUST match `lib/common.js`'s `ARCHIVE_FIXTURE_RECIPE_ID` — the k6 script reads this exact recipe.
 */
export const ARCHIVE_FIXTURE_OWNER = '01JLOADARCHIVE00000OWNER0A';
export const ARCHIVE_FIXTURE_RECIPE_ID = '00000000-0000-4000-8000-0000000000f1';
const ARCHIVED_VERSION_ID = '00000000-0000-4000-8000-0000000000f2';
const ARCHIVED_TITLE = 'Load Test Archived Version';

/**
 * Seed the archive-fallback fixture idempotently against a pool + S3 client.
 *
 * @sideEffect Executes INSERT/DELETE against `pool` and a PutObjectCommand against `s3`.
 */
export async function prepareArchiveFixture(pool: pg.Pool, s3: S3Client, bucket: string): Promise<string> {
    // 1) The recipe row, at current_version 1, PUBLIC so any load-test caller (dev-bypass user or a real
    //    Bearer token) is read-authorized to fetch it.
    await pool.query(
        `INSERT INTO recipes (id, owner_id, title, description, prep_time_minutes, cook_time_minutes,
             total_time_minutes, servings, visibility, current_version)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'public',1)
         ON CONFLICT (id) DO NOTHING`,
        [
            ARCHIVE_FIXTURE_RECIPE_ID,
            ARCHIVE_FIXTURE_OWNER,
            ARCHIVED_TITLE,
            'Seeded for the k6 version-archive-read load test.',
            5,
            10,
            15,
            2,
        ],
    );

    // 2) Deliberately NO `recipe_versions` row for version 1 — "evicted past the DB retention window" IS
    //    the absence of the row, so every GET is forced down the S3-fallback branch.
    await pool.query('DELETE FROM recipe_versions WHERE recipe_id = $1 AND version_number = 1', [
        ARCHIVE_FIXTURE_RECIPE_ID,
    ]);

    // 3) PUT the immutable snapshot at the shared `recipeVersionArchiveKey` — the same key
    //    `versions.service.ts`'s S3 fallback reads.
    const archivedVersion = {
        id: ARCHIVED_VERSION_ID,
        recipeId: ARCHIVE_FIXTURE_RECIPE_ID,
        versionNumber: 1,
        snapshot: {
            version: 1,
            title: ARCHIVED_TITLE,
            description: 'Seeded for the k6 version-archive-read load test.',
            steps: [{ stepNumber: 1, instruction: 'Mix the load-test ingredients.' }],
            ingredients: [],
            servings: 2,
            prepTimeMinutes: 5,
            cookTimeMinutes: 10,
        },
        createdBy: ARCHIVE_FIXTURE_OWNER,
        createdAt: new Date().toISOString(),
    };
    const key = recipeVersionArchiveKey({
        ownerId: ARCHIVE_FIXTURE_OWNER,
        recipeId: ARCHIVE_FIXTURE_RECIPE_ID,
        versionNumber: 1,
    });

    await s3.send(
        new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            ContentType: 'application/json',
            Body: JSON.stringify(archivedVersion),
        }),
    );

    return key;
}

/**
 * CLI entrypoint (`npx tsx tests/load/prepareVersionArchiveFixture.ts`). Reads `DATABASE_URL` +
 * `S3_*`, seeds, logs a summary, exits non-zero on error.
 *
 * @sideEffect Connects to PostgreSQL and S3/LocalStack.
 */
export async function main(): Promise<void> {
    const databaseUrl = process.env['DATABASE_URL'];

    if (!databaseUrl) {
        throw new Error('prepare-version-archive-fixture: DATABASE_URL is required.');
    }

    const bucket = process.env['S3_BUCKET_VERSIONS'] ?? 'commise-versions';
    const endpoint = process.env['S3_ENDPOINT'] ?? 'http://localhost:4566';
    const forcePathStyle = (process.env['S3_FORCE_PATH_STYLE'] ?? 'true') !== 'false';

    const pool = new Pool({ connectionString: databaseUrl });
    const s3 = new S3Client({
        region: 'us-east-1',
        endpoint,
        forcePathStyle,
        credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    });

    try {
        const key = await prepareArchiveFixture(pool, s3, bucket);
        console.log(
            `prepare-version-archive-fixture: recipe ${ARCHIVE_FIXTURE_RECIPE_ID} ready — version 1 archived ` +
                `at s3://${bucket}/${key}, absent from recipe_versions.`,
        );
    } finally {
        await pool.end();
        s3.destroy();
    }
}

// Run when invoked directly (npx tsx tests/load/prepareVersionArchiveFixture.ts), not when imported.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
    main().catch((err: unknown) => {
        console.error(err);
        process.exitCode = 1;
    });
}
