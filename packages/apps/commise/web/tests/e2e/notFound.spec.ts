import { expect, test } from '@playwright/test';

import { isHome, isRoute, pathnameOf, route } from './utils/basePath';
import { signInWithTicket } from './utils/auth';

/**
 * The app's own 404 page, for a signed-in viewer (E2, `docs/design/uiOverhaul/evaluateShellAndLists.md`; spec
 * `specShellAndLists.md` §N).
 *
 * Unknown URLs got Next's bare built-in page — no app styles, no brand, no way home — because a segment's
 * `not-found.tsx` only catches a `notFound()` thrown beneath it, never an unmatched URL. `src/app/global-not-found.tsx`
 * now answers them with the app's page, inside the shell once the session is known. Each case asserts the page's `h1`, the app
 * navigation, that the way home works, and that the page tells crawlers not to index it. A second block asserts the
 * page as the server sends it — the 404 status and the heading in the first HTML, with JavaScript off — because a
 * production server once answered 200 with the loading skeleton (see that file). The
 * signed-out case lives in `routeProtection.spec.ts`, which owns the anonymous session.
 *
 * Selectors are role/label only (repo policy); no `data-testid`, no `waitForTimeout`.
 */

const TITLE = 'We couldn’t find that page.';
const UNKNOWN_PATHS = ['/this-page-does-not-exist', '/recipes/rec_seed/typo'];

for (const path of UNKNOWN_PATHS) {
    test(`${path} is a 404 inside the app shell, with a way home`, async ({ page }) => {
        await signInWithTicket(page);

        await page.goto(route(path));

        await expect(page.getByRole('heading', { level: 1, name: TITLE })).toBeVisible();
        await expect(page.locator('meta[name="robots"][content="noindex"]')).toHaveCount(1);
        await expect(page.getByRole('navigation').first()).toBeVisible();

        await page.getByRole('link', { name: 'Back to Home' }).click();
        await expect.poll(() => isHome(pathnameOf(page))).toBe(true);
    });
}

// JavaScript is off in the second context, so the page is the first HTML and the status is the response's own. The
// session is the one `signInWithTicket` just refreshed, copied across. A protected route is visited first, in the same
// context, so a run where the server did not see the session fails here instead of passing as the signed-out case.
test.describe('as the server sends it, signed in', () => {
    for (const path of UNKNOWN_PATHS) {
        test(`${path} answers 404 with the app’s own page in the first HTML`, async ({ page, browser }) => {
            await signInWithTicket(page);
            const context = await browser.newContext({
                javaScriptEnabled: false,
                storageState: await page.context().storageState(),
            });

            try {
                const serverPage = await context.newPage();

                await serverPage.goto(route('/account'));
                expect(isRoute(pathnameOf(serverPage), '/account')).toBe(true);

                const response = await serverPage.goto(route(path));

                expect(response?.status()).toBe(404);
                await expect(serverPage.getByRole('heading', { level: 1, name: TITLE })).toBeVisible();
                await expect(serverPage.getByRole('status', { name: /loading/i })).toHaveCount(0);
            } finally {
                await context.close();
            }
        });
    }
});
