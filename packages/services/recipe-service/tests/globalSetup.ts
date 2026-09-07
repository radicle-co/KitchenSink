/**
 * T089 — shared vitest global setup for the recipe service's integration + e2e runs.
 *
 * Wired into BOTH `vitest.integration.config.ts` and `vitest.e2e.config.ts`. Runs ONCE per test
 * process, before any spec file, and prepares the external harness (Docker Postgres + LocalStack S3
 * from `docker-compose.test.yml`):
 *
 *   1. Wait for LocalStack's S3 to be reachable, then provision the recipe buckets (idempotent).
 *   2. Provision the `account-erasure` SQS queue the T137 erasure suite drives (idempotent).
 *   3. Reset the test Postgres to a clean `public` schema and apply the ordered hand-authored
 *      migrations (`src/database/migrations/0001..0005_*.sql`) in filename order.
 *   4. Seed the deterministic dataset via the shared `src/database/seed.ts` module (T096) — the ONE
 *      authoritative "seeded world" (ingredient catalog + recipes + collection), idempotent via
 *      `ON CONFLICT DO NOTHING` — that later integration/e2e specs rely on when they don't manage their
 *      own fixtures. The load-bearing part is the ingredient catalog: since T043b, recipe create/update
 *      validates every line's `ingredientId` against it.
 *
 * Idempotent: the whole setup can run repeatedly and always lands the same end state (step 3 drops and
 * recreates `public`; steps 1, 2 and 4 use existence guards). It is a NO-OP when `DATABASE_URL` /
 * `TEST_DATABASE_URL` is unset, so a machine without the harness up simply skips DB work rather than
 * failing (matches the food service's e2e ethos).
 *
 * S3 bucket creation goes through LocalStack's path-style REST API with global `fetch` (a bare `PUT` —
 * no SDK needed). The SQS queue does NOT follow suit: `CreateQueue` is an AWS-protocol call, and
 * hand-rolling that over `fetch` would be reinventing the SDK the service already depends on, so
 * `@aws-sdk/client-sqs` (a recipe-service dependency) is used instead.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

import { CreateQueueCommand, SQSClient } from '@aws-sdk/client-sqs';
import pg from 'pg';

import { seed } from '../src/database/seed.js';

// Re-exported so the specs that reference the seeded world import it from one place. The authoritative
// definitions live in `src/database/seed.ts` (the T096 seed module this setup now drives); forwarding
// them here keeps a single source of truth while leaving those specs' import paths unchanged.
export { SEED_INGREDIENTS, SEED_OWNER_FREE } from '../src/database/seed.js';

/** The harness Postgres connection string. Unset → the setup skips all DB work. */
const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];

/** LocalStack S3 endpoint. Defaults to the compose-published port. */
const S3_ENDPOINT = process.env['S3_ENDPOINT'] ?? 'http://localhost:4566';

/** LocalStack SQS endpoint. Same LocalStack, so it falls back to the S3 endpoint before the default. */
const SQS_ENDPOINT = process.env['SQS_ENDPOINT'] ?? process.env['S3_ENDPOINT'] ?? 'http://localhost:4566';

/** The two buckets the recipe service uses (photos + version archives). */
export const SEED_BUCKETS = ['commise-photos', 'commise-versions'] as const;

/** The account-erasure queue's name (`AccountModule` reads its URL from `ACCOUNT_ERASURE_QUEUE_URL`). */
export const SEED_ERASURE_QUEUE_NAME = 'account-erasure';

/**
 * The ingredient-verification queue's name (plan U11 / ADR-0024).
 *
 * `RecipesModule` reads its URL from `INGREDIENT_VERIFICATION_QUEUE_URL`, which
 * `ingredientVerificationConfigSchema` makes REQUIRED — so without this queue the app under test does not
 * boot at all, and every integration spec in the package fails rather than only the verification one.
 */
export const SEED_VERIFICATION_QUEUE_NAME = 'recipe-verification';

/**
 * The parse-line queue's name (plan U9).
 *
 * `RecipesModule` reads its URL from `RECIPE_PARSE_QUEUE_URL`, which `parseJobConfigSchema` makes
 * REQUIRED for the same reason the verification queue's is — so this queue, too, is a boot precondition
 * of the app under test.
 */
export const SEED_PARSE_QUEUE_NAME = 'recipe-parse-line';

/**
 * LocalStack's fixed default AWS account id. Not a secret and not configurable — it is the constant
 * LocalStack namespaces every queue URL under.
 */
const LOCALSTACK_ACCOUNT_ID = '000000000000';

/**
 * The `account-erasure` queue URL the booted app and the specs both address.
 *
 * Deliberately PATH-STYLE (`{endpoint}/{account}/{name}`) rather than the URL `CreateQueue` returns
 * (`http://sqs.us-east-1.localhost.localstack.cloud:4566/...`). LocalStack accepts either — it resolves a
 * queue from the URL's path — but the returned form depends on `localhost.localstack.cloud` resolving,
 * which is a DNS dependency the harness gains nothing from taking on. Verified against LocalStack 3:
 * `SendMessage`/`ReceiveMessage` against this path-style URL work.
 *
 * Exported as the ONE definition of the queue's address: `tests/e2e/harness.ts` defaults
 * `ACCOUNT_ERASURE_QUEUE_URL` to it, and the erasure spec drains it, so the app under test and the spec
 * asserting on it can never address different queues.
 */
export const SEED_ERASURE_QUEUE_URL = `${SQS_ENDPOINT}/${LOCALSTACK_ACCOUNT_ID}/${SEED_ERASURE_QUEUE_NAME}`;

/**
 * The `recipe-verification` queue URL the booted app and the specs both address.
 *
 * Path-style for the same reason {@link SEED_ERASURE_QUEUE_URL} is, and exported as the ONE definition of
 * this queue's address so the app under test and the spec draining it cannot address different queues.
 */
export const SEED_VERIFICATION_QUEUE_URL = `${SQS_ENDPOINT}/${LOCALSTACK_ACCOUNT_ID}/${SEED_VERIFICATION_QUEUE_NAME}`;

/**
 * The `recipe-parse-line` queue URL the booted app and the specs both address (plan U9). Path-style and
 * single-sourced for the same reasons as its two siblings above.
 */
export const SEED_PARSE_QUEUE_URL = `${SQS_ENDPOINT}/${LOCALSTACK_ACCOUNT_ID}/${SEED_PARSE_QUEUE_NAME}`;

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../src/database/migrations');

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
 * Create the SQS queues the app under test enqueues onto. Idempotent: `CreateQueue` on an existing queue with identical
 * attributes is a no-op that returns the same URL (verified against LocalStack 3).
 *
 * Static `test` credentials mirror `createSqsErasureQueue`'s LocalStack branch, so the harness is
 * self-contained rather than depending on ambient host/CI AWS config.
 *
 * @sideEffect Network call to LocalStack; creates the queue.
 */
async function provisionQueues(): Promise<void> {
    const sqs = new SQSClient({
        endpoint: SQS_ENDPOINT,
        region: process.env['AWS_REGION'] ?? 'us-east-1',
        credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    });

    try {
        for (const name of [SEED_ERASURE_QUEUE_NAME, SEED_VERIFICATION_QUEUE_NAME, SEED_PARSE_QUEUE_NAME]) {
            await sqs.send(new CreateQueueCommand({ QueueName: name }));
        }
    } finally {
        sqs.destroy();
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
 * Vitest global setup entry point. Provisions S3 buckets and, when a test database is configured,
 * migrates + seeds it. Safe to run with no harness up (skips DB work).
 *
 * @sideEffect Network + database I/O as described above.
 */
export async function setup(): Promise<void> {
    // `DATABASE_URL` is the master switch for "the harness is expected to be up". When it is unset
    // (e.g. a plain unit `vitest run` that happens to glob a `*.e2e.test.ts`), skip ALL harness work —
    // including S3 provisioning — so the run does not hang waiting for a LocalStack that isn't there.
    // The specs themselves guard with `describe.skipIf(!hasDatabaseUrl)`, so they skip in lockstep.
    if (!DATABASE_URL) {
        return;
    }

    await provisionBuckets();
    // After provisionBuckets, which is what waits for LocalStack to come up.
    await provisionQueues();

    const pool = new pg.Pool({ connectionString: DATABASE_URL });

    try {
        await waitFor(`Postgres at ${DATABASE_URL}`, 60_000, async () => {
            await pool.query('SELECT 1');

            return true;
        });

        await applyMigrations(pool);
        await seed(pool);
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
