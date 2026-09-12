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
 * ADR-0022 closed that window by putting the runner and the ECS service in ONE stack, with an
 * `aws-cdk-lib/triggers` `Trigger` between the Lambda's code update and the service's rollout. ADR-0035
 * replaced it: the runner owns `kitchensink-identity-schema-{stage}` and is deployed and invoked by its own
 * pipeline step ahead of every consumer, which reaches across apps as `DependsOn` never could. The `.sql`
 * files have not moved through any of this — they have always been owned here.
 *
 * ## Contract
 *
 * Migrations are plain ordered `.sql` (not drizzle-kit's journal), discovered from the directory rather
 * than a hardcoded list. `src/database/migrations` stays the SINGLE source of truth: `esbuild.mjs` copies
 * it beside the bundle at BUILD time and the handler reads it at runtime — a build-time file copy, never a
 * module import. Each migration runs once, tracked in `schema_migrations`, so re-invoking is a no-op and
 * the destructive reset in `0005` never re-runs.
 *
 * ## Who it connects as (the role split, `docs/plans/2026-09-11-database-role-split.md`)
 *
 * `identity_migrator`, by RDS IAM — no secret. It used to read the RDS MASTER credential out of Secrets Manager and
 * run every migration as the master (`identity_app`, `rds_superuser`), which also made the master the owner of
 * everything it created. Now every DDL statement runs as `identity_owner`, and the identity service connects as
 * `identity_service` with data privileges only. The master is used by nothing but the platform's bootstrap and
 * reaper.
 *
 * Every failure here THROWS. Nothing catches these: a thrown error surfaces as a Lambda `FunctionError`,
 * which `run-migrations.sh` classifies as a failed run and which fails the deploy. A migration runner that
 * resolves successfully having applied nothing is indistinguishable from one that had nothing to do — which
 * is the silent no-op ADR-0022 recorded, and which `expectManifestSha` is what actually removes.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getTableName, is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import pg from 'pg';
import { z } from 'zod';

import { applyMigrations, DATABASE_ROLES, isManifestSha } from '@kitchensink/db-schema-guard';
import type { MigrateResult } from '@kitchensink/db-schema-guard';
import * as schema from '@kitchensink/identity-db';
import { rdsPoolConfigFromEnv } from '@kitchensink/rds-iam-auth';

const { Pool } = pg;

/** Identity's three database roles. The runner connects as the migrator and does all DDL as the owner. */
const IDENTITY_ROLES = DATABASE_ROLES.identity;

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
    /** The database the pool is connected to — the engine closes it to PUBLIC and admits the two logins. */
    readonly database: string;
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
 * ⛔ The engine is `@kitchensink/db-schema-guard`'s, not a copy. What is genuinely identity's is bound here: which
 * SQL, which tables the drizzle schema says must exist afterwards, and which roles own and serve the database.
 *
 * @param options - The connected pool, the migrations directory, the caller's manifest expectation, and the
 *   database.
 * @returns The applied/skipped lists, the validation counts, and the manifest that ran.
 * @throws {Error} when the expectation names a different migration set, the lock cannot be acquired, a
 *   migration's SQL fails, a discovered migration is not recorded, an expected table is missing, or the
 *   ownership/privilege audit fails.
 * @sideEffect Connects to PostgreSQL, takes a session advisory lock, and executes DDL.
 */
export async function runMigrations(options: RunMigrationsOptions): Promise<MigrateResult> {
    return applyMigrations({
        pool: options.pool,
        migrationsDir: options.migrationsDir,
        label: 'identity',
        expectedTables: expectedTables(),
        expectManifestSha: options.expectManifestSha,
        database: options.database,
        roles: IDENTITY_ROLES,
    });
}

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
 * A migration-manifest digest: 64 lowercase hex, anchored.
 *
 * ⛔ VALIDATED AT THE JSON BOUNDARY, not merely typed. A payload that spells the key differently, or one the
 * CLI mangled, yields `undefined` — and an unchecked `undefined` is a runner reporting a clean run over
 * whatever SQL it happens to hold, which is the exact state ADR-0035 exists to abolish.
 */
// The PREDICATE is `db-schema-guard`'s, not a fourth copy of the pattern: the digest's shape is one rule,
// and the two INDEPENDENT implementations ADR-0035 relies on are the two that COMPUTE it (the bundle's and
// `sha256sum`'s), never the one that validates it.
const MANIFEST_SHA = z.string().refine(isManifestSha, 'must be a 64-character lowercase hex sha256');

/**
 * The event this runner accepts: `{ expectManifestSha }`, and nothing else (`.strict()`).
 *
 * ⛔ It selects NO behaviour — this runner has exactly one action. `expectManifestSha` is an ASSERTION: it
 * states which migration set the caller believes this runner holds, and a runner holding a different one
 * refuses rather than reporting a clean run over the wrong SQL. Its one caller is `.github/scripts/run-migrations.sh`.
 */
const MigrateEventSchema = z.object({ expectManifestSha: MANIFEST_SHA }).strict();

/**
 * Lambda entrypoint. Connects as `identity_migrator` by RDS IAM (`DB_HOST`/`DB_PORT`/`DB_NAME`, optionally
 * `DB_USERNAME`), then applies + validates the bundled migrations as `identity_owner`.
 *
 * @param event - `{ expectManifestSha }`.
 * @returns The applied/skipped lists, validation counts, and the manifest that ran.
 * @throws {Error} on any misconfiguration, connection failure, or migration failure — every one of which
 *   must fail the deploy rather than report a clean run.
 * @sideEffect Reads env, connects to PostgreSQL, and executes DDL.
 */
export const handler = async (event: unknown = {}): Promise<MigrateResult> => {
    const parsedEvent = MigrateEventSchema.safeParse(event ?? {});

    if (!parsedEvent.success) {
        throw new Error(`Identity migration runner received a malformed event — ${describeIssues(parsedEvent.error)}`);
    }

    const config = rdsPoolConfigFromEnv({ username: IDENTITY_ROLES.migrator });
    // A `DATABASE_URL` (local/integration) names the database in its path; the discrete form carries it as a field.
    const database =
        config.database ??
        (config.connectionString === undefined ? undefined : new URL(config.connectionString).pathname.slice(1));

    if (database === undefined || database === '') {
        throw new Error(
            'Identity migration runner is misconfigured — DB_NAME is required to name the database it migrates',
        );
    }

    const pool = new Pool({ ...config, max: 1 });

    try {
        return await runMigrations({
            pool,
            migrationsDir: bundledMigrationsDir(),
            expectManifestSha: parsedEvent.data.expectManifestSha,
            database,
        });
    } finally {
        await pool.end();
    }
};
