import { peerSlotFor } from '@kitchensink/e2e-fixtures/testPool';
import { expect, test } from '@playwright/test';

import { isRoute, pathnameOf, route } from './utils/basePath';
import { signInWithTicket } from './utils/auth';
import { TEST_SLOT } from './utils/testUser';
import { makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';

/**
 * A cook's cached recipes end with their session (ADR-0054), the web twin of mobile's `.maestro/sessionHandoff.yaml`.
 * Cook A reads their own PRIVATE recipe, signs out, and cook B signs in on the same browser; B's list must not show A's
 * recipe. On web this cannot fail first: a sign-out reloads the document, which empties the query cache by itself. It
 * guards the day a sign-out stops reloading.
 *
 * Cook B is the shard's PEER (`peerSlotFor`, the `webPeer` tier of `@kitchensink/e2e-fixtures`' `testPool.ts`): a
 * second pool user that belongs to this shard alone, so two concurrent shards never share one. Owner decision
 * 2026-10-19 (plan 013 C4, matrix G18) gave the lane its password and removed the `test.fixme` this spec carried; run
 * `poolAdmin --apply` once so the peer exists. B signs in by ticket, as every web spec does, through
 * `signInWithTicket`'s `email` option.
 *
 * ⛔ THE ABSENCE OF A's RECIPE IS CHECKED WHILE B's OWN LIST READ IS HELD, and then again after it lands. Checked only
 * after B's list has rendered, the assertion would run once B's fresh read had replaced whatever the cache drew, and a
 * leak could never be seen (audit 2026-10-19, combative #4). The held read is issued by the hydrated container, whose
 * first render already holds any cached rows, so a leak is on screen by the time the request is held.
 *
 * The recipe service is the stubbed contract (`utils/recipeApi`), re-stubbed for each cook, so B's list can only show
 * A's recipe from the app's own cache.
 */
test.describe('a cook’s cached recipes end with their session (ADR-0054)', () => {
    test('the next cook on the browser never sees the last cook’s private recipe', async ({ page }) => {
        test.slow();

        await signInWithTicket(page);
        const cookA = await readViewerAppId(page);
        await mockRecipeApi(page, {
            viewerId: cookA,
            recipes: [
                makeRecipeDetail({
                    id: 'ec000000-0000-4000-8000-000000000001',
                    ownerId: cookA,
                    title: 'A’s Private Lamb',
                    visibility: 'private',
                }),
            ],
        });
        await page.goto(route('/recipes'));
        await expect(page.getByRole('article', { name: 'A’s Private Lamb' })).toBeVisible();

        await page.goto(route('/profile'));
        await page.getByRole('button', { name: 'Sign out' }).click();
        await expect.poll(() => isRoute(pathnameOf(page), '/sign-in'), { timeout: 20_000 }).toBe(true);

        await page.unrouteAll({ behavior: 'ignoreErrors' });
        // `force`: the signed-out context still holds Clerk's cookies, which the restored-session branch cannot tell
        // from a live session.
        await signInWithTicket(page, { force: true, email: peerSlotFor(TEST_SLOT).email });
        const cookB = await readViewerAppId(page);
        await mockRecipeApi(page, { viewerId: cookB, recipes: [] });

        // Hold B's list read, registered AFTER the stub so it runs first and hands the request on with `fallback()`.
        let releaseList: () => void = () => undefined;
        const listReleased = new Promise<void>((resolve) => {
            releaseList = resolve;
        });
        let markHeld: () => void = () => undefined;
        const listHeld = new Promise<void>((resolve) => {
            markHeld = resolve;
        });

        await page.route(
            (url) => url.pathname.endsWith('/api/v1/recipes'),
            async (intercepted) => {
                if (intercepted.request().method() !== 'GET') {
                    await intercepted.fallback();

                    return;
                }

                markHeld();
                await listReleased;
                await intercepted.fallback();
            },
        );

        await page.goto(route('/recipes'));
        await listHeld;

        // B's own data is NOT in yet: the only thing that could draw A's recipe now is the app's cache.
        await expect(page.getByText('A’s Private Lamb')).toHaveCount(0);

        releaseList();
        await expect(page.getByRole('heading', { level: 2, name: 'Your recipe box is empty' })).toBeVisible();
        await expect(page.getByText('A’s Private Lamb')).toHaveCount(0);
    });
});
