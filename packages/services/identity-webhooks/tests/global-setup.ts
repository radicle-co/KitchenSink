/**
 * Vitest global setup for the `@kitchensink/identity-webhooks` integration tier.
 *
 * Runs ONCE per test process, before any spec: applies identity-service's ordered migration SQL to the
 * harness database so every spec sees the same schema the `migrate` Lambda applies to RDS. Idempotent — it
 * drops and recreates `public` each time, so repeated runs land the same end state.
 *
 * A NO-OP when `DATABASE_URL`/`TEST_DATABASE_URL` is unset, so a machine without the harness up skips the
 * DB work rather than failing the run (the specs themselves `describe.skipIf(!hasDatabaseUrl)`). This is
 * what keeps the tier safe to invoke unconditionally from CI.
 *
 * @sideEffect DROPS the `public` schema on the configured database. THROWAWAY DATABASES ONLY.
 */
import { applyIdentitySchema, hasDatabaseUrl, openIntegrationDb } from './integration-db.js';

export async function setup(): Promise<void> {
    if (!hasDatabaseUrl) {
        return;
    }

    const { pool } = openIntegrationDb();

    try {
        await applyIdentitySchema(pool);
    } finally {
        await pool.end();
    }
}
