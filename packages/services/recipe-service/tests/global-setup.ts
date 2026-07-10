/**
 * T089 — shared vitest global setup for the recipe service's integration + e2e runs.
 *
 * Wired into BOTH `vitest.integration.config.ts` and `vitest.e2e.config.ts`. Runs ONCE per test
 * process, before any spec file, and prepares the external harness (Docker Postgres + LocalStack S3
 * from `docker-compose.test.yml`):
 *
 *   1. Wait for LocalStack's S3 to be reachable, then provision the recipe buckets (idempotent).
 *   2. Reset the test Postgres to a clean `public` schema and apply the ordered hand-authored
 *      migrations (`src/database/migrations/0001..0005_*.sql`) in filename order.
 *   3. Seed a small, deterministic baseline dataset (idempotent via `ON CONFLICT DO NOTHING`) that
 *      later integration/e2e specs can rely on when they don't manage their own fixtures.
 *
 * Idempotent: the whole setup can run repeatedly and always lands the same end state (step 2 drops and
 * recreates `public`; steps 1 and 3 use existence guards). It is a NO-OP when `DATABASE_URL` /
 * `TEST_DATABASE_URL` is unset, so a machine without the harness up simply skips DB work rather than
 * failing (matches the food service's e2e ethos).
 *
 * Only the Node built-ins + `pg` (already a recipe-service dependency) are used — S3 bucket creation
 * goes through LocalStack's path-style REST API with global `fetch`, so no `@aws-sdk/*` dependency is
 * required here.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

import pg from 'pg';

/** The harness Postgres connection string. Unset → the setup skips all DB work. */
const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];

/** LocalStack S3 endpoint. Defaults to the compose-published port. */
const S3_ENDPOINT = process.env['S3_ENDPOINT'] ?? 'http://localhost:4566';

/** The two buckets the recipe service uses (photos + version archives). */
export const SEED_BUCKETS = ['commise-photos', 'commise-versions'] as const;

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../src/database/migrations');

// ── Deterministic baseline seed identifiers (stable across runs) ────────────────────────────────────
// Owner keys are app-user ULIDs (there is no local users table — ownership is the external ULID).
// Exported so integration/e2e specs can reference the seeded rows without re-deriving the ids.

/** The `free`-tier baseline owner (app-user ULID). */
export const SEED_OWNER_FREE = '01J000000000000000000FREE0';

/** The `pro`-tier baseline owner (app-user ULID). */
export const SEED_OWNER_PRO = '01J0000000000000000000PRO0';

/** Stable recipe ids: one public (free owner), one private (pro owner). */
export const SEED_RECIPE_PUBLIC_ID = '00000000-0000-4000-8000-000000000001';
export const SEED_RECIPE_PRIVATE_ID = '00000000-0000-4000-8000-000000000002';

/** Stable collection id (owned by the pro owner) plus its single membership. */
export const SEED_COLLECTION_ID = '00000000-0000-4000-8000-0000000000c1';

/**
 * Stable freeform ingredient ids (catalog rows). Integration/e2e specs attach these to recipes by id;
 * since T043b, recipe create/update validates every line's `ingredientId` against this catalog, so the
 * baseline seed MUST provide the rows the specs reference.
 */
export const SEED_INGREDIENTS = [
    { id: '00000000-0000-4000-8000-0000000000aa', name: 'Flour' },
    { id: '00000000-0000-4000-8000-0000000000bb', name: 'Sugar' },
    { id: '00000000-0000-4000-8000-0000000000cc', name: 'Butter' },
] as const;

/** Poll `predicate` until it resolves truthy or the deadline passes. */
async function waitFor(label: string, timeoutMs: number, predicate: () => Promise<boolean>): Promise<void> {
    const deadline = Date.now() + timeoutMs;

    for (;;) {
        try {
            if (await predicate()) {
                return;
            }
        } catch {
            // Swallow — a not-yet-ready dependency throws (ECONNREFUSED etc.); retry until the deadline.
        }

        if (Date.now() >= deadline) {
            throw new Error(`Timed out after ${timeoutMs}ms waiting for ${label}.`);
        }

        await sleep(500);
    }
}

/**
 * Wait for LocalStack S3 to accept requests, then create both recipe buckets (path-style `PUT`,
 * unsigned — LocalStack does not validate credentials). Bucket creation is idempotent: LocalStack
 * returns 200 for an already-existing bucket on a path-style create.
 *
 * @sideEffect Network calls to the LocalStack S3 endpoint; creates buckets.
 */
async function provisionBuckets(): Promise<void> {
    await waitFor(`LocalStack S3 at ${S3_ENDPOINT}`, 60_000, async () => {
        const response = await fetch(`${S3_ENDPOINT}/_localstack/health`);

        return response.ok;
    });

    for (const bucket of SEED_BUCKETS) {
        const response = await fetch(`${S3_ENDPOINT}/${bucket}`, { method: 'PUT' });

        // 200 = created, 409/BucketAlreadyOwnedByYou = already there — both are success for our purposes.
        if (!response.ok && response.status !== 409) {
            throw new Error(`Failed to create bucket "${bucket}": HTTP ${response.status}`);
        }
    }
}

/**
 * Drop and recreate `public`, then apply every ordered `.sql` migration. The migrations are bare
 * `CREATE TABLE` (not idempotent on their own), so they must run against a clean schema.
 *
 * @sideEffect Destroys all data in `public` and re-applies the source-of-truth DDL.
 */
async function applyMigrations(pool: pg.Pool): Promise<void> {
    const files = readdirSync(migrationsDir)
        .filter((file) => file.endsWith('.sql'))
        .sort();

    await pool.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');

    for (const file of files) {
        await pool.query(readFileSync(join(migrationsDir, file), 'utf-8'));
    }
}

/**
 * Insert the deterministic baseline dataset. Guarded with `ON CONFLICT DO NOTHING` so it is safe even
 * though {@link applyMigrations} already gives a clean slate.
 *
 * @sideEffect Writes baseline rows to the recipe tables.
 */
async function seedBaseline(pool: pg.Pool): Promise<void> {
    // Freeform catalog ingredients the recipe specs attach by id (search_vector populated like the DAL).
    for (const ingredient of SEED_INGREDIENTS) {
        await pool.query(
            `INSERT INTO ingredients (id, name, is_user_entered, search_vector)
             VALUES ($1, $2, true, to_tsvector('english', $2))
             ON CONFLICT (id) DO NOTHING`,
            [ingredient.id, ingredient.name],
        );
    }

    await pool.query(
        `INSERT INTO recipes
             (id, owner_id, title, description, visibility, ingredient_names_text,
              servings, prep_time_minutes, cook_time_minutes, total_time_minutes)
         VALUES
             ($1, $2, 'Baseline Public Recipe', 'Seeded public recipe for integration/e2e fixtures.', 'public', 'flour water salt', 1, 5, 10, 15),
             ($3, $4, 'Baseline Private Recipe', 'Seeded private recipe for integration/e2e fixtures.', 'private', 'eggs butter sugar', 1, 5, 10, 15)
         ON CONFLICT (id) DO NOTHING`,
        [SEED_RECIPE_PUBLIC_ID, SEED_OWNER_FREE, SEED_RECIPE_PRIVATE_ID, SEED_OWNER_PRO],
    );

    await pool.query(
        `INSERT INTO collections (id, owner_id, name, description, visibility)
         VALUES ($1, $2, 'Baseline Collection', 'Seeded collection for integration/e2e fixtures.', 'private')
         ON CONFLICT (id) DO NOTHING`,
        [SEED_COLLECTION_ID, SEED_OWNER_PRO],
    );

    await pool.query(
        `INSERT INTO recipe_collections (collection_id, recipe_id)
         VALUES ($1, $2)
         ON CONFLICT (collection_id, recipe_id) DO NOTHING`,
        [SEED_COLLECTION_ID, SEED_RECIPE_PUBLIC_ID],
    );
}

/**
 * Vitest global setup entry point. Provisions S3 buckets and, when a test database is configured,
 * migrates + seeds it. Safe to run with no harness up (skips DB work).
 *
 * @sideEffect Network + database I/O as described above.
 */
export async function setup(): Promise<void> {
    // `DATABASE_URL` is the master switch for "the harness is expected to be up". When it is unset
    // (e.g. a plain unit `vitest run` that happens to glob a `*.e2e.spec.ts`), skip ALL harness work —
    // including S3 provisioning — so the run does not hang waiting for a LocalStack that isn't there.
    // The specs themselves guard with `describe.skipIf(!hasDatabaseUrl)`, so they skip in lockstep.
    if (!DATABASE_URL) {
        return;
    }

    await provisionBuckets();

    const pool = new pg.Pool({ connectionString: DATABASE_URL });

    try {
        await waitFor(`Postgres at ${DATABASE_URL}`, 60_000, async () => {
            await pool.query('SELECT 1');

            return true;
        });

        await applyMigrations(pool);
        await seedBaseline(pool);
    } finally {
        await pool.end();
    }
}

/**
 * Vitest global teardown. Nothing to dispose — the harness (Docker Postgres + LocalStack) is owned by
 * the CI job / `docker compose`, not by this process, and the setup pool is closed in {@link setup}.
 */
export function teardown(): void {
    // Intentionally empty.
}
