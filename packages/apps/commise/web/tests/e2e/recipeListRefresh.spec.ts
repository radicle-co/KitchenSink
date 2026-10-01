import { expect, test } from '@playwright/test';

import { route } from './utils/basePath';
import { simulateOutage } from './utils/outage';
import { makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';

/**
 * A failed REFRESH of the recipe list, driven through the real web UI (Next dev server + Clerk session + client
 * hooks) with the recipe-service HTTP contract intercepted (`utils/recipeApi`). Selectors are role/label only; no
 * `data-testid`, no `waitForTimeout`.
 *
 * The defect this pins: TanStack sets `isError` when a refetch fails over rows already loaded, and the list mapped
 * that to its full-page error, so a cook who switched tabs during a blip came back to "We couldn’t load your
 * recipes" in place of the recipes they were reading. The component tests prove the mapping over a fake client;
 * only a browser proves the whole path a cook takes: the tab regains focus → TanStack's focus manager refetches →
 * the 503 exhausts the retry policy → the rows stay and the notice appears → Try again recovers.
 *
 * ⛔ A FAKE CLOCK, installed before navigation. The list's `staleTime` is 30 s, and a focus refetch only runs for a
 * stale query, so the spec jumps the clock rather than waiting (`waitForTimeout` is banned). Time otherwise flows
 * normally, which the retry backoff needs.
 */
test.describe('recipe list — a failed refresh keeps the rows', () => {
    /** TanStack's default backoff over three retries (1 s + 2 s + 4 s), plus headroom for CI. */
    const REFRESH_FAILURE_TIMEOUT = 15_000;
    const REFRESH_NOTICE = 'We couldn’t refresh your recipes.';

    test('keeps the recipes on a failed focus refresh, says so, and Try again recovers', async ({ page }) => {
        await page.clock.install();
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, {
            viewerId,
            recipes: [makeRecipeDetail({ ownerId: viewerId, title: 'Weeknight Pasta' })],
        });

        await page.goto(route('/recipes'));
        const recipe = page.getByRole('button', { name: 'Weeknight Pasta' });
        await expect(recipe).toBeVisible();

        // Only the list read fails; `nutrition-batch` shares the prefix but not the path.
        const outage = await simulateOutage(page, /\/api\/v1\/recipes(?:\?|$)/);
        await page.clock.fastForward('00:31');
        // What a browser fires when the tab becomes visible again; TanStack's focus manager listens on `window`.
        await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));

        // The retry is described by the visible message; the same words also go to a visually hidden status
        // region for the announcement, so the button is the unambiguous anchor for both.
        const tryAgain = page.getByRole('button', { name: 'Try again' });
        await expect(tryAgain).toBeVisible({ timeout: REFRESH_FAILURE_TIMEOUT });
        await expect(tryAgain).toHaveAccessibleDescription(REFRESH_NOTICE);
        await expect(recipe).toBeVisible();
        await expect(page.getByText('We couldn’t load your recipes.')).toHaveCount(0);

        outage.end();
        await tryAgain.click();

        await expect(tryAgain).toHaveCount(0);
        await expect(recipe).toBeVisible();
        // The pressed button is gone, so focus lands on the heading rather than dropping to <body>.
        await expect(page.getByRole('heading', { level: 1, name: 'Recipes' })).toBeFocused();
    });
});
