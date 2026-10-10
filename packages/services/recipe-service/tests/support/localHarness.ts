/**
 * The recipe service's LOCAL e2e harness (`docs/CODING_STANDARDS.md` §7.1a), which `tests/e2e/globalSetup.ts` runs
 * ONCE per test process, before any spec file. It prepares the external dependencies (Docker Postgres +
 * LocalStack from `compose.test.yml`):
 *
 *   1. Provision the test Postgres under the production role model (ADR-0039) and migrate it with the
 *      service's OWN runner as `recipe_migrator`, so the tier's schema is built the way a stage's is. With no
 *      `DATABASE_ADMIN_URL` this throws, so a run with no database fails before any suite instead of skipping.
 *   2. Wait for LocalStack's S3 to be reachable, then provision the recipe buckets (idempotent).
 *   3. Provision the SQS queues the erasure, verification and parse suites drive (idempotent).
 *   4. Seed the deterministic dataset via the shared `src/database/seed.ts` module (T096) — the ONE
 *      authoritative "seeded world" (ingredient catalog + recipes + collection), idempotent via
 *      `ON CONFLICT DO NOTHING` — that later specs rely on when they don't manage their own fixtures.
 *
 * Idempotent: the whole setup can run repeatedly and always lands the same end state (step 1 rebuilds
 * `public`; steps 2 to 4 use existence guards).
 *
 * S3 bucket creation goes through LocalStack's path-style REST API with global `fetch` (a bare `PUT` —
 * no SDK needed). The SQS queue does NOT follow suit: `CreateQueue` is an AWS-protocol call, and
 * hand-rolling that over `fetch` would be reinventing the SDK the service already depends on, so
 * `@aws-sdk/client-sqs` (a recipe-service dependency) is used instead.
 */
import { setTimeout as sleep } from 'node:timers/promises';

import { CreateQueueCommand, SQSClient } from '@aws-sdk/client-sqs';
import pg from 'pg';

import { provisionRoleDatabase, roleDatabase, type RoleDatabaseSpec } from '@kitchensink/service-test-harness';

import { seed } from '../../src/database/seed.js';

// Re-exported so the specs that reference the seeded world import it from one place. The authoritative
// definitions live in `src/database/seed.ts` (the T096 seed module this setup now drives); forwarding
// them here keeps a single source of truth while leaving those specs' import paths unchanged.
export { SEED_INGREDIENTS, SEED_OWNER_FREE } from '../../src/database/seed.js';

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
 * Prepare the harness for one database: provision, migrate and seed it, then the S3 buckets and SQS queues.
 *
 * @param spec - The database to build.
 *
 * @sideEffect Network + database I/O as described above.
 */
export async function prepareHarness(spec: RoleDatabaseSpec): Promise<void> {
    // The production role model + the service's OWN runner, as `recipe_migrator` (ADR-0039). First, because it
    // is what refuses a run with no `DATABASE_ADMIN_URL`. The seed then runs as `recipe_app`: DML is all a seed
    // has ever needed, and running it as the subject proves that.
    await provisionRoleDatabase(spec);
    await provisionBuckets();
    // After provisionBuckets, which is what waits for LocalStack to come up.
    await provisionQueues();

    const pool = new pg.Pool({ connectionString: roleDatabase(spec).appUrl });

    try {
        await waitFor(`Postgres at ${spec.database}`, 60_000, async () => {
            await pool.query('SELECT 1');

            return true;
        });

        await seed(pool);
    } finally {
        await pool.end();
    }
}
