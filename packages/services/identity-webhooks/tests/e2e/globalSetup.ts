/**
 * Vitest global setup for the `@kitchensink/identity-webhooks` LOCAL e2e tier.
 *
 * Runs ONCE per test process, before any spec: provisions this package's throwaway database under the
 * production role model (ADR-0039) and migrates it with identity-service's engine, so every spec sees the
 * schema the `migrate` Lambda applies to RDS — and sees it as `identity_service`, the role the deployed
 * handlers hold.
 *
 * ⛔ LOCAL e2e never skips (`docs/CODING_STANDARDS.md` §7.1a): with no `DATABASE_ADMIN_URL` the provisioning throws,
 * so the run fails before any suite instead of reporting a green tier that never ran.
 *
 * @sideEffect Creates roles and a database on the admin server, and rebuilds its `public` schema.
 */
import { provisionRoleDatabase } from '@kitchensink/service-test-harness';

import { identityDbSpec } from '../support/roleDb.js';

export async function setup(): Promise<void> {
    await provisionRoleDatabase(identityDbSpec());
}
