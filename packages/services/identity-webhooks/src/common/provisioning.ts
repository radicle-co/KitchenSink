import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { users, accounts, profiles } from '@commise/services-identity/database/schema';
import { newUserId } from '@commise/services-identity/database/ulid';
import type { ProvisionDeps } from '@commise/utils-identity';

/**
 * Build the dependency bundle for the shared `provisionCompleteUser` routine, wired to the identity
 * service's Drizzle schema. Both sync paths (the `user.created` webhook and the nightly reconciliation)
 * provision through that one routine so a user is never left with a bare `users` row.
 *
 * @implements REQ-014 REQ-015 REQ-017 FR-014 FR-015 FR-017 ARCH-012 ARCH-015 MOD-012 MOD-015
 */
export const buildProvisionDeps = (db: PostgresJsDatabase<Record<string, never>>): ProvisionDeps => ({
    db,
    schema: { users, accounts, profiles },
    newUserId,
});
