import { expect, test } from '@playwright/test';

import { route } from './utils/basePath';
import { makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';

/**
 * Interactive rating happy path (FR-013, scenarios 6, 7, 10) driven through the real web UI (Next dev server +
 * Clerk session + client hooks + TanStack Query) with the recipe-service HTTP contract intercepted
 * (`utils/recipeApi`, whose rating handler models the real per-user upsert + idempotent delete + the
 * recomputed aggregate). The real backend is covered separately by the recipe-service's own e2e + k6.
 *
 * The recipe under test is PUBLIC and owned by someone else, so the viewer may rate it (Sc8's own-recipe gate
 * is covered by the component + container tests, since the mock's viewer never owns this recipe). The flow
 * asserts the COMMUNITY aggregate the viewer sees — read-only social proof — updates through the write:
 *  - Sc6: an unrated recipe, rated 4, becomes "Rated 4.0 out of 5, 1 rating";
 *  - Sc7: re-rating 2 REPLACES (the count stays 1, the average reflects 2, not the mean of 4 and 2);
 *  - Sc10: removing the rating drops it back to "Not yet rated".
 *
 * Selectors are role/label only (repo policy); the aggregate is asserted on the accessible name of its star
 * image, so a control that faked an optimistic average or wired the wrong star value fails here. Serial
 * (Clerk-authed).
 */
test.describe('recipe rating (FR-013)', () => {
    test('rate → aggregate updates → re-rate replaces → remove', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);

        // A public recipe owned by another author, with NO ratings yet — the viewer can rate it.
        const recipe = makeRecipeDetail({
            id: 'rec_rate',
            ownerId: 'usr_author',
            title: 'Community Ramen',
            visibility: 'public',
            ratingCount: 0,
        });
        await mockRecipeApi(page, { viewerId, recipes: [recipe] });

        await page.goto(route('/recipes/rec_rate'));
        await expect(page.getByRole('heading', { level: 1, name: 'Community Ramen' })).toBeVisible();

        // Sc6 — starts unrated (an honest "not yet rated", never a 0-star score).
        await expect(page.getByText('Not yet rated')).toBeVisible();

        // Rate 4 stars → the community aggregate now includes it. `click` (not `check`): the star's checked
        // state is controlled by the viewer's own rating, which only settles after the write succeeds (an
        // optimistic bridge on `onSuccess`), so we assert the OUTCOME via the aggregate image below rather
        // than a synchronous checked state.
        await page.getByRole('radio', { name: 'Rate 4 stars' }).click();
        await expect(page.getByRole('img', { name: 'Rated 4.0 out of 5, 1 rating' })).toBeVisible();

        // Sc7 — re-rate 2: the count stays 1 and the average reflects 2 (a replace, not a second rating).
        await page.getByRole('radio', { name: 'Rate 2 stars' }).click();
        await expect(page.getByRole('img', { name: 'Rated 2.0 out of 5, 1 rating' })).toBeVisible();

        // Sc10 — remove: the rating stops contributing, back to unrated.
        await page.getByRole('button', { name: 'Remove my rating' }).click();
        await expect(page.getByText('Not yet rated')).toBeVisible();
    });
});
