/**
 * @module @commise/features-account — cross-platform account/profile logic shared by the
 * Commise web + mobile apps: the single profile-update endpoint contract and the
 * security-relevant account-state (suspended / impersonation) derivation.
 *
 * Pure TypeScript only (no React/React Native) — presentation stays in each app.
 */

export * from './profile-client.js';
export * from './auth-state.js';
