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
    test('shows a relative-timestamp footer and a working "Under 30 min" chip with its count', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);

        // Two owned recipes: one under the 30-minute quick bucket, one over it — so the chip has something
        // to narrow. Both seed with equal createdAt/updatedAt (the mock's default `ISO`), so both cards read
        // "Created", not "Edited" (see `formatRelativeTime`'s CR-002 rule in `card/model.ts`).
        const quick = makeRecipeDetail({
            id: 'ec000000-0000-4000-8000-00000000001d',
            ownerId: viewerId,
            title: 'Overnight Oats',
            totalTimeMinutes: 5,
        });
        const slow = makeRecipeDetail({
            id: 'ec000000-0000-4000-8000-00000000002f',
            ownerId: viewerId,
            title: "Grandma's Pasta",
            totalTimeMinutes: 45,
        });
        await mockRecipeApi(page, { viewerId, paidFeatures: 'granted', recipes: [quick, slow] });

        await page.goto(route('/recipes'));
        await expect(page.getByRole('heading', { name: 'Recipes' })).toBeVisible();
        await expect(page.getByRole('link', { name: 'Overnight Oats' })).toBeVisible();
        await expect(page.getByRole('link', { name: "Grandma's Pasta" })).toBeVisible();

        // #2 — every card shows the relative-timestamp footer ("Created {n}{unit} ago").
        const oatsCard = page.getByRole('article', { name: 'Overnight Oats' });
        const pastaCard = page.getByRole('article', { name: "Grandma's Pasta" });
        // Slice 4: the list view's row card carries the timestamp at the end of its status line.
        await expect(oatsCard.getByText(/^Created \d+[mhdw] ago$/)).toBeVisible();
        await expect(pastaCard.getByText(/^Created \d+[mhdw] ago$/)).toBeVisible();

        // #4 — the Quick (<30m) chip appears (Overnight Oats qualifies) and narrows to only that recipe.
        const chips = page.getByRole('group', { name: 'Quick filters' });
        await expect(chips.getByRole('button', { name: /^Under 30 min 1$/ })).toBeVisible();

        await chips.getByRole('button', { name: /^Under 30 min 1$/ }).click();
        await expect(page.getByRole('link', { name: 'Overnight Oats' })).toBeVisible();
        await expect(page.getByRole('link', { name: "Grandma's Pasta" })).not.toBeVisible();

        // "All" restores the full list.
        await chips.getByRole('button', { name: 'All' }).click();
        await expect(page.getByRole('link', { name: "Grandma's Pasta" })).toBeVisible();
    });
});

test.describe('recipe list chips — labels, clearing and untimed recipes (W-10, W-22, A-017)', () => {
    test('names a stored lower-case facet in sentence case, and matches it by its raw value', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, {
            viewerId,
            paidFeatures: 'granted',
            recipes: [
                makeRecipeDetail({
                    id: 'ec000000-0000-4000-8000-000000000041',
                    ownerId: viewerId,
                    title: 'Oat Bake',
                    dietaryFlags: ['dairy-free'],
                }),
            ],
        });

        await page.goto(route('/recipes'));
        const chips = page.getByRole('group', { name: 'Quick filters' });

        await expect(chips.getByRole('button', { name: /^Dairy-free/u })).toBeVisible();
        await chips.getByRole('button', { name: /^Dairy-free/u }).click();
        await expect(page.getByRole('link', { name: 'Oat Bake' })).toBeVisible();
    });

    test('a recipe with no stated time is not counted under "Under 30 min"', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, {
            viewerId,
            paidFeatures: 'granted',
            recipes: [
                makeRecipeDetail({
                    id: 'ec000000-0000-4000-8000-000000000042',
                    ownerId: viewerId,
                    title: 'Untimed Soup',
                    totalTimeMinutes: 0,
                }),
                makeRecipeDetail({
                    id: 'ec000000-0000-4000-8000-000000000043',
                    ownerId: viewerId,
                    title: 'Quick Toast',
                    totalTimeMinutes: 5,
                }),
            ],
        });

        await page.goto(route('/recipes'));

        await expect(
            page.getByRole('group', { name: 'Quick filters' }).getByRole('button', { name: /^Under 30 min 1$/u }),
        ).toBeVisible();
    });

    test('after Clear filters at 320, the selected "All" chip is back in view', async ({ page }) => {
        await page.setViewportSize({ width: 320, height: 700 });
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        const cuisines = ['Moroccan', 'Italian', 'Peruvian', 'Thai', 'Greek', 'Korean'];
        await mockRecipeApi(page, {
            viewerId,
            paidFeatures: 'granted',
            recipes: cuisines.map((cuisine, index) =>
                makeRecipeDetail({
                    id: `ec000000-0000-4000-8000-0000000000${String(50 + index)}`,
                    ownerId: viewerId,
                    title: `${cuisine} dish`,
                    cuisine,
                }),
            ),
        });

        await page.goto(route('/recipes'));
        const chips = page.getByRole('group', { name: 'Quick filters' });

        // Scroll the row to its far end and press a chip that exists only there, then search so nothing matches.
        await chips.getByRole('button', { name: /^Peruvian/u }).scrollIntoViewIfNeeded();
        await chips.getByRole('button', { name: /^Peruvian/u }).click();
        await page.getByRole('searchbox', { name: 'Search your recipes' }).fill('zzzz');
        await page.getByRole('button', { name: 'Clear filters' }).click();

        await expect(chips.getByRole('button', { name: 'All' })).toBeInViewport();
    });
});
