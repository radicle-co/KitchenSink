import { role, roleDark } from '@commise/ui/colors';
import { test, expect } from '@playwright/test';
import type { Locator } from '@playwright/test';
import { setupClerkTestingToken } from '@clerk/testing/playwright';

import { route, isRoute, hasDoublePrefix, pathnameOf } from './utils/basePath';

// The auth pages must actually MOUNT the Clerk widget under a preview basePath (a bare shell with only
// the <title> is the classic "Clerk derives its path from the basePath-stripped pathname" failure),
// and cross-links between them must resolve with the basePath applied EXACTLY ONCE.
test.describe('auth pages render and cross-link under the preview basePath', () => {
    test('sign-in page mounts the Clerk widget, not a blank shell', async ({ page }) => {
        await setupClerkTestingToken({ page });
        await page.goto(route('/sign-in'));

        await expect(page).toHaveTitle(/Commise/);
        await expect(page.getByRole('heading', { name: 'Sign in to Commise' })).toBeVisible();
        await expect(page.getByLabel(/email/i)).toBeVisible();
    });

    test('sign-up page mounts the Clerk widget, not a blank shell', async ({ page }) => {
        await setupClerkTestingToken({ page });
        await page.goto(route('/sign-up'));

        await expect(page).toHaveTitle(/Commise/);
        await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
        await expect(page.getByLabel(/email/i)).toBeVisible();
    });

    test('sign-in → "Create an account" link lands on /sign-up with a single basePath prefix', async ({ page }) => {
        await setupClerkTestingToken({ page });
        await page.goto(route('/sign-in'));

        await page.getByRole('link', { name: 'Create an account' }).click();

        await expect.poll(() => isRoute(pathnameOf(page), '/sign-up')).toBe(true);
        expect(hasDoublePrefix(pathnameOf(page))).toBe(false);
    });

    test('sign-up → "Sign in" link lands on /sign-in with a single basePath prefix', async ({ page }) => {
        await setupClerkTestingToken({ page });
        await page.goto(route('/sign-up'));

        await page.getByRole('link', { name: /sign in/i }).click();

        await expect.poll(() => isRoute(pathnameOf(page), '/sign-in')).toBe(true);
        expect(hasDoublePrefix(pathnameOf(page))).toBe(false);
    });
});

/** `#RRGGBB` → the `rgb(r, g, b)` spelling a computed style uses. */
function rgb(hex: string): string {
    const [r, g, b] = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));

    return `rgb(${r}, ${g}, ${b})`;
}

/** A computed style property of an element. */
const computed = (locator: Locator, property: 'backgroundColor' | 'color'): Promise<string> =>
    locator.evaluate((element, name) => getComputedStyle(element)[name], property);

// The sign-in surface (`docs/design/uiOverhaul/buildSpec.md` §8): the front door, in three layouts, with the brand line.
test.describe('the sign-in surface', () => {
    test.beforeEach(async ({ page }) => {
        await setupClerkTestingToken({ page });
    });

    test('has one H1, the brand line under it, Google first and the sign-up link that is the only way to register', async ({
        page,
    }) => {
        await page.goto(route('/sign-in'));

        await expect(page.getByRole('heading', { level: 1, name: 'Sign in to Commise' })).toBeVisible();
        await expect(page.getByText('Your recipes, in one place.')).toBeVisible();
        await expect(page.getByRole('button', { name: /Continue with Google/ })).toBeVisible();
        await expect(page.getByRole('link', { name: 'Create an account' })).toBeVisible();
        await expect(page.getByText('New to Commise?')).toBeVisible();
    });

    test('puts Google above the email field', async ({ page }) => {
        await page.goto(route('/sign-in'));

        const google = await page.getByRole('button', { name: /Continue with Google/ }).boundingBox();
        const email = await page.getByRole('textbox', { name: /email/i }).boundingBox();

        expect(google?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(email?.y ?? 0);
    });

    test.describe('at 1280 px: a 50/50 split with a decorative photograph', () => {
        test.use({ viewport: { width: 1280, height: 800 } });

        test('shows the photograph on the start half, hidden from assistive technology, and a form of 400 px at most', async ({
            page,
        }) => {
            await page.goto(route('/sign-in'));
            const email = page.getByRole('textbox', { name: /email/i });

            await expect(email).toBeVisible();

            const photo = page.locator('main img[alt=""]');

            await expect(photo).toBeVisible();
            await expect(photo).toHaveAttribute('alt', '');
            expect(await photo.evaluate((image) => image.closest('[aria-hidden="true"]') !== null)).toBe(true);
            expect(((await photo.boundingBox())?.width ?? 0) >= 600).toBe(true);
            expect(((await email.boundingBox())?.width ?? Number.POSITIVE_INFINITY) <= 400).toBe(true);
            // F3 (`evaluateFinal.md`): the photo was a broken image, its `/images/…` request locale-redirected. It
            // decodes now: a broken image has no natural width.
            await expect
                .poll(() => photo.evaluate((image) => (image as HTMLImageElement).naturalWidth))
                .toBeGreaterThan(0);
        });
    });

    // F20: the fields are 48 px tall with a 12 px radius (§8), over Clerk's own 36 px cap, in both themes.
    for (const colorScheme of ['light', 'dark'] as const) {
        test.describe(`the ${colorScheme} theme at 390 px`, () => {
            test.use({ colorScheme, viewport: { width: 390, height: 844 } });

            test('draws the email field 48 px tall with a 12 px radius', async ({ page }) => {
                await page.goto(route('/sign-in'));
                const email = page.getByRole('textbox', { name: /email/i });

                await expect(email).toBeVisible();
                expect(Math.round((await email.boundingBox())?.height ?? 0)).toBe(48);
                expect(await email.evaluate((field) => getComputedStyle(field).borderTopLeftRadius)).toBe('12px');
            });
        });
    }

    test.describe('at 1023 px: no photograph, a 440 px card', () => {
        test.use({ viewport: { width: 1023, height: 800 } });

        test('hides the photograph and draws the form in a card no wider than 440 px', async ({ page }) => {
            await page.goto(route('/sign-in'));
            const email = page.getByRole('textbox', { name: /email/i });

            await expect(email).toBeVisible();
            await expect(page.locator('main img[alt=""]')).toBeHidden();
            expect(((await email.boundingBox())?.width ?? Number.POSITIVE_INFINITY) <= 440).toBe(true);
        });
    });

    test.describe('at 320 px: full-bleed, no card', () => {
        test.use({ viewport: { width: 320, height: 700 } });

        test('has a 272 px field column, no horizontal scroll, and a sign-up link on one line', async ({ page }) => {
            const photoRequests: string[] = [];

            page.on('request', (request) => {
                if (request.url().includes('authFood')) {
                    photoRequests.push(request.url());
                }
            });
            await page.goto(route('/sign-in'));
            const email = page.getByRole('textbox', { name: /email/i });

            await expect(email).toBeVisible();

            const width = (await email.boundingBox())?.width ?? 0;

            expect(width).toBeGreaterThanOrEqual(268);
            expect(width).toBeLessThanOrEqual(276);
            expect(
                await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
            ).toBeLessThanOrEqual(0);

            const link = await page.getByRole('link', { name: 'Create an account' }).boundingBox();

            // One line: a link that wrapped would be at least two line-heights tall (a 14 px line is ~20 px).
            expect(link?.height ?? Number.POSITIVE_INFINITY).toBeLessThan(32);
            // The photograph is `display: none` here, and a phone must not download it all the same.
            expect(photoRequests).toEqual([]);
        });
    });
});

// BOTH THEMES in a real browser: Clerk's styles sit in the `clerk` layer below the utilities, so the role classes on its
// elements win; the computed colours prove the layer order took effect (an unlayered Clerk would paint its own).
for (const [scheme, colors] of [
    ['light', role],
    ['dark', roleDark],
] as const) {
    test.describe(`the sign-in surface in the ${scheme} theme`, () => {
        test.use({ colorScheme: scheme, viewport: { width: 1280, height: 800 } });

        test('paints the canvas, the field, the primary button and the link from the scheme’s roles', async ({
            page,
        }) => {
            await setupClerkTestingToken({ page });
            await page.goto(route('/sign-in'));

            const email = page.getByRole('textbox', { name: /email/i });

            await expect(email).toBeVisible();
            expect(await computed(page.locator('body'), 'backgroundColor')).toBe(rgb(colors.canvas));
            expect(await computed(email, 'backgroundColor')).toBe(rgb(colors.paper));
            expect(await computed(email, 'color')).toBe(rgb(colors.ink));

            const primary = page.getByRole('button', { name: 'Continue', exact: true });
            expect(await computed(primary, 'backgroundColor')).toBe(rgb(colors.action));
            expect(await computed(primary, 'color')).toBe(rgb(colors.onAction));

            expect(await computed(page.getByRole('link', { name: 'Create an account' }), 'color')).toBe(
                rgb(colors.actionText),
            );
            expect(await computed(page.getByRole('heading', { level: 1 }), 'color')).toBe(rgb(colors.ink));
        });
    });
}
