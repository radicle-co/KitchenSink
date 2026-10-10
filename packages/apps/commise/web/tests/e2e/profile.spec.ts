import { role, roleDark } from '@commise/ui/colors';
import { makeUserProfileAccount, makeUserProfileUser } from '@commise/features-account/testing';
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

import { route } from './utils/basePath';
import { signInWithTicket } from './utils/auth';
import { mockRecipeApi, readViewerAppId } from './utils/recipeApi';

/**
 * The one Profile page (`docs/design/uiOverhaul/buildSpec.md` §9.1, slice 9). Settings and Account were folded into it,
 * so `/profile` is the whole of who the cook is, what they can change, how to leave, and the danger zone. The danger
 * zone's flows have their own spec (`accountDangerZone.spec.ts`), which ends the session and so must own it.
 *
 * Selectors are role/label only (repo policy); no `data-testid`, no `waitForTimeout`. Serial (Clerk-authed). The
 * identity service is mocked at the network edge (`mockRecipeApi` answers `GET /users/me`), and the display-name write
 * is captured so the spec can assert exactly what reaches the wire.
 *
 * ⚠️ DELETED: "the keyboard-shortcuts switch is on by default, turns off, and stays off after a reload (per device)". It
 * encoded the old per-device `localStorage` setting, which owner ruling D19 and ADR-0059 overturned: the setting now
 * lives on the identity service and follows the cook, not the browser. Its coverage moved to `profileSettings.spec.ts`
 * (on by default, saved to the server and kept across a reload, nothing in browser storage, a refused save), which
 * drives a stateful settings fake instead of browser storage. This spec keeps only the switch's presence on the page.
 */

/** `#RRGGBB` → the `rgb(r, g, b)` spelling a computed style uses. */
function rgb(hex: string): string {
    const [r, g, b] = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));

    return `rgb(${r}, ${g}, ${b})`;
}

/** A computed style property of an element. */
const computed = (locator: Locator, property: 'backgroundColor' | 'color'): Promise<string> =>
    locator.evaluate((element, name) => getComputedStyle(element)[name], property);

/** Sign in, mock the shell's reads, and open Profile. Returns the display-name writes the page sent. */
async function openProfile(
    page: Page,
    options: { readonly displayName?: string; readonly email?: string } = {},
): Promise<{ readonly patches: unknown[] }> {
    await signInWithTicket(page);
    const viewerId = await readViewerAppId(page);

    await mockRecipeApi(page, { viewerId });

    const patches: unknown[] = [];
    let displayName = options.displayName ?? 'Eliza Moreno';
    // Registered AFTER `mockRecipeApi` so it wins: it answers the identity profile with this spec's own cook, and
    // records the write.
    await page.route('**/api/v1/users/me', async (request) => {
        if (request.request().method() === 'PATCH') {
            const body = request.request().postDataJSON() as { displayName?: string };

            patches.push(body);
            displayName = body.displayName ?? displayName;
        }

        await request.fulfill({
            json: {
                user: makeUserProfileUser({ id: viewerId, displayName, email: options.email ?? 'eliza@example.com' }),
                account: makeUserProfileAccount({ userId: viewerId, subscriptionTier: 'premium' }),
            },
        });
    });

    await page.goto(route('/profile'));
    await expect(page.getByRole('heading', { level: 1, name: 'Profile' })).toBeVisible();

    return { patches };
}

test.describe('the Profile page inside the app shell (desktop)', () => {
    test.use({ viewport: { width: 1280, height: 900 } });

    test('mounts the sidebar around one Profile page that names itself in the document title', async ({ page }) => {
        await openProfile(page);

        await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
        await expect(page.getByRole('button', { name: 'Collapse' })).toBeVisible();
        await expect(page).toHaveTitle('Profile · Commise');
    });

    test('holds the cook, the preferences, sign out and the danger zone in one page', async ({ page }) => {
        await openProfile(page);

        await expect(page.getByText('eliza@example.com').first()).toBeVisible();
        await expect(page.getByRole('region', { name: 'Account' })).toBeVisible();
        await expect(page.getByRole('heading', { level: 2, name: 'Preferences' })).toBeVisible();
        await expect(page.getByRole('link', { name: /Food data sources/ })).toBeVisible();
        await expect(page.getByRole('switch', { name: 'Keyboard shortcuts' })).toBeVisible();
        // Never clicked here: signing out would end the shared session (`accountDangerZone.spec.ts` owns that).
        await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
        await expect(page.getByRole('heading', { level: 2, name: 'Danger zone' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Close account' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Erase my data' })).toBeVisible();
    });
});

test.describe('the display name', () => {
    test('opens the sheet on the saved name and writes only when Save is pressed', async ({ page }) => {
        const { patches } = await openProfile(page);

        await page.getByRole('button', { name: /Display name/ }).click();

        const dialog = page.getByRole('dialog', { name: 'What should we call you?' });
        const field = dialog.getByRole('textbox', { name: 'Display name' });

        await expect(field).toHaveValue('Eliza Moreno');

        await field.fill('Chef Eliza');
        expect(patches).toEqual([]);

        await dialog.getByRole('button', { name: 'Save' }).click();

        await expect.poll(() => patches).toEqual([{ displayName: 'Chef Eliza' }]);
        await expect(dialog).toBeHidden();
        await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
        await expect(page.getByRole('button', { name: /Display name/ })).toContainText('Chef Eliza');
    });

    // The field stops a name at the identity service's limit (100). Typed key by key, as a cook types: past the limit the
    // keys do nothing, and Save stays available for the name that fits instead of going quietly disabled.
    test('a name typed past the limit stops at the field, and Save still saves it', async ({ page }) => {
        const { patches } = await openProfile(page);

        await page.getByRole('button', { name: /Display name/ }).click();

        const dialog = page.getByRole('dialog', { name: 'What should we call you?' });
        const field = dialog.getByRole('textbox', { name: 'Display name' });

        await field.clear();
        await field.pressSequentially('a'.repeat(105));

        await expect(field).toHaveValue('a'.repeat(100));
        await dialog.getByRole('button', { name: 'Save' }).click();
        await expect.poll(() => patches).toEqual([{ displayName: 'a'.repeat(100) }]);
    });

    test('closing the sheet saves nothing', async ({ page }) => {
        const { patches } = await openProfile(page);

        await page.getByRole('button', { name: /Display name/ }).click();
        await page.getByRole('textbox', { name: 'Display name' }).fill('Never saved');
        await page.getByRole('button', { name: 'Close' }).click();

        expect(patches).toEqual([]);
        await expect(page.getByRole('button', { name: /Display name/ })).toContainText('Eliza Moreno');
    });
});

test.describe('the page at 320 CSS px', () => {
    test.use({ viewport: { width: 320, height: 800 } });

    test('has no horizontal scroll, even with one unbroken 60-character email', async ({ page }) => {
        await openProfile(page, { email: `${'a'.repeat(48)}@example.com` });

        const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );

        expect(overflow).toBeLessThanOrEqual(0);
    });
});

for (const [scheme, colors] of [
    ['light', role],
    ['dark', roleDark],
] as const) {
    test.describe(`the Profile page in the ${scheme} theme`, () => {
        test.use({ colorScheme: scheme });

        test('paints the canvas, the rows and the danger text from the scheme’s roles', async ({ page }) => {
            await openProfile(page);

            expect(await computed(page.locator('body'), 'backgroundColor')).toBe(rgb(colors.canvas));
            expect(await computed(page.locator('body'), 'color')).toBe(rgb(colors.ink));

            const display = page.getByRole('button', { name: /Display name/ });
            expect(await computed(display, 'color')).toBe(rgb(colors.ink));

            const danger = page.getByRole('button', { name: 'Close account' });
            expect(await computed(danger, 'color')).toBe(rgb(colors.dangerText));

            const signOut = page.getByRole('button', { name: 'Sign out' });
            expect(await computed(signOut, 'color')).toBe(rgb(colors.ink));
        });
    });
}
