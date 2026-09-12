/**
 * Fixture factories for `@commise/features-account` (CODING_STANDARDS: `make*` accepting `Partial<T>`).
 *
 * ⚠️ WHY THIS FILE EXISTS AT ALL — it is not convenience, it is a defect these tests were carrying.
 *
 * Before `ProfileServiceClient` parsed its responses, its suite stood up profile bodies as
 * `{ user: {}, account: {} }` and `{ user: { displayName: 'Ada' }, account: {} }`. Those are not
 * `UserProfile`s: the published `userProfileSchema` requires seven fields on `user` and five on `account`.
 * The tests passed because the client cast (`JSON.parse(text) as T`) rather than parsed — so the suite was
 * asserting transport behaviour against a body the identity service could not send, and would have gone on
 * passing if the response shape had changed underneath it.
 *
 * The factory is therefore the fixture equivalent of the ADR's point: ONE representation of a valid profile,
 * derived from the published contract's field list, so a contract change breaks the fixture in one place
 * instead of leaving twelve hand-written literals silently wrong. `Partial` overrides keep each test DAMP
 * about the one field it actually cares about.
 */
import type { UserProfile, UserProfileAccount, UserProfileUser } from '@kitchensink/schema-identity';

/** A fixed ISO-8601 instant — dates are ISO strings in interfaces, never `Date` (CODING_STANDARDS). */
const FIXED_TIMESTAMP = '2026-01-01T00:00:00.000Z';

/**
 * A valid `user` half of a viewer profile.
 *
 * @param overrides - Fields to replace.
 * @returns A `UserProfileUser` that satisfies `userProfileUserSchema`. Pure.
 */
export function makeUserProfileUser(overrides: Partial<UserProfileUser> = {}): UserProfileUser {
    return {
        id: '01JQZX0000000000000000USER',
        email: 'ada@example.test',
        displayName: 'Ada',
        avatarUrl: null,
        status: 'active',
        createdAt: FIXED_TIMESTAMP,
        updatedAt: FIXED_TIMESTAMP,
        ...overrides,
    };
}

/**
 * A valid `account` half of a viewer profile.
 *
 * @param overrides - Fields to replace.
 * @returns A `UserProfileAccount` that satisfies `userProfileAccountSchema`. Pure.
 */
export function makeUserProfileAccount(overrides: Partial<UserProfileAccount> = {}): UserProfileAccount {
    return {
        id: '01JQZX0000000000000000ACCT',
        userId: '01JQZX0000000000000000USER',
        subscriptionTier: 'free',
        createdAt: FIXED_TIMESTAMP,
        updatedAt: FIXED_TIMESTAMP,
        ...overrides,
    };
}

/**
 * A valid viewer profile — the body `GET`/`PATCH /api/v1/users/me` actually returns.
 *
 * @param overrides - `user` / `account` halves to replace wholesale.
 * @returns A `UserProfile` that satisfies `userProfileSchema`. Pure.
 */
export function makeUserProfile(overrides: Partial<UserProfile> = {}): UserProfile {
    return {
        user: makeUserProfileUser(),
        account: makeUserProfileAccount(),
        ...overrides,
    };
}
