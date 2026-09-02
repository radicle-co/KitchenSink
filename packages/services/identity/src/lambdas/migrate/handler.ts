/**
 * In-VPC schema migration runner for the identity database.
 *
 * ## Why this lives in `packages/services/identity` and not in `identity-webhooks`
 *
 * It used to be `identity-webhooks/src/handlers/migrate.ts`, and the SQL it applies has always been owned
 * here. That split cost the identity service the one ordering guarantee that matters: `cdk deploy` returns
 * only once ECS has STABILISED, so "deploy, then invoke the runner" puts the new image in front of live
 * traffic for the whole stabilisation window with the OLD schema underneath it. For identity that window
 * is not a degraded read — `AuthMiddleware` read-through-creates the user row on EVERY authenticated
 * request, so a column this release expects and the database lacks is a failed sign-in, cached at the edge.
 *
 * Closing the window needs the runner and the ECS service in ONE CloudFormation stack, so an
 * `aws-cdk-lib/triggers` `Trigger` can sit between the Lambda's code update and the service's rollout.
 * `WebhooksStack` is a different CDK app that deploys AFTER `IdentityServiceStack` (it imports that
 * stack's log-group export), so there was no cross-app edge to express. The runner therefore moved to the
 * stack that owns the service it protects; the `.sql` files did not move at all.
 *
 * ## Contract
 *
 * Migrations are plain ordered `.sql` (not drizzle-kit's journal), discovered from the directory rather
 * than a hardcoded list. `src/database/migrations` stays the SINGLE source of truth: `esbuild.mjs` copies
 * it beside the bundle at BUILD time and the handler reads it at runtime — a build-time file copy, never a
 * module import. Each migration runs once, tracked in `schema_migrations`, so re-invoking is a no-op and
 * the destructive reset in `0005` never re-runs.
 *
 * Every failure here THROWS. Nothing catches these: a thrown error surfaces as a Lambda `FunctionError`,
 * which the triggers framework turns into a failed deploy (and which the pipeline's idempotent safety-net
 * invocation also fails on). A migration runner that resolves successfully having applied nothing is
 * indistinguishable, to both callers, from one that had nothing to do — which is the exact silent no-op
 * the in-deploy trigger exists to remove.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { getTableName, is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import pg from 'pg';
import { z } from 'zod';

import * as schema from '@kitchensink/identity-db';

const { Pool } = pg;

/** A discovered migration: its tracking `name` (filename without `.sql`) and the `.sql` filename. */
export interface DiscoveredMigration {
    /** The `schema_migrations` tracking key (filename without the `.sql` suffix). */
    readonly name: string;
    /** The `.sql` filename within the migrations directory. */
    readonly file: string;
}

/** The structured result of a migration run (returned to the trigger / the deploy-time `lambda invoke`). */
export interface MigrateResult {
    /** Migrations applied this run, in order. */
    readonly applied: string[];
    /** Migrations skipped because already recorded, in order. */
    readonly skipped: string[];
    /** Post-run validation counts. */
    readonly validated: { readonly migrations: number; readonly tables: number };
}

/** Options for {@link runMigrations} — the injectable core (a pool + a migrations directory). */
export interface RunMigrationsOptions {
    /** A connected `pg` pool to the target database. */
    readonly pool: pg.Pool;
    /** The directory holding the ordered `.sql` migrations. */
    readonly migrationsDir: string;
}

/**
 * The bundled migrations directory at runtime. esbuild copies `src/database/migrations/*.sql` into
 * `dist-lambda/migrations/`; the handler bundles to `dist-lambda/lambdas/migrate/handler.js`, so the SQL
 * sits two directories up. See `esbuild.mjs`.
 *
 * @returns The absolute path to the bundled migrations directory.
 */
const bundledMigrationsDir = (): string => join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');

/**
 * Discover the ordered `.sql` migrations in a directory — sorted by filename so the numeric prefix
 * (`0004`, `0005`, …) drives a deterministic order. NO hardcoded list: drop a `.sql` file in and it is
 * picked up automatically.
 *
 * @param migrationsDir - The directory to scan.
 * @returns The discovered migrations in apply order.
 * @sideEffect Reads the migrations directory.
 */
export function discoverMigrations(migrationsDir: string): DiscoveredMigration[] {
    return readdirSync(migrationsDir)
        .filter((file) => file.endsWith('.sql'))
        .sort()
        .map((file) => ({ name: file.replace(/\.sql$/, ''), file }));
}

/**
 * The tables every successful migration run must produce — derived from the Drizzle schema (every
 * `pgTable` `@kitchensink/identity-db` exports), never hardcoded, so the post-migration validation tracks
 * the schema as it evolves.
 *
 * @returns The expected table names.
 */
function expectedTables(): string[] {
    return (Object.values(schema) as unknown[])
        .filter((value): value is PgTable => is(value, PgTable))
        .map((table) => getTableName(table));
}

/**
 * The session advisory-lock key this database's migration runs serialize on.
 *
 * ⛔ WHY THIS EXISTS. Idempotency comes from `schema_migrations`, and that ledger is CHECKED-then-APPLIED,
 * which is not atomic: two runners starting together both read "unapplied" and both execute the file. The
 * loser then fails on a `CREATE TABLE`/`CREATE EXTENSION` the winner just committed, and — because the
 * runner's throw is a Lambda `FunctionError` the ADR-0022 Trigger rethrows — that failure is a RED DEPLOY,
 * not a retry. ADR-0022 recorded it as an accepted residual risk on the grounds that "nothing in the
 * pipelines runs two concurrently"; the owner's rule that migrations run on EVERY deploy makes concurrent
 * invocations likelier, and the race reproduces on the first attempt (demonstrated in recipe-service's
 * `__tests__/integration/database/migrationRunner.integration.test.ts`).
 *
 * ⚠️ It changes deploy behaviour: a second runner now WAITS instead of racing.
 *
 * Advisory locks are scoped to the DATABASE, so this constant only has to agree with other runners of the
 * IDENTITY schema. It deliberately does not have to match food's or recipe's.
 *
 * The value is an arbitrary fixed 64-bit constant; the digits carry no meaning beyond being stable.
 */
const MIGRATION_ADVISORY_LOCK_KEY = '7412200228220022';

/**
 * How long a runner waits for the lock before failing with a Postgres lock error.
 *
 * Sized under the runner's own Lambda timeout on purpose: without it, a runner blocked behind a stuck peer
 * would be killed by Lambda with no diagnostic at all.
 */
const MIGRATION_LOCK_TIMEOUT_MS = 240_000;

/**
 * Apply the ordered migrations idempotently against a pool, then validate the result. The testable core
 * of {@link handler} (the handler only resolves credentials and builds the pool).
 *
 * Serialized on {@link MIGRATION_ADVISORY_LOCK_KEY} for the whole apply loop, so the ledger's
 * check-then-apply cannot interleave with another runner's.
 *
 * @param options - The connected pool + the migrations directory.
 * @returns The applied/skipped lists + validation counts.
 * @throws {Error} when the migration lock cannot be acquired, a migration's SQL fails, a discovered
 *   migration is not recorded, or an expected table is missing after the run.
 * @sideEffect Connects to PostgreSQL, takes a session advisory lock, and executes DDL.
 */
export async function runMigrations(options: RunMigrationsOptions): Promise<MigrateResult> {
    const { pool, migrationsDir } = options;
    const migrations = discoverMigrations(migrationsDir);
    const applied: string[] = [];
    const skipped: string[] = [];
    const client = await pool.connect();
    let holdsLock = false;

    try {
        // ⛔ BEFORE the ledger is even created, so two runners cannot both create it and both read it empty.
        // `lock_timeout` is RESET immediately after: it is a session setting and this client goes back to a
        // pool, so leaving it set would silently shorten every later statement's lock wait.
        await client.query(`SET lock_timeout = ${MIGRATION_LOCK_TIMEOUT_MS}`);

        try {
            await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_ADVISORY_LOCK_KEY]);
            holdsLock = true;
        } finally {
            await client.query('RESET lock_timeout');
        }

        await client.query(
            'CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())',
        );

        for (const migration of migrations) {
            const existing = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [migration.name]);

            if ((existing.rowCount ?? 0) > 0) {
                skipped.push(migration.name);
                continue;
            }

            const sql = readFileSync(join(migrationsDir, migration.file), 'utf8');
            await client.query('BEGIN');

            try {
                await client.query(sql);
                await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [migration.name]);
                await client.query('COMMIT');
                applied.push(migration.name);
            } catch (err) {
                // ROLLBACK before rethrowing: the migration's own DDL must not survive, and its name must
                // stay UNRECORDED so the next run retries it rather than skipping a half-applied change.
                await client.query('ROLLBACK');
                throw new Error(`Migration ${migration.name} failed`, { cause: err });
            }
        }

        // Post-migration validation. Throwing surfaces as a Lambda FunctionError → the trigger fails, so the
        // ECS service never rolls out against a partially-applied or drifted schema. Both sides are derived
        // (migration files + drizzle schema), so nothing here is hardcoded.
        const recorded = await client.query<{ name: string }>('SELECT name FROM schema_migrations');
        const recordedNames = new Set(recorded.rows.map((row) => row.name));
        const missingMigrations = migrations
            .map((migration) => migration.name)
            .filter((name) => !recordedNames.has(name));

        if (missingMigrations.length > 0) {
            throw new Error(
                `Post-migration validation failed — migrations not recorded: ${missingMigrations.join(', ')}`,
            );
        }

        const tables = expectedTables();
        const present = await client.query<{ table_name: string }>(
            "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1::text[])",
            [tables],
        );
        const presentTables = new Set(present.rows.map((row) => row.table_name));
        const missingTables = tables.filter((table) => !presentTables.has(table));

        if (missingTables.length > 0) {
            throw new Error(`Post-migration validation failed — tables missing: ${missingTables.join(', ')}`);
        }

        return { applied, skipped, validated: { migrations: migrations.length, tables: tables.length } };
    } finally {
        // ⛔ Released EXPLICITLY, not left to the connection dying. A session advisory lock outlives the
        // statement that took it, and `client.release()` returns the session to the pool still holding it —
        // which would deadlock the very next runner on a pool that outlives one call.
        if (holdsLock) {
            await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_ADVISORY_LOCK_KEY]);
        }

        client.release();
    }
}

/**
 * The runner's environment. `DB_SECRET_ARN` is the only hard requirement — the rest of the connection
 * comes out of that secret. `STAGE` selects the TLS posture and defaults to the same value the webhooks
 * config schema used, so a stage that never set it behaves exactly as it did before the move.
 */
const MigrateEnvSchema = z.object({
    DB_SECRET_ARN: z.string().min(1),
    STAGE: z.string().min(1).default('dev'),
});

/**
 * The RDS-managed credential payload. Parsed rather than trusted: an absent `dbname` used to surface as a
 * connection to the `postgres` maintenance database, and a non-numeric `port` as `Number(x) → NaN`, which
 * pg reports far from its cause. Either would fail the deploy — but only after a confusing detour.
 *
 * AWS writes the database under `dbname`; a hand-authored secret may spell it `database`. Both are
 * accepted, exactly one is required.
 */
const DbSecretSchema = z
    .object({
        username: z.string().min(1),
        password: z.string().min(1),
        host: z.string().min(1),
        port: z.coerce.number().int().min(1).max(65535),
        dbname: z.string().min(1).optional(),
        database: z.string().min(1).optional(),
    })
    .refine((secret) => (secret.dbname ?? secret.database) !== undefined, {
        message: 'must carry the database name as `dbname` (or `database`)',
        path: ['dbname'],
    });

/**
 * Render zod issues as one readable line. The raw `ZodError.message` is a JSON blob; this is what an
 * operator reads out of the failed deploy's CloudWatch log.
 *
 * @param error - The validation failure.
 * @returns `path: message` for every issue, comma-separated.
 */
function describeIssues(error: z.ZodError): string {
    return error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join(', ');
}

/**
 * Fetch and validate the identity database credentials.
 *
 * ⛔ Runtime fetch, deliberately — NOT a deploy-time `{{resolve:secretsmanager:…}}` env embed like the
 * Clerk webhook signing secret. The RDS credentials can be rotated, and an embedded copy would go stale
 * silently, leaving the runner unable to connect on the one deploy that needed it.
 *
 * @param secretArn - The DB credentials secret ARN.
 * @returns The validated connection parameters.
 * @throws {Error} when the secret is absent, is not JSON, or does not carry a usable connection.
 * @sideEffect Calls AWS Secrets Manager.
 */
async function resolveDbCredentials(secretArn: string): Promise<z.infer<typeof DbSecretSchema>> {
    const client = new SecretsManagerClient({});
    const response = await client.send(new GetSecretValueCommand({ SecretId: secretArn }));

    if (typeof response.SecretString !== 'string') {
        throw new Error(`Database secret '${secretArn}' has no SecretString — a binary secret is not a connection`);
    }

    let payload: unknown;

    try {
        payload = JSON.parse(response.SecretString);
    } catch (err) {
        throw new Error(`Database secret '${secretArn}' is not valid JSON`, { cause: err });
    }

    const parsed = DbSecretSchema.safeParse(payload);

    if (!parsed.success) {
        throw new Error(`Database secret '${secretArn}' is malformed — ${describeIssues(parsed.error)}`);
    }

    return parsed.data;
}

/**
 * Lambda entrypoint. Resolves the DB credentials from Secrets Manager, then applies + validates the
 * bundled migrations.
 *
 * The event is ignored on purpose: this runner has exactly one action. It is invoked both by the in-deploy
 * `triggers.Trigger` (which sends a custom-resource-shaped payload) and by the pipeline's idempotent
 * safety-net `aws lambda invoke` (which sends none), and neither should be able to select a behaviour.
 *
 * @returns The applied/skipped lists + validation counts.
 * @throws {Error} on any misconfiguration, connection failure, or migration failure — every one of which
 *   must fail the deploy rather than report a clean run.
 * @sideEffect Reads env + Secrets Manager, connects to PostgreSQL, and executes DDL.
 */
export const handler = async (): Promise<MigrateResult> => {
    const env = MigrateEnvSchema.safeParse(process.env);

    if (!env.success) {
        throw new Error(`Identity migration runner is misconfigured — ${describeIssues(env.error)}`);
    }

    const credentials = await resolveDbCredentials(env.data.DB_SECRET_ARN);
    const database = credentials.dbname ?? credentials.database;

    const pool = new Pool({
        user: credentials.username,
        password: credentials.password,
        host: credentials.host,
        port: credentials.port,
        database,
        // RDS terminates TLS with a private CA; `rejectUnauthorized: false` is the posture this runner has
        // always had in every deployed stage. `local` (docker-compose / LocalStack) speaks plaintext.
        ssl: env.data.STAGE === 'local' ? false : { rejectUnauthorized: false },
        max: 1,
    });

    try {
        return await runMigrations({ pool, migrationsDir: bundledMigrationsDir() });
    } finally {
        await pool.end();
    }
};
