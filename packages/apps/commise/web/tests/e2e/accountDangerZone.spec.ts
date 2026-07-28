import { expect, test } from '@playwright/test';
import { makeRecipeDetail } from '@kitchensink/recipe-core/testing';

import { hasDoublePrefix, isRoute, pathnameOf, route } from './utils/basePath';
import { mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';

/**
 * Account danger-zone happy path (CR-002 / U4b): the account page must present CLOSURE and ERASURE as two
 * DISTINCT, non-conflatable actions — closure recoverable, erasure irreversible — and drive the
 * phrase-gated, donate-election erasure end to end. Driven through the real web UI (Next dev server + Clerk
 * session + client hooks + routing) with the recipe-service HTTP contract intercepted (`utils/recipeApi`) so
 * the destructive erasure hits a MOCK, not the live backend; the real erasure worker is covered by the
 * recipe-service's own e2e. Selectors are role/label only (repo policy). Serial (Clerk-authed).
 */
test.describe('account danger zone — closure vs erasure (CR-002/U4b)', () => {
    test('presents closure as recoverable and drives the phrase-gated erasure with a donate election', async ({
        page,
    }) => {
        // Long by nature: a Clerk sign-in, the two-dialog danger-zone flow, and a post-sign-out landing on a
        // route Next dev may still have to compile — all in one user story that cannot be split.
        test.slow();

        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, {
            viewerId,
            tier: 'premium',
            recipes: [
                // Owner-only (private) — OFFERED in the donate election.
                makeRecipeDetail({
                    id: 'rec_priv',
                    ownerId: viewerId,
                    title: 'My Private Recipe',
                    visibility: 'private',
                }),
                // Already public + published — survives regardless, so it is NOT offered.
                makeRecipeDetail({ id: 'rec_pub', ownerId: viewerId, title: 'My Public Recipe', visibility: 'public' }),
            ],
        });

        // Intercept the erasure POST (registered AFTER mockRecipeApi so it wins) — mock the 202 so the test
        // account is never actually destroyed, and capture the body to assert the election reached the wire.
        let erasureBody: unknown;
        await page.route('**/v1/account/erasure', async (routeReq) => {
            erasureBody = routeReq.request().postDataJSON();
            await routeReq.fulfill({
                status: 202,
                contentType: 'application/json',
                body: JSON.stringify({ jobId: 'job_e2e', status: 'queued' }),
            });
        });

        await page.goto(route('/account'));
        await expect(page.getByRole('heading', { name: 'Account Settings' })).toBeVisible();

        // CLOSURE reads as recoverable — never "permanently deleted".
        await page.getByRole('button', { name: 'Close account' }).click();
        await expect(page.getByRole('alertdialog', { name: 'Close account?' })).toBeVisible();
        await expect(page.getByText(/not permanent deletion/i)).toBeVisible();
        await expect(page.getByText(/permanently deleted/i)).toHaveCount(0);
        await page.getByRole('button', { name: 'Cancel' }).click();

        // ERASURE reads as irreversible and explicitly distinct from closing.
        await page.getByRole('button', { name: 'Erase my data' }).click();
        const dialog = page.getByRole('dialog', { name: 'Erase my data' });
        await expect(dialog.getByText(/cannot be undone/i)).toBeVisible();
        await expect(dialog.getByText(/not the same as closing your account/i)).toBeVisible();

        // The donate election offers ONLY owner-only recipes.
        await expect(dialog.getByRole('checkbox', { name: 'My Private Recipe' })).toBeVisible();
        await expect(dialog.getByRole('checkbox', { name: 'My Public Recipe' })).toHaveCount(0);

        // The confirm is gated on the exact confirmation phrase.
        const confirm = dialog.getByRole('button', { name: 'Erase my data' });
        await expect(confirm).toBeDisabled();
        await dialog.getByRole('checkbox', { name: 'My Private Recipe' }).check();
        await dialog.getByLabel('Confirmation phrase').fill('ERASE MY DATA');
        await expect(confirm).toBeEnabled();
        await confirm.click();

        // The typed phrase + donate election reached the erasure endpoint…
        await expect
            .poll(() => erasureBody)
            .toEqual({
                confirmationPhrase: 'ERASE MY DATA',
                publishRecipeIds: ['rec_priv'],
            });

        // …and the viewer was signed out to the app's PUBLIC FRONT DOOR: `signOut({ redirectUrl: '/' })` lands
        // on the locale root, which bounces a signed-out caller to the sign-in form (`[locale]/page.tsx`).
        //
        // ⚠️ This assertion CHANGED MEANING, it was not merely relaxed. It used to pin the U8 branded welcome
        // hero and noted that /sign-in would be the wrong destination after erasure (the account is gone). The
        // owner deleted the welcome surface on 2026-07-28, so the app has exactly one signed-out destination
        // now and this flow shares it — the residual UX wrinkle (a just-erased user is shown a sign-in form for
        // an account that no longer exists) is a deliberate consequence of that decision, not a regression this
        // spec should hide. What still MUST hold is that nothing authenticated survives, asserted below.
        //
        // The pathname check also guards the double-prefix class (a redirect target manually prefixed AND run
        // through the prefix-aware router). Generous timeouts absorb Next dev's on-demand compilation.
        await expect.poll(() => isRoute(pathnameOf(page), '/sign-in'), { timeout: 20_000 }).toBe(true);
        await expect(page.getByRole('textbox', { name: /email/i })).toBeVisible({ timeout: 20_000 });
        await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);
        expect(hasDoublePrefix(pathnameOf(page))).toBe(false);
    });
});
