/**
 * The shared end-to-end identity toolkit's root surface: the run key and the one run-minted identity left (the web
 * sign-up spec's), the Clerk session layer every tier signs in through, and the `external_id` wait.
 *
 * ⛔ It lives in a shared package because BOTH the web (Playwright) and mobile (Maestro) tiers — and k6 and the
 * cross-service suite — sign in on the SAME shared sandbox instance, and a second copy of "which user is this
 * run's" is exactly the failure `runFixtureIdentity.ts` documents. Which users those are is the fixed test pool's
 * (`./testPool`), leased through `./lease` and provisioned only by `poolAdmin`; those are separate package exports
 * rather than additions to this barrel.
 */
export * from './runFixtureIdentity.js';
export * from './clerkSession.js';
export * from './externalId.js';
