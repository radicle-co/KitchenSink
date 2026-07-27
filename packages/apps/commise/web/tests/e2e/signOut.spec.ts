import { expect, test } from '@playwright/test';

import { hasDoublePrefix, isRoute, pathnameOf, route } from './utils/basePath';
import { signInWithTicket } from './utils/auth';

/**
 * Sign-out landing (U3). The ordinary `LogoutButton` had NO e2e covering where it puts the viewer — the same
 * blind spot that let the account close/erase flows ship a router-level `signOut({ redirectUrl })` which
 * re-rendered the AUTHENTICATED shell from a client payload resolved for the session that had just been
 * destroyed. This spec is the invariant those flows were fixed to, asserted for the plain sign-out too:
 * awaiting the sign-out and leaving with a FULL-DOCUMENT navigation lands the viewer on the app's public front
 * door (the U8 branded welcome hero), with nothing authenticated left on screen.
 *
 * Selectors are role/label only (repo policy); no `data-testid`, no `waitForTimeout`. Serial (Clerk-authed).
 */
test.describe('signing out leaves the authenticated shell (U3)', () => {
    test('lands on the public welcome hero, not a stale authenticated shell', async ({ page }) => {
        // Long by nature: a Clerk sign-in, a real sign-out, and a landing on a route Next dev may still have
        // to compile on demand.
        test.slow();

        await signInWithTicket(page);
        await page.goto(route('/settings'));

        const signOut = page.getByRole('button', { name: 'Sign out of your account' });
        await expect(signOut).toBeVisible();
        await signOut.click();

        // The viewer left the app entirely: the locale root bounces a signed-out caller to the branded
        // welcome/auth-entry hero. Generous timeouts absorb Next dev's on-demand compilation of that route.
        await expect.poll(() => isRoute(pathnameOf(page), '/welcome'), { timeout: 20_000 }).toBe(true);
        await expect(page.getByRole('heading', { name: 'Commise' })).toBeVisible({ timeout: 20_000 });
        await expect(page.getByRole('link', { name: 'Get started' })).toBeVisible();

        // The regression this exists for: nothing authenticated survives. No app nav shell, and no sign-out
        // control (which would mean the shell re-rendered for a session that no longer exists).
        await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Sign out of your account' })).toHaveCount(0);

        // Guards the double-prefix class (a target manually prefixed AND run through the prefix-aware router).
        expect(hasDoublePrefix(pathnameOf(page))).toBe(false);
    });
});
