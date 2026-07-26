import { expect, test } from '@playwright/test';

import { route } from './utils/basePath';
import { makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';

/**
 * Recipe-list card parity (mockup-parity plan #2/#4), driven through the real web UI (Next dev server + Clerk
 * session + client hooks + TanStack Query) with the recipe-service HTTP contract intercepted
 * (`utils/recipeApi`). The real backend is covered separately by the recipe-service's own e2e + k6.
 *
 * #2 — every card renders a relative timestamp footer (CR-002 / recipe-list wireframe: "Edited 2d ago" /
 * "Created 1w ago"). The mock seeds a fixed, long-past `createdAt`/`updatedAt` (`utils/recipeApi`'s `ISO`), so
 * the exact elapsed amount drifts with wall-clock test time — this asserts the LABEL + unit pattern (`Created
 * {n}w ago`), not a pinned string, mirroring how the component tests pin the clock (unavailable here — no
 * clock control over the real Next dev server) while the unit-level `formatRelativeTime` boundary tests own
 * exact-value coverage.
 *
 * #4 — the "Quick (<30m)" time-bucket quick-filter chip narrows the list to recipes under 30 minutes,
 * client-side, alongside the existing dietary/cuisine chips (L4).
 *
 * Selectors are role/label only (repo policy). Serial (Clerk-authed).
 */
test.describe('recipe list — timestamp + quick-filter chip (#2/#4)', () => {
    test('shows a relative-timestamp footer and a working "Quick (<30m)" chip', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);

        // Two owned recipes: one under the 30-minute quick bucket, one over it — so the chip has something
        // to narrow. Both seed with equal createdAt/updatedAt (the mock's default `ISO`), so both cards read
        // "Created", not "Edited" (see `formatRelativeTime`'s CR-002 rule in `card/model.ts`).
        const quick = makeRecipeDetail({
            id: 'rec_quick',
            ownerId: viewerId,
            title: 'Overnight Oats',
            totalTimeMinutes: 5,
        });
        const slow = makeRecipeDetail({
            id: 'rec_slow',
            ownerId: viewerId,
            title: "Grandma's Pasta",
            totalTimeMinutes: 45,
        });
        await mockRecipeApi(page, { viewerId, tier: 'premium', recipes: [quick, slow] });

        await page.goto(route('/recipes'));
        await expect(page.getByRole('heading', { name: 'Recipes' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Overnight Oats' })).toBeVisible();
        await expect(page.getByRole('button', { name: "Grandma's Pasta" })).toBeVisible();

        // #2 — every card shows the relative-timestamp footer ("Created {n}{unit} ago").
        const oatsCard = page.getByRole('button', { name: 'Overnight Oats' });
        const pastaCard = page.getByRole('button', { name: "Grandma's Pasta" });
        await expect(oatsCard.getByText(/^Created \d+[mhdw] ago$/)).toBeVisible();
        await expect(pastaCard.getByText(/^Created \d+[mhdw] ago$/)).toBeVisible();

        // #4 — the Quick (<30m) chip appears (Overnight Oats qualifies) and narrows to only that recipe.
        const chips = page.getByRole('group', { name: 'Quick filters' });
        await expect(chips.getByRole('button', { name: 'Quick (<30m)' })).toBeVisible();

        await chips.getByRole('button', { name: 'Quick (<30m)' }).click();
        await expect(page.getByRole('button', { name: 'Overnight Oats' })).toBeVisible();
        await expect(page.getByRole('button', { name: "Grandma's Pasta" })).not.toBeVisible();

        // "All" restores the full list.
        await chips.getByRole('button', { name: 'All' }).click();
        await expect(page.getByRole('button', { name: "Grandma's Pasta" })).toBeVisible();
    });
});
