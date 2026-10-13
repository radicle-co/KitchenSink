import { role } from '@commise/ui/colors';
import { test, expect } from '@playwright/test';
import { clerk, setupClerkTestingToken } from '@clerk/testing/playwright';

import { LOCALE, route, isHome, isRoute, hasDoublePrefix, pathnameOf } from './utils/basePath';
import { signInWithTicket } from './utils/auth';
import { clerkPrimarySubmit } from './utils/clerkForm';
import { submitClerkEmailCode } from './utils/clerkEmailCode';
import { TEST_USER_EMAIL, TEST_USER_PASSWORD } from './utils/testUser';

/** `#RRGGBB` → the `rgb(r, g, b)` spelling a computed style uses. */
function rgb(hex: string): string {
    const [r, g, b] = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));

    return `rgb(${r}, ${g}, ${b})`;
}

test.describe('sign-in flow', () => {
    test('signing in through the form lands on the home page (single basePath prefix)', async ({ page }) => {
        // Long by nature, and it does NOT fit the 30s default: this test alone budgets 15s waiting for the
        // "check your email" step, then polls up to 30s for the post-verification redirect — a poll whose
        // window equals the whole test's budget can never complete, so the test always dies first. It only
        // passed locally because the earlier steps are fast enough here to leave room; on a CI runner they
        // are not, and it failed all three attempts. `test.slow()` triples the budget to 90s, the same
        // treatment `signOut.spec.ts` gives its Clerk-driven flow.
        test.slow();

        await setupClerkTestingToken({ page });
        await page.goto(route('/sign-in'));

        // getByRole('textbox', …) avoids the "Show password" button that getByLabel(/password/i) catches.
        await page.getByRole('textbox', { name: /email/i }).fill(TEST_USER_EMAIL);
        // `clerkPrimarySubmit` and not a bare name match: Clerk's Google button is ALSO named "… Continue",
        // so a substring match resolves to 2 elements and every click fails on strict mode.
        await clerkPrimarySubmit(page).click();
        await page.getByRole('textbox', { name: 'Password' }).fill(TEST_USER_PASSWORD);

        // This instance verifies a new device with an email code — `+clerk_test` accepts 424242. Clerk SENDS
        // that code with an async `prepare_*` POST against the sign-in attempt, and submitting the digits
        // before it resolves lands on "You need to send a verification code before attempting to verify."
        // `submitClerkEmailCode` owns that barrier, its recovery, and the explicit submit that removes the
        // dependency on Clerk's OTP auto-submit — shared with signUp.spec.ts, which hits the same race on
        // its own `sign_ups` prepare call.
        await submitClerkEmailCode(page, {
            attempt: 'sign_ins',
            identity: TEST_USER_EMAIL,
            triggerSend: () => clerkPrimarySubmit(page).click(),
            expectStep: () =>
                expect(page.getByRole('heading', { name: /check your email/i })).toBeVisible({ timeout: 15_000 }),
        });

        await expect.poll(() => isHome(pathnameOf(page)), { timeout: 30_000 }).toBe(true);
        expect(hasDoublePrefix(pathnameOf(page))).toBe(false);
        // Home rendered, signed in: the shell marks Home the current page (the H1 is the time-of-day greeting since slice 3).
        await expect(page.getByRole('link', { name: 'Home', exact: true }).filter({ visible: true })).toHaveAttribute(
            'aria-current',
            'page',
        );
    });

    // §8: the code step must fit a 320 px phone. Clerk renders the field in a narrow box; the appearance gives the cell no
    // horizontal padding so a digit is not clipped, and this proves the box is whole, on screen, and not scrolling.
    test('the verification-code step fits a 320 px screen with no sideways scroll', async ({ page }) => {
        test.slow();
        await page.setViewportSize({ width: 320, height: 700 });
        await setupClerkTestingToken({ page });
        await page.goto(route('/sign-in'));

        await page.getByRole('textbox', { name: /email/i }).fill(TEST_USER_EMAIL);
        await clerkPrimarySubmit(page).click();
        await page.getByRole('textbox', { name: 'Password' }).fill(TEST_USER_PASSWORD);
        await clerkPrimarySubmit(page).click();

        await expect(page.getByRole('heading', { name: /check your email/i })).toBeVisible({ timeout: 15_000 });

        const code = await page.getByRole('textbox', { name: /verification code/i }).boundingBox();

        expect(code).not.toBeNull();
        expect(code?.x ?? -1).toBeGreaterThanOrEqual(0);
        expect((code?.x ?? 0) + (code?.width ?? 0)).toBeLessThanOrEqual(320);
        expect(
            await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
        ).toBeLessThanOrEqual(0);

        // W-16: Clerk painted the new-device notice's words in its own orange (2.8:1 on beige) until the warning alert got
        // role colours: the label is `ink` on the `attentionTint` wash (`ui/src/clerk.ts`, measured per scheme in its unit
        // suite). The computed colour is the only thing that sees a third-party renderer. It rides on this test because
        // reaching the code step SENDS a code, and a second test doing so would spend the shared verification budget.
        // ⚠️ Not run when written: the notice is found as the code step's `alert`; confirm that role in a live render.
        const wordsColour = await page.getByRole('alert').evaluate((element) => {
            const holder = [element, ...element.querySelectorAll('*')].find((node) =>
                [...node.childNodes].some((child) => child.nodeType === Node.TEXT_NODE && child.textContent?.trim()),
            );

            return holder === undefined ? '' : getComputedStyle(holder).color;
        });

        expect(wordsColour).toBe(rgb(role.ink));
    });

    test('a signed-in user visiting /sign-in is redirected to home', async ({ page }) => {
        await signInWithTicket(page);

        await page.goto(route('/sign-in'));

        await expect.poll(() => isHome(pathnameOf(page)), { timeout: 15_000 }).toBe(true);
        expect(hasDoublePrefix(pathnameOf(page))).toBe(false);
    });

    test('an authenticated user is allowed through to a protected route', async ({ page }) => {
        await signInWithTicket(page);

        await page.goto(route('/profile'));

        // The middleware lets the authenticated user through — not bounced back to an auth surface.
        await expect.poll(() => isRoute(pathnameOf(page), '/profile'), { timeout: 15_000 }).toBe(true);
        expect(hasDoublePrefix(pathnameOf(page))).toBe(false);
    });

    test('signing out drops the session (a protected route bounces again)', async ({ page }) => {
        await signInWithTicket(page);

        await clerk.signOut({ page });

        await page.goto(route('/profile'));
        await expect(page).toHaveURL(/sign-in|sign-up/);
    });

    // W-01 (`buildSpec.md` §8: "a signed-out deep link returns to its destination after sign-in"). Before this every
    // protected page redirected to a bare /sign-in and the sign-in page forced the locale root, so the destination was
    // gone before sign-in began. These spend NO email-code verification (`emailCodeBudget.test.ts`): the two halves are
    // proved separately, the way the suite signs in everywhere else.
    test('a signed-out deep link is sent to sign-in carrying its destination, and the sign-up link carries it too', async ({
        page,
    }) => {
        await setupClerkTestingToken({ page });

        await page.goto(route('/collections'));

        await expect.poll(() => isRoute(pathnameOf(page), '/sign-in'), { timeout: 20_000 }).toBe(true);
        // The page sends its own BARE path (Next prepends any preview basePath), never an absolute URL.
        expect(new URL(page.url()).searchParams.getAll('redirect_url')).toEqual([`/${LOCALE}/collections`]);

        // The only way to register must not lose where the visitor was going — once: a second `redirect_url` (Clerk adding
        // its own) would be a repeated parameter, which the sign-up page refuses, sending the visitor to the locale root.
        const href = await page.getByRole('link', { name: 'Create an account' }).getAttribute('href');

        expect(new URL(href ?? '', page.url()).searchParams.getAll('redirect_url')).toEqual([`/${LOCALE}/collections`]);
    });

    test('a completed sign-in lands on the destination in redirect_url', async ({ page }) => {
        await signInWithTicket(page);

        // A session is live, so `<SignIn>` goes straight to its `forceRedirectUrl`: the page reads `redirect_url`.
        await page.goto(`${route('/sign-in')}?redirect_url=${encodeURIComponent(route('/collections'))}`);

        await expect.poll(() => isRoute(pathnameOf(page), '/collections'), { timeout: 15_000 }).toBe(true);
        expect(hasDoublePrefix(pathnameOf(page))).toBe(false);
    });

    // The destination is attacker-controlled input: only an app path in this locale may be honoured.
    for (const hostile of ['//evil.example/en', 'https://evil.example/en', '/\\evil.example', '/de/collections']) {
        test(`a hostile redirect_url (${hostile}) lands on home, never off the app`, async ({ page }) => {
            await signInWithTicket(page);

            await page.goto(`${route('/sign-in')}?redirect_url=${encodeURIComponent(hostile)}`);

            await expect.poll(() => isHome(pathnameOf(page)), { timeout: 15_000 }).toBe(true);
            expect(new URL(page.url()).hostname).not.toBe('evil.example');
        });
    }
});
