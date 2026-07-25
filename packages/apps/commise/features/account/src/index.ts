/**
 * @module @commise/features-account — cross-platform account/profile logic shared by the Commise web +
 * mobile apps: the typed `ProfileServiceClient` (DA10-c) owning the `GET`/`PATCH`/`DELETE /v1/users/me`
 * contract + its typed error hierarchy, the security-relevant account-state (suspended / impersonation)
 * derivation, and the `profileQueries` `queryOptions` factory (B12) owning the shared cache key/policy.
 *
 * No React components (no JSX) — presentation stays in each app. `queries.ts` depends on
 * `@tanstack/react-query`'s framework-agnostic `queryOptions` helper only (no hooks are called here).
 */

export * from './profileServiceClient.js';
export * from './errors.js';
export * from './authState.js';
export * from './queries.js';
