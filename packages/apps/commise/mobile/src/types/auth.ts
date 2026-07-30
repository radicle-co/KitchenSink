import type { UserReadDto, UserStatus } from '@kitchensink/identity-service';

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

export type { UserReadDto, UserStatus };
