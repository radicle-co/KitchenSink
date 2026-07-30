import { expect, test } from '@playwright/test';

import { hasDoublePrefix, isRoute, pathnameOf, route } from './utils/basePath';
import { signInWithTicket } from './utils/auth';
import { clerkSessionStatus, sessionIdFromCookies } from './utils/testUser';

/**
 * Sign-out landing (U3). The ordinary `LogoutButton` had NO e2e covering where it puts the viewer — the same
 * blind spot that let the account close/erase flows ship a router-level `signOut({ redirectUrl })` which
 * re-rendered the AUTHENTICATED shell from a client payload resolved for the session that had just been
 * destroyed. This spec is the invariant those flows were fixed to, asserted for the plain sign-out too:
 * awaiting the sign-out and leaving with a FULL-DOCUMENT navigation lands the viewer on the app's public front
 * door — which, since the owner deleted the welcome hero (2026-07-28), IS the sign-in form — with nothing
 * authenticated left on screen.
 *
 * It also asserts the property the landing is only a PROXY for: the session is REVOKED at Clerk. B23 was
 * exactly a sign-out that resolved without revoking anything (`useClerk().signOut` queues instead of signing
 * out until clerk-js has loaded), and a URL-only assertion can go green on a stale/expired cookie while the
 * session is still live and still minting fresh JWTs. Clerk's Backend API is the only source of that truth.
 *
 * Selectors are role/label only (repo policy); no `data-testid`, no `waitForTimeout`. Serial (Clerk-authed).
 */
test.describe('signing out leaves the authenticated shell (U3)', () => {
    test('lands on the public sign-in form, not a stale authenticated shell', async ({ page }) => {
        // Long by nature: a Clerk sign-in, a real sign-out, and a landing on a route Next dev may still have
        // to compile on demand.
        test.slow();

        await signInWithTicket(page);
        await page.goto(route('/settings'));

        // The session THIS browser holds — the shared fixture user may still hold others from earlier specs.
        const sessionId = sessionIdFromCookies(await page.context().cookies());

        if (sessionId === null) {
            throw new Error('precondition failed: no __session cookie after the ticket sign-in');
        }

        const signOut = page.getByRole('button', { name: 'Sign out of your account' });
        await expect(signOut).toBeVisible();
        // Clicked as soon as it is visible, which under Next dev is reliably BEFORE clerk-js has loaded — so
        // this also exercises the B23 window rather than tiptoeing around it.
        await signOut.click();

        // The viewer left the app entirely: the locale root bounces a signed-out caller to the sign-in form.
        // Generous timeouts absorb Next dev's on-demand compilation of that route.
        await expect.poll(() => isRoute(pathnameOf(page), '/sign-in'), { timeout: 20_000 }).toBe(true);
        // The public surface actually RENDERED — Clerk's <SignIn> email field, not a blank page or a 404.
        await expect(page.getByRole('textbox', { name: /email/i })).toBeVisible({ timeout: 20_000 });

        // The regression this exists for: nothing authenticated survives. No app nav shell, and no sign-out
        // control (which would mean the shell re-rendered for a session that no longer exists).
        await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Sign out of your account' })).toHaveCount(0);

        // Guards the double-prefix class (a target manually prefixed AND run through the prefix-aware router).
        expect(hasDoublePrefix(pathnameOf(page))).toBe(false);

        // The security property itself: Clerk no longer holds this session. Without this, a sign-out that
        // resolved without revoking anything (B23) could still land here and look green.
        expect(await clerkSessionStatus(sessionId)).not.toBe('active');
        // The browser's session cookie is gone too, so nothing can re-mint a token for it.
        expect(sessionIdFromCookies(await page.context().cookies())).toBeNull();
    });
});
