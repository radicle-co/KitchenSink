import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { accounts, profiles } from '@kitchensink/identity-service/database/schema';

/**
 * Ensure a user's auxiliary rows exist: the `profiles` row (display name / avatar) and the `accounts`
 * row (subscription tier). Idempotent — a no-op once they exist.
 *
 * EVERY sync path that writes a `users` row MUST call this. `getUserMe` dereferences the account
 * directly, so a user left with no account is locked out of every authenticated read (a 500 on
 * `/v1/users/me`). The webhook used to inline these inserts and reconciliation omitted them entirely,
 * which is how a reconciliation-provisioned user ended up with a `users` row but no account/profile.
 * Centralizing the two writes here keeps the create paths consistent.
 *
 * Uses `onConflictDoNothing` (create-if-missing): refreshing display name / avatar from the IdP is the
 * job of the `user.updated` webhook, not of a completeness backstop, so this never clobbers a value a
 * user (or a later update) may have set.
 *
 * @sideEffect inserts `profiles` / `accounts` rows.
 * @implements REQ-014 REQ-015 REQ-017 FR-014 FR-015 FR-017 ARCH-012 ARCH-015 MOD-012 MOD-015
 */
export const ensureProfileAndAccount = async (
    db: PostgresJsDatabase<Record<string, never>>,
    userId: string,
    displayName: string,
    avatarUrl: string | null,
): Promise<void> => {
    await db.insert(profiles).values({ userId, displayName, avatarUrl }).onConflictDoNothing();
    await db.insert(accounts).values({ userId }).onConflictDoNothing();
};
