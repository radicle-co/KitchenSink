/**
 * Vitest global setup for the `@kitchensink/identity-webhooks` integration tier.
 *
 * Runs ONCE per test process, before any spec: provisions this package's throwaway database under the
 * production role model (ADR-0039) and migrates it with identity-service's engine, so every spec sees the
 * schema the `migrate` Lambda applies to RDS — and sees it as `identity_service`, the role the deployed
 * handlers hold.
 *
 * A NO-OP when no admin server is configured, so a machine without PostgreSQL skips the DB work rather than
 * failing the run (the specs themselves `describe.skipIf(!hasTestDatabase)`). That is what keeps the tier
 * safe to invoke unconditionally from CI.
 *
 * @sideEffect Creates roles and a database on the admin server, and rebuilds its `public` schema.
 */
import { provisionRoleDatabase } from '@kitchensink/service-test-harness';

import { hasTestDatabase, identityDbSpec } from './integrationDb.js';

export async function setup(): Promise<void> {
    if (!hasTestDatabase) {
        return;
    }

    await provisionRoleDatabase(identityDbSpec());
}
