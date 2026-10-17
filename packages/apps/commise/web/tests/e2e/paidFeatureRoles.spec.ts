import { expect, test, type Page } from '@playwright/test';

import { ROLE_LANE_IDS, slotFor } from '@kitchensink/e2e-fixtures/testPool';

import { signInWithTicket } from './utils/auth';
import { route } from './utils/basePath';

/**
 * The paid features by ROLE, against the real identity service (plan 2026-10-14-009 D12; owner ruling 2026-10-13: "tests
 * of premium features use DEFAULT users to verify they see only upsell flows, and premium/vip/superuser users to verify
 * they see premium flows"; owner ruling 2026-10-15: an ADMIN sees paid features as a default user does — superuser is
 * the admin who uses the whole app free).
 *
 * Signs in as the `roles` tier's users — one per role, provisioned by `poolAdmin` with their roles in signed
 * `public_metadata` — and reads what the deployed identity answers on `GET /api/v1/users/me`. Nothing here is mocked,
 * so it belongs to the DEPLOYED tier (`specTier.ts`), and nothing here WRITES: the `roles` users are read-only by the
 * pool's own rules (no lease, no reset — `POOL_TIERS` in `testPool.ts`). Opening the new-recipe editor saves nothing
 * until a title is typed, and no title is typed.
 *
 * ⚠️ The stage's gate is the OWNER's (both variables stay `false` until the owner flips them), so a default or admin
 * user's answer is `upsell` OR `hidden` here, and this spec asserts the UI that answer requires rather than assuming
 * one. The two gate-free invariants are asserted outright: a default or admin user is NEVER granted, an entitled user
 * ALWAYS is. Every state of every surface is pinned deterministically by `paidFeatureGate.spec.ts` over a stubbed
 * profile.
 *
 * Its own blank context per test (`SESSION_OWNING_SPECS`): it signs in as five different users.
 */
test.use({ storageState: { cookies: [], origins: [] } });

/** Sign in as the role's pool user and open the new-recipe editor; answer what identity said about paid features. */
async function openEditorAs(page: Page, role: keyof typeof ROLE_LANE_IDS): Promise<string> {
    await signInWithTicket(page, { force: true, email: slotFor('roles', ROLE_LANE_IDS[role]).email });

    const profile = page.waitForResponse(
        (response) => new URL(response.url()).pathname.endsWith('/api/v1/users/me') && response.status() === 200,
    );
    await page.goto(route('/recipes/new'));
    const body = (await (await profile).json()) as { readonly account: { readonly paidFeatures: string } };

    await expect(page.getByRole('heading', { level: 1, name: 'New recipe' })).toBeVisible();

    return body.account.paidFeatures;
}

test.describe('paid features by role (deployed identity)', () => {
    for (const role of ['premium', 'vip', 'superuser'] as const) {
        test(`${role}: always granted — Private is a choice, with no Premium badge`, async ({ page }) => {
            expect(await openEditorAs(page, role)).toBe('granted');

            await expect(page.getByRole('radio', { name: 'Private' })).toBeVisible();
            await expect(page.getByText('Premium', { exact: true })).toHaveCount(0);
        });
    }

    for (const role of ['default', 'admin'] as const) {
        test(`⛔ ${role}: never granted, and shows only what the stage’s gate allows`, async ({ page }) => {
            const paidFeatures = await openEditorAs(page, role);

            expect(['upsell', 'hidden']).toContain(paidFeatures);

            if (paidFeatures === 'upsell') {
                // Gate on: the upsell, and only the upsell — Private carries the Premium badge and opens the sheet.
                await expect(page.getByText('Premium', { exact: true })).toBeVisible();
                await page.getByRole('radio', { name: 'Private' }).click();
                await expect(page.getByRole('dialog', { name: 'Private recipes are part of Premium.' })).toBeVisible();
                await expect(page.getByRole('radio', { name: 'Public', includeHidden: true })).toBeChecked();
            } else {
                // Gate off: no paid feature and no upsell at all.
                await expect(page.getByText('Who can see it')).toBeVisible();
                await expect(page.getByRole('radio', { name: 'Private' })).toHaveCount(0);
                await expect(page.getByText('Premium', { exact: true })).toHaveCount(0);
            }
        });
    }
});
