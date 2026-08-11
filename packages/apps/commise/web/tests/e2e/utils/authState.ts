/**
 * The web e2e suite's SHARED authenticated session — where it is persisted, which specs may use it, and how
 * a restored one is recognised.
 *
 * ## Why a shared session at all
 *
 * Every signed-in spec used to open with `signInWithTicket`, which is two Clerk **Backend API** calls
 * (`getUserList` + `createSignInToken`), a navigation to `/sign-in?__clerk_ticket=…`, the Clerk handshake, and
 * a poll until the app lands on Home. Around 100 of the suite's 107 tests paid that toll, serially
 * (`workers: 1`). Authenticating ONCE per shard and restoring the browser state buys two distinct things, and
 * they are worth separating because only one of them is about wall clock:
 *
 *   1. **Time.** One sign-in per shard instead of ~26.
 *   2. **Blast radius against the shared Clerk dev instance.** Clerk's Frontend-API sign-in limits are scoped
 *      per user and per IP, and this repo has already turned CI red by running two suites concurrently against
 *      the one dev instance. Dropping ~100 sign-ins per run to ~4 removes most of that exposure — a
 *      RELIABILITY win, which for a red-alert auth suite matters more than the minutes.
 *
 * ## Why the exclusion list is load-bearing, not tidiness
 *
 * A `storageState` file is ONE Clerk session. Two specs deliberately DESTROY the session they hold —
 * `signOut.spec.ts` asserts `clerkSessionStatus(sessionId) !== 'active'`, i.e. revoked at Clerk, and
 * `accountDangerZone.spec.ts` finishes its erasure flow through the app's own `signOut` — so running either
 * one against the shared state would revoke it for every test scheduled after them, in a failure that
 * presents as "some later, unrelated spec cannot reach Home". The other four entries need the opposite thing:
 * they must START signed OUT (`routeProtection` asserts the redirect, `authPages` renders the public pages,
 * `signIn`/`signUp` drive the real credential UI). Both classes therefore run in a project with NO
 * `storageState`, where they mint and own their own session exactly as they do today.
 *
 * `SESSION_OWNING_SPECS` is the single authority for that split: `playwright.config.ts` uses it as one
 * project's `testMatch` and the other's `testIgnore`, so a name can never be in both projects or in neither.
 * `__tests__/authState.test.ts` re-derives the partition from the files on disk and additionally flags a spec
 * that LOOKS session-destroying but is not listed — because the cost of that mistake is not a failure in the
 * spec that caused it.
 */
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveRunKey } from './runFixtureIdentity';

/**
 * Directory holding saved `storageState`.
 *
 * ⛔ GITIGNORED, and that is a security property, not housekeeping: the file contains a LIVE Clerk session
 * (cookies plus the dev-browser token). Committing one would publish credentials for a real, signed-in user
 * of the sandbox instance. The ignore rule lives in the repo-root `.gitignore` under `.auth/`.
 */
export const AUTH_STATE_DIR = fileURLToPath(new URL('../../../.auth/', import.meta.url));

/**
 * Path of the `storageState` for a given run key.
 *
 * Keyed on the RUN KEY, not a fixed `user.json`, for the same reason the Clerk fixture is (see
 * `runFixtureIdentity.ts`): each shard derives its own key and provisions its own Clerk user, so a fixed name
 * would let shard 2 restore a session belonging to shard 1's user — which shard 1's teardown then deletes.
 * It also makes a stale file from a previous local run unreachable rather than silently restored, since a
 * session for a deleted user fails in a way that looks nothing like its cause.
 *
 * Pure.
 *
 * @param runKey - This run's fixture key.
 * @returns Absolute path of the state file.
 */
export const authStatePath = (runKey: string): string => join(AUTH_STATE_DIR, `${runKey}.json`);

/**
 * This process's state file. Safe to evaluate at config load: `resolveRunKey` PINS the resolved key into
 * `process.env.COMMISE_E2E_RUN_KEY`, and Playwright's workers inherit that environment, so the config
 * process, `globalSetup`, the setup project and every worker all name the same file.
 */
export const AUTH_STATE_PATH = authStatePath(resolveRunKey());

/**
 * Specs that MUST own their own Clerk session, i.e. run with no `storageState`.
 *
 * Two reasons, both fatal to a shared session, and each entry says which:
 *   • REVOKES  — ends the session it holds, which would strand every later spec.
 *   • SIGNED-OUT — asserts the unauthenticated surface, so a restored session hides what it tests.
 */
export const SESSION_OWNING_SPECS: readonly string[] = [
    // REVOKES — asserts the session is no longer `active` at Clerk (the B23 regression, ADR-0009).
    'signOut.spec.ts',
    // REVOKES — the erasure flow ends in the app's own `signOut` (the Clerk USER survives; the POST is mocked).
    'accountDangerZone.spec.ts',
    // SIGNED-OUT — drives the real password + email-code UI, and calls `clerk.signOut` mid-spec.
    'signIn.spec.ts',
    // SIGNED-OUT — registers a brand-new run-scoped user and becomes it.
    'signUp.spec.ts',
    // SIGNED-OUT — asserts the public sign-in / sign-up pages render for an anonymous caller.
    'authPages.spec.ts',
    // SIGNED-OUT — asserts a protected route redirects an anonymous caller to sign-in.
    'routeProtection.spec.ts',
];

/** Glob form of {@link SESSION_OWNING_SPECS}, for Playwright's `testMatch` / `testIgnore`. */
export const SESSION_OWNING_SPEC_GLOBS: readonly string[] = SESSION_OWNING_SPECS.map((name) => `**/${name}`);

/** The subset of a browser cookie jar this module needs. Structural, so callers can pass Playwright's type. */
export interface NamedCookie {
    readonly name: string;
}

/**
 * True when `cookies` carry a Clerk session — i.e. this context was created from a restored `storageState`
 * rather than opened blank.
 *
 * Derived from the CONTEXT rather than from an environment flag on purpose. The question a caller actually
 * has is "does this browser already hold a session?", and the cookie jar answers exactly that, in both
 * projects, with no way for the config and the helper to disagree about which one is which.
 *
 * All three names are accepted because Clerk splits the job across them and which ones are present depends on
 * the instance kind: `__session` carries the (60-second, self-refreshing) JWT, `__client_uat` is the
 * signed-in-at timestamp the middleware reads, and `__clerk_db_jwt` is the DEV-instance browser token — which
 * is the one that actually matters here, since the e2e suite runs against a Clerk development instance.
 * Requiring `__session` alone would make the fast path depend on a cookie whose JWT is expected to have
 * expired mid-run.
 *
 * Pure.
 *
 * @param cookies - The context's cookies.
 * @returns Whether a Clerk session is present.
 */
export const hasClerkSessionCookie = (cookies: readonly NamedCookie[]): boolean =>
    cookies.some(({ name }) => name === '__session' || name === '__client_uat' || name === '__clerk_db_jwt');
