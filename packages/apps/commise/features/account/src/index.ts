/**
 * @module @commise/features-account — cross-platform account/profile logic shared by the Commise web +
 * mobile apps: the typed `ProfileServiceClient` (DA10-c) owning the `GET`/`PATCH`/`DELETE /api/v1/users/me`
 * CLOSURE contract + its typed error hierarchy, the security-relevant account-state (suspended /
 * impersonation) derivation, the `profileQueries` `queryOptions` factory (B12) owning the shared cache
 * key/policy, the pure account-ERASURE domain logic (CR-002 / U4b — the confirmation-phrase gate and the
 * donate-election eligibility) both platforms' erasure UIs read, and — ADR-0009 — `signOutAndVerify`, the
 * cross-platform core of the sign-out command (the ordering + the fail-closed post-condition that a
 * sign-out really ended the session), which each platform's own sign-out hook adapts.
 *
 * The pure logic here has no JSX. The cross-platform danger-zone COMPONENTS (the erasure dialog's web +
 * native leaves) live on the `./danger` subpath so a non-React consumer of the pure logic never resolves the
 * platform leaves.
 */

export { AVATAR_PRESIGN_PATH, PROFILE_ME_PATH, ProfileServiceClient } from './profileServiceClient.js';
export type {
    DeleteAccountResult,
    ProfileRequestOptions,
    ProfileServiceClientOptions,
    TokenSource,
} from './profileServiceClient.js';
// DRIFT LAYER 3's consumer half for identity (GR-017 §17-b.5). Exported so a host can reuse the pure verdict /
// message helpers, and so the test seam is reachable the way the food client's is.
export {
    checkContractSkew,
    compareContractHashes,
    formatContractSkewWarning,
    reportContractSkewOnce,
    resetContractSkewLatchForTests,
} from './contractSkew.js';
export type { ContractSkewProbeOptions, ContractSkewVerdict } from './contractSkew.js';
export {
    BadRequestError,
    ForbiddenError,
    InvalidRequestError,
    NotFoundError,
    ProfileServiceClientError,
    UnauthorizedError,
    UnexpectedResponseError,
    isBadRequestError,
    isForbiddenError,
    isInvalidRequestError,
    isNotFoundError,
    isProfileServiceClientError,
    isUnauthorizedError,
    isUnexpectedResponseError,
} from './errors.js';
export { IMPERSONATION_BLOCK, SUSPENDED_BLOCK, deriveAuthState } from './authState.js';
export type { AuthBlockMessage, AuthState, DeriveAuthStateInput } from './authState.js';
export {
    AccountSuspendedError,
    ImpersonationBlockedError,
    isAccountSuspendedError,
    isImpersonationBlockedError,
} from './authState.errors.js';
export { PROFILE_STALE_TIME_MS, profileQueries, profileServiceKeys } from './queries.js';
export {
    ACCOUNT_ERASURE_CONFIRMATION_PHRASE,
    confirmsErasurePhrase,
    isErasureDonationEligible,
    selectDonatableRecipes,
} from './erasure.js';
export { SignOutNotVerifiedError, isSignOutNotVerifiedError, signOutAndVerify } from './session/signOutAndVerify.js';
export type { SignOutClientStatus, SignOutVerificationClient } from './session/signOutAndVerify.js';
