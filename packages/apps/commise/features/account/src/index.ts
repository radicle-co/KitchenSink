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

export * from './profileServiceClient.js';
export * from './errors.js';
export * from './authState.js';
export * from './queries.js';
export * from './erasure.js';
export * from './session/signOutAndVerify.js';
