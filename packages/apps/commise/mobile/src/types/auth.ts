// The wire types come from `@kitchensink/schema-identity` — the GENERATED leaf whose only dependency is zod
// (CODING_STANDARDS §15.2) — never from `@kitchensink/identity-service`, whose graph carries drizzle, `pg`, the
// AWS SDK and `@sentry/nestjs`. The edge erased at compile time, so nothing broke; the exposure was that one
// non-type import from here would have pulled a NestJS service into the React Native bundle.
//
// `UserReadDto` used to be re-exported alongside `UserStatus` and is now GONE rather than repointed: it is a
// server-internal DTO whose `id` is the branded `UserId`, deliberately unpublished (a wire id is an opaque
// string, and the brand asserts an invariant a client cannot establish). Nothing in this app consumed it —
// it was a pass-through re-export, so there is no cast to make and nothing to replace it with. A screen that
// needs the viewer's user record uses `UserProfile` from the schema leaf.
import type { UserStatus } from '@kitchensink/schema-identity';

// The account-state model, block copy, and error types are shared cross-platform (web + mobile)
// via @commise/features-account so the two platforms cannot drift on which sessions are blocked
// or what the user is told. Re-exported here to keep mobile's existing import surface stable.
export {
    AccountSuspendedError,
    ImpersonationBlockedError,
    isAccountSuspendedError,
    isImpersonationBlockedError,
    IMPERSONATION_BLOCK,
    SUSPENDED_BLOCK,
} from '@commise/features-account';
export type { AuthBlockMessage, AuthState } from '@commise/features-account';

export type { UserStatus };
