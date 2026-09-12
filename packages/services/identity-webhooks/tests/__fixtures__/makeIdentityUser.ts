/**
 * Fixture factories for a complete identity world (a `users` row plus its `accounts`/`profiles` companion
 * rows), used by the integration tier to seed the rows the erasure path acts on.
 *
 * Every factory takes a `Partial<T>` of overrides over a valid default, so a spec states ONLY the field it
 * is actually about (a tombstone's `deletedAt`, a bystander's `status`) and the rest stays valid — which is
 * what makes an erasure spec's intent readable at a glance.
 */
import type { NewAccountRow, NewProfileRow, NewUserRow } from '@kitchensink/identity-db';

/** Monotonic suffix so repeated factory calls never collide on the `id`/`identityId`/`email` uniques. */
let sequence = 0;

/** Next unique fixture discriminator. @sideEffect Advances the module-level counter. */
function nextSuffix(): string {
    sequence += 1;

    return String(sequence).padStart(4, '0');
}

/**
 * A valid ACTIVE `users` row.
 *
 * @param overrides - Fields to override on the default active user.
 * @returns An insertable `users` row.
 * @sideEffect Advances the fixture sequence (so each call is unique).
 */
export function makeIdentityUser(overrides: Partial<NewUserRow> = {}): NewUserRow {
    const suffix = nextSuffix();

    return {
        id: `usr_fixture_${suffix}`,
        identityId: `user_clerk_${suffix}`,
        email: `fixture-${suffix}@example.com`,
        name: `Fixture ${suffix}`,
        picture: `https://cdn.example.com/${suffix}.png`,
        status: 'active',
        ...overrides,
    };
}

/**
 * A `users` row in the CLOSED (tombstoned) state, the only state the 12-month sweep may erase.
 *
 * `deletedAt` is the closure instant the retention window is measured from, so it is a required argument
 * rather than a defaulted field — a tombstone fixture with an accidental default closure date would make a
 * retention-window assertion meaningless.
 *
 * @param closedAt - The closure instant (`deleted_at`).
 * @param overrides - Fields to override.
 * @returns An insertable tombstoned `users` row.
 * @sideEffect Advances the fixture sequence.
 */
export function makeTombstonedUser(closedAt: Date, overrides: Partial<NewUserRow> = {}): NewUserRow {
    return makeIdentityUser({ status: 'tombstoned', deletedAt: closedAt, ...overrides });
}

/**
 * The `accounts` companion row for a user.
 *
 * @param userId - The owning user's ULID.
 * @param overrides - Fields to override.
 * @returns An insertable `accounts` row.
 */
export function makeIdentityAccount(userId: string, overrides: Partial<NewAccountRow> = {}): NewAccountRow {
    return { userId, subscriptionTier: 'free', ...overrides };
}

/**
 * The `profiles` companion row for a user.
 *
 * @param userId - The owning user's ULID.
 * @param overrides - Fields to override.
 * @returns An insertable `profiles` row.
 */
export function makeIdentityProfile(userId: string, overrides: Partial<NewProfileRow> = {}): NewProfileRow {
    return {
        userId,
        displayName: `Display ${userId}`,
        avatarUrl: `https://cdn.example.com/${userId}.png`,
        ...overrides,
    };
}
