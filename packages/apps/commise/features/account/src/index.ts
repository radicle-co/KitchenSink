/**
 * @module @commise/features-account — cross-platform account/profile logic shared by the Commise web +
 * mobile apps: the typed `ProfileServiceClient` (DA10-c) owning the `GET`/`PATCH`/`DELETE /v1/users/me`
 * contract + its typed error hierarchy, and the security-relevant account-state (suspended /
 * impersonation) derivation.
 *
 * Pure TypeScript only (no React/React Native) — presentation stays in each app.
 */

export * from './profileServiceClient.js';
export * from './errors.js';
export * from './authState.js';
