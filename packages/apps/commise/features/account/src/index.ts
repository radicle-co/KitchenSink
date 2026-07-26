/**
 * @module @commise/features-account — cross-platform account/profile logic shared by the Commise web +
 * mobile apps: the typed `ProfileServiceClient` (DA10-c) owning the `GET`/`PATCH`/`DELETE /v1/users/me`
 * CLOSURE contract + its typed error hierarchy, the security-relevant account-state (suspended /
 * impersonation) derivation, the `profileQueries` `queryOptions` factory (B12) owning the shared cache
 * key/policy, and — CR-002 / U4b — the pure account-ERASURE domain logic (the confirmation-phrase gate and
 * the donate-election eligibility) both platforms' erasure UIs read.
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
