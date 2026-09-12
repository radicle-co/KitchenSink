import { mkdir } from 'node:fs/promises';

import { expect, test as setup } from '@playwright/test';

import { AUTH_STATE_DIR, AUTH_STATE_PATH, hasClerkSessionCookie } from './utils/authState';
import { signInWithTicket } from './utils/auth';
import { clerkSessionStatus, sessionIdFromCookies, TEST_USER_EMAIL } from './utils/testUser';

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
});
