import { expect, test, type Page } from '@playwright/test';

import { ROLE_LANE_IDS, slotFor } from '@kitchensink/e2e-fixtures/testPool';

import { signInWithTicket } from './utils/auth';
import { route } from './utils/basePath';
import { deployedTargetOrigin } from './utils/deployedTarget';

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
 *
 * ⛔ It SKIPS when the run has no deployed target (`utils/deployedTarget.ts`), and the skip is not a pass. A local run
 * is not that target: its browser serves at a free port and asks the local stack, which admits a browser only from the
 * origin the stack is configured with, so every test used to wait 60 s for a `200` that could not come. The owner's
 * rulings (2026-09-05, 2026-10-03) say a DEPLOYED-target spec skips when its target is absent and is never re-pointed at
 * localhost. Mobile's `recipes/paidFeaturesByRole` flow checks the same rule, and it can run against the local stack.
 */
test.use({ storageState: { cookies: [], origins: [] } });

/** Sign in as the role's pool user and open the new-recipe editor; answer what identity said about paid features. */
async function openEditorAs(page: Page, role: keyof typeof ROLE_LANE_IDS): Promise<string> {
    await signInWithTicket(page, { force: true, email: slotFor('roles', ROLE_LANE_IDS[role]).email });

    // The wait starts once the editor's navigation has COMMITTED. Started before it, it matched the profile request of the
    // page being left (the signed-in Home), whose body is gone once the navigation lands: CI run 39438589869, web shard
    // 4, "Response body is not available for a response that was navigated away from". The editor asks for the profile
    // from its own scripts, which run only after the commit, and a page that was left answers nothing after it.
    await page.goto(route('/recipes/new'), { waitUntil: 'commit' });
    const profile = page.waitForResponse(
        (response) => new URL(response.url()).pathname.endsWith('/api/v1/users/me') && response.status() === 200,
    );
    const body = (await (await profile).json()) as { readonly account: { readonly paidFeatures: string } };

    await expect(page.getByRole('heading', { level: 1, name: 'New recipe' })).toBeVisible();

    return body.account.paidFeatures;
}

test.describe('paid features by role (deployed identity)', () => {
    test.skip(
        deployedTargetOrigin(process.env) === undefined,
        'No deployed target: PLAYWRIGHT_BASE_URL names no non-loopback origin, and this spec reads the DEPLOYED ' +
            'identity, so it is not run. A skip here proves nothing about paid features by role.',
    );

    for (const role of ['premium', 'vip', 'superuser'] as const) {
        test(`${role}: always granted — Private is a choice, with no count and no Pro badge`, async ({ page }) => {
            expect(await openEditorAs(page, role)).toBe('granted');

            await expect(page.getByRole('radio', { name: 'Private' })).toBeVisible();
            await expect(page.getByText('Pro', { exact: true })).toHaveCount(0);
            // Pro has no slot limit, so the server reports no count and none is shown (ADR-0073).
            await expect(page.getByText(/private slots left/u)).toHaveCount(0);
        });
    }

    for (const role of ['default', 'admin'] as const) {
        test(`⛔ ${role}: never granted — and Private is a slot, not Pro, whatever the stage’s gate says`, async ({
            page,
        }) => {
            const paidFeatures = await openEditorAs(page, role);

            expect(['upsell', 'hidden']).toContain(paidFeatures);

            // REWRITTEN for ADR-0073 (owner ruling 2026-10-26). This used to branch on the gate: the upsell showed a Pro
            // badge and a sheet, `hidden` showed no Private at all. A free cook now keeps up to the server's limit of
            // recipes private, so Private is offered in both, with the server's count; the limit is the server's, so it is
            // matched by shape. Choosing it saves nothing (the draft is not stored until a title is typed).
            await expect(page.getByText(/^\d+ of \d+ private slots left$/u)).toBeVisible();
            await page.getByRole('radio', { name: /^Private/u }).check();
            await expect(page.getByRole('radio', { name: /^Private/u })).toBeChecked();
            await expect(page.getByText('Pro', { exact: true })).toHaveCount(0);
            await expect(page.getByRole('dialog', { name: 'Keep more recipes private' })).toHaveCount(0);
            await expect(page.getByRole('dialog', { name: 'Private needs Pro for this recipe' })).toHaveCount(0);
        });
    }
});
