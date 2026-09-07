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
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { getTableName, is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import pg from 'pg';
import { z } from 'zod';

import { applyMigrations } from '@kitchensink/db-schema-guard';
import type { MigrateResult } from '@kitchensink/db-schema-guard';
import * as schema from '@kitchensink/identity-db';

const { Pool } = pg;

export { discoverMigrations } from '@kitchensink/db-schema-guard';
export type { DiscoveredMigration, MigrateResult } from '@kitchensink/db-schema-guard';

/** Options for {@link runMigrations} — the injectable core (a pool + a migrations directory). */
export interface RunMigrationsOptions {
    /** A connected `pg` pool to the target database. */
    readonly pool: pg.Pool;
    /** The directory holding the ordered `.sql` migrations. */
    readonly migrationsDir: string;
    /**
     * The manifest digest the caller expects this runner to hold.
     *
     * ⛔ REQUIRED. ADR-0035 rejects the optional form by name — "an optional expectation is one a caller
     * forgets, and a forgotten one is indistinguishable from the behaviour it replaces" — and while it was
     * optional here, the property that decision rests on was enforced by one argument check in one shell
     * script rather than by the runner.
     */
    readonly expectManifestSha: string;
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
 * Apply the identity migrations idempotently against a pool, then validate the result.
 *
 * ⛔ The engine is `@kitchensink/db-schema-guard`'s, not a copy. This loop — the advisory lock, the ledger,
 * the rollback, the post-run validation — used to exist three times over, once per service, and the three
 * copies had already drifted in their accounts of why. What is genuinely identity's is bound here: which
 * SQL, and which tables the drizzle schema says must exist afterwards.
 *
 * @param options - The connected pool, the migrations directory, and the caller's manifest expectation.
 * @returns The applied/skipped lists, the validation counts, and the manifest that ran.
 * @throws {Error} when the expectation names a different migration set, the lock cannot be acquired, a
 *   migration's SQL fails, a discovered migration is not recorded, or an expected table is missing.
 * @sideEffect Connects to PostgreSQL, takes a session advisory lock, and executes DDL.
 */
export async function runMigrations(options: RunMigrationsOptions): Promise<MigrateResult> {
    return applyMigrations({
        pool: options.pool,
        migrationsDir: options.migrationsDir,
        label: 'identity',
        expectedTables: expectedTables(),
        expectManifestSha: options.expectManifestSha,
    });
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
 * A migration-manifest digest: 64 lowercase hex, anchored.
 *
 * ⛔ VALIDATED AT THE JSON BOUNDARY, not merely typed. A payload that spells the key differently, or one the
 * CLI mangled, yields `undefined` — and an unchecked `undefined` is a runner reporting a clean run over
 * whatever SQL it happens to hold, which is the exact state ADR-0035 exists to abolish.
 */
const MANIFEST_SHA = z.string().regex(/^[0-9a-f]{64}$/u, 'must be a 64-character lowercase hex sha256');

/**
 * The event this runner accepts.
 *
 * ⛔ It selects NO behaviour — this runner has exactly one action, and its caller may not pick a different
 * one. `expectManifestSha` is an ASSERTION, not an action: it states which migration set the caller
 * believes this runner holds, and a runner holding a different one refuses rather than reporting a clean
 * run over the wrong SQL. It is REQUIRED; see the field's note on `RunMigrationsOptions`.
 *
 * ⚠️ There is now exactly ONE caller, `.github/scripts/run-migrations.sh`. It used to be two — the in-stack
 * `triggers.Trigger` sent a custom-resource-shaped payload — and that second, vanished caller was the whole
 * reason this schema tolerated unknown fields and an absent expectation.
 */
const MigrateEventSchema = z.object({
    expectManifestSha: MANIFEST_SHA,
});

/**
 * Lambda entrypoint. Resolves the DB credentials from Secrets Manager, then applies + validates the
 * bundled migrations.
 *
 * @param event - Optionally carries the caller's `expectManifestSha`.
 * @returns The applied/skipped lists, validation counts, and the manifest that ran.
 * @throws {Error} on any misconfiguration, connection failure, or migration failure — every one of which
 *   must fail the deploy rather than report a clean run.
 * @sideEffect Reads env + Secrets Manager, connects to PostgreSQL, and executes DDL.
 */
export const handler = async (event: unknown = {}): Promise<MigrateResult> => {
    const env = MigrateEnvSchema.safeParse(process.env);

    if (!env.success) {
        throw new Error(`Identity migration runner is misconfigured — ${describeIssues(env.error)}`);
    }

    const parsedEvent = MigrateEventSchema.safeParse(event ?? {});

    if (!parsedEvent.success) {
        throw new Error(`Identity migration runner received a malformed event — ${describeIssues(parsedEvent.error)}`);
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
        return await runMigrations({
            pool,
            migrationsDir: bundledMigrationsDir(),
            expectManifestSha: parsedEvent.data.expectManifestSha,
        });
    } finally {
        await pool.end();
    }
};
