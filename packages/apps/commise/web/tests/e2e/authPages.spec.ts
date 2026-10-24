import { role, roleDark } from '@commise/ui/colors';
import { test, expect } from '@playwright/test';
import type { Locator } from '@playwright/test';
import { setupClerkTestingToken } from '@clerk/testing/playwright';

import { route, isRoute, hasDoublePrefix, pathnameOf } from './utils/basePath';
import { clerkPrimarySubmit } from './utils/clerkForm';

// The auth pages must actually MOUNT the Clerk widget under a preview basePath (a bare shell with only
// the <title> is the classic "Clerk derives its path from the basePath-stripped pathname" failure),
// and cross-links between them must resolve with the basePath applied EXACTLY ONCE.
test.describe('auth pages render and cross-link under the preview basePath', () => {
    test('sign-in page mounts the Clerk widget, not a blank shell', async ({ page }) => {
        await setupClerkTestingToken({ page });
        await page.goto(route('/sign-in'));

        // W-15 (SC 2.4.2): "{page} · Commise", not the bare brand every route used to share.
        await expect(page).toHaveTitle('Sign in · Commise');
        await expect(page.getByRole('heading', { name: 'Sign in to Commise' })).toBeVisible();
        await expect(page.getByLabel(/email/i)).toBeVisible();
    });

    test('sign-up page mounts the Clerk widget, not a blank shell', async ({ page }) => {
        await setupClerkTestingToken({ page });
        await page.goto(route('/sign-up'));

        await expect(page).toHaveTitle('Create your account · Commise');
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
            const prompt = await page.getByText('New to Commise?').boundingBox();

            // One line: a link that wrapped would be at least two line-heights tall (a 14 px line is ~20 px).
            expect(link?.height ?? Number.POSITIVE_INFINITY).toBeLessThan(32);

            // W-17 (SC 1.4.10): the pair used to be two unbreakable words and ended 2 px past the card. Both halves
            // are on screen now — the lead-in may wrap, and the link drops to its own line if the pair does not fit.
            for (const box of [link, prompt]) {
                expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
                expect((box?.x ?? Number.POSITIVE_INFINITY) + (box?.width ?? 0)).toBeLessThanOrEqual(320);
            }

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

// A-004 / W-20: Clerk showed the API's own words for a bad identifier ("You have to use email address or username.",
// "Identifier is invalid."), which name a username the product does not offer. The app replaces the identifier field's
// errors (`lib/clerkLocalization`); every other error keeps Clerk's copy.
// The invalid-format key is OBSERVED (its words render in a live run); the empty-field key cannot be reached from
// this form (below). If the invalid case fails, read `errors[0].code` for that submit against the sandbox instance and
// correct the key in `clerkLocalization.ts` rather than loosening the assertion.
test.describe('the sign-in identifier errors', () => {
    test.beforeEach(async ({ page }) => {
        await setupClerkTestingToken({ page });
        await page.goto(route('/sign-in'));
    });

    /**
     * REWRITTEN after its first live run. Clerk's identifier field is `required`, so the BROWSER refuses an empty submit
     * (its own "fill out this field" bubble, which no DOM query sees) and Clerk is never asked: the
     * `form_param_nil__identifier` words cannot appear from this form. What the cook gets is that refusal, so this proves
     * it: the field reports a missing value, the step does not move on, and Clerk's username wording never shows.
     */
    test('refuses an empty submit in the browser, before Clerk is asked', async ({ page }) => {
        const signInAttempts: string[] = [];
        page.on('request', (request) => {
            if (request.method() === 'POST' && /\/v1\/client\/sign_ins/u.test(request.url())) {
                signInAttempts.push(request.url());
            }
        });
        const field = page.getByRole('textbox', { name: /email/i });

        await clerkPrimarySubmit(page).click();

        // The browser's refusal hands focus back to the empty required field; a submit that went through would not.
        await expect(field).toBeFocused();
        expect(await field.evaluate((element) => (element as HTMLInputElement).validity.valueMissing)).toBe(true);
        expect(signInAttempts).toEqual([]);
        // Clerk's own words for it name a username, which the product does not offer. (The field's LABEL still says
        // "or username" until the dashboard change of W-05, so only the error is looked for.)
        await expect(page.getByText(/You have to use email address or username/i)).toHaveCount(0);
    });

    test('asks for a valid email address when what was typed is not one', async ({ page }) => {
        const field = page.getByRole('textbox', { name: /email/i });
        await field.fill('not an email');
        await clerkPrimarySubmit(page).click();

        // The field's own error, linked to it (`aria-describedby`); Clerk also mirrors it into a polite live region, so
        // the words are on the page twice and the field is what says whose error it is.
        await expect(field).toHaveAccessibleDescription(/Enter a valid email address\./u);
        await expect(page.getByText(/Identifier is invalid/i)).toHaveCount(0);
    });
});
