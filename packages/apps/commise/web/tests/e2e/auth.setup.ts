import { mkdir } from 'node:fs/promises';

import { expect, test as setup } from '@playwright/test';
import type { Page } from '@playwright/test';

import { AUTH_STATE_DIR, AUTH_STATE_PATH, hasClerkSessionCookie } from './utils/authState';
import { route } from './utils/basePath';
import { signInWithTicket } from './utils/auth';
import { clerkSessionStatus, sessionIdFromCookies, TEST_USER_EMAIL } from './utils/testUser';
import { resolveWebServerMode } from './utils/webServerMode';

/**
 * The `setup` project: authenticate ONCE per Playwright run and persist the browser state that every
 * shared-session spec then restores. See `utils/authState.ts` for why the suite works this way and which
 * specs deliberately opt out.
 *
 * ## Why this file asserts so much for a "setup" step
 *
 * Its output is a precondition for ~100 downstream tests, so a silently WRONG state file is the worst
 * available outcome: Playwright would happily restore a jar of dead cookies, and the failure would surface as
 * "some spec could not reach Home" in whichever file the shard happened to schedule first — a diagnosis
 * pointing at innocent code. Every property the downstream projects depend on is therefore checked HERE,
 * where a failure names its own cause:
 *
 *   1. the ticket sign-in landed (inherited from `signInWithTicket`'s own poll);
 *   2. the context really holds Clerk cookies — the exact signal `signInWithTicket`'s fast path keys on, so a
 *      state file that would silently send every later spec down the SLOW path is caught;
 *   3. the session is `active` at Clerk's **Backend API**, not merely cookie-shaped. This is the B23 lesson
 *      applied in reverse (ADR-0009): a browser can hold a perfectly well-formed session cookie for a session
 *      that no longer exists, and only the Backend API knows the difference.
 *
 * `force: true` is required, not decorative: without it this very step would take the fast path on a context
 * that already had cookies and never mint the session it exists to create.
 */
/**
 * The routes the specs open first, compiled before any test runs. Under `next dev` a route compiles the FIRST time it is
 * requested, and that compile lands inside whichever assertion asked: the first test of a fresh dev server died of
 * `page.goto: net::ERR_ABORTED` on `/recipes/{id}` (the compile restarts the navigation), and its repeat passed. A
 * production build (`next start`, which is what CI and the local lane run) has nothing to compile, so this does nothing
 * there (`utils/webServerMode.ts`). The ids name no recipe: a page that renders its not-found state has compiled all the
 * same.
 */
const DEV_WARM_ROUTES: readonly string[] = [
    '/recipes/ec000000-0000-4000-8000-0000000000ff',
    '/recipes/ec000000-0000-4000-8000-0000000000ff/edit',
];

/** Open each warm route once, in the signed-in page. A no-op unless the suite drives `next dev`. */
async function warmDevRoutes(page: Page): Promise<void> {
    if (resolveWebServerMode(process.env) !== 'dev') {
        return;
    }

    for (const path of DEV_WARM_ROUTES) {
        await page.goto(route(path), { waitUntil: 'load', timeout: 120_000 });
    }
}

setup('authenticate once and persist the shared session', async ({ page }) => {
    // Long by nature: the first navigation of the run pays Next dev's on-demand compilation of `/sign-in` and
    // `/` on top of the Clerk round-trips.
    setup.slow();

    await signInWithTicket(page, { force: true });

    const cookies = await page.context().cookies();

    expect(
        hasClerkSessionCookie(cookies),
        'the ticket sign-in left no Clerk cookie, so the saved state would restore an anonymous browser and ' +
            'every shared-session spec would fall back to signing in itself',
    ).toBe(true);

    const sessionId = sessionIdFromCookies(cookies);

    if (sessionId === null) {
        throw new Error(`no __session cookie after the ticket sign-in as ${TEST_USER_EMAIL}`);
    }

    expect(
        await clerkSessionStatus(sessionId),
        'Clerk does not report this session as active, so persisting it would hand ~100 tests a dead session',
    ).toBe('active');

    // `storageState` does not create intermediate directories.
    await mkdir(AUTH_STATE_DIR, { recursive: true });
    await page.context().storageState({ path: AUTH_STATE_PATH });

    // Signed in, so these routes render their own page and compile, rather than redirect to sign-in.
    await warmDevRoutes(page);
});
