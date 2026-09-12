/**
 * The boot-time schema-currency check for the recipe service.
 *
 * ## Why a boot check when the pipeline already migrates first
 *
 * `kitchensink-recipe-schema-{stage}` is deployed and invoked ahead of every consumer (ADR-0035), so the
 * ordinary release path is covered without this. What it covers is everything that is NOT a release, which
 * is the set the migration safety net was always kept for — "a stage whose schema is behind for a reason no
 * code change explains": a database restored from a snapshot taken before a migration, a task scaling out
 * long after such a restore, a stack deployed by hand outside a pipeline.
 *
 * ⛔ It ships in `warn`. A boot assertion that fails closed can crash-loop a service, so it observes first;
 * the flip is `SCHEMA_CURRENCY_MODE=enforce` once the reports read clean. An unrecognised value resolves to
 * `warn`, never to `enforce`.
 *
 * ⚠️ The migrations directory is resolved as a SIBLING of this module, which is why this file lives beside
 * `migrations/` rather than anywhere more natural. `tsc` mirrors `src/` into `dist/`, and the Dockerfile
 * copies the `.sql` to the matching place under `dist/`, so ONE path is correct both from source and inside
 * the image — no probing, and no branch that is only ever exercised in one of the two.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { sql } from 'drizzle-orm';

import { schemaCurrencyMode, verifySchemaCurrent } from '@kitchensink/db-schema-guard';

import type { RecipeDrizzle } from './client.js';

/** This release's ordered `.sql`, beside this module in both the source tree and the image. */
const shippedMigrationsDir = (): string => join(dirname(fileURLToPath(import.meta.url)), 'migrations');

/**
 * Check that `kitchensink_recipes` has applied every migration this release ships.
 *
 * @param db - The service's Drizzle client.
 * @param report - Where a finding goes in `warn` mode (the caller's logger).
 * @throws {Error} only when `SCHEMA_CURRENCY_MODE=enforce` and the schema is behind, unreadable, or
 *   unpackaged.
 * @sideEffect Reads the shipped migrations directory and queries `schema_migrations`.
 */
export async function verifyRecipeSchemaCurrent(db: RecipeDrizzle, report: (message: string) => void): Promise<void> {
    await verifySchemaCurrent({
        label: 'recipe-service',
        mode: schemaCurrencyMode(process.env['SCHEMA_CURRENCY_MODE']),
        migrationsDir: shippedMigrationsDir(),
        readApplied: async () => {
            const recorded = await db.execute<{ name: string }>(sql`SELECT name FROM schema_migrations`);

            return recorded.rows.map((row) => String(row.name));
        },
        report,
    });
}
