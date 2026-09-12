/**
 * The ONE derivation of a run-scoped end-to-end fixture identity.
 *
 * ⛔ It lives in a shared package rather than beside either suite because BOTH the web (Playwright) and
 * mobile (Maestro) tiers provision Clerk users on the SAME shared sandbox instance, and a second copy of
 * this derivation would be a second answer to "which user is this run's". That is exactly the failure
 * `runFixtureIdentity.ts` documents: a fixed, shared fixture that two concurrent runs both addressed, where
 * whichever finished first deleted the other's live user.
 *
 * Mobile is the reason it moved. It kept the FIXED fixture (`commise-e2e-signin+clerk_test@example.com`)
 * after web had already been given run-scoped identities, so the bug web fixed was still live one platform
 * over — and a cross-workspace relative import is banned (`CLAUDE.md`, Imports), so sharing it meant
 * sharing it properly.
 */
export * from './runFixtureIdentity.js';
export * from './clerkSession.js';
export * from './externalId.js';
export { mintSessionToken } from './mintSessionToken.js';
