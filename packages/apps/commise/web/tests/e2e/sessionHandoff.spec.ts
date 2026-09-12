import { createClerkClient } from '@clerk/backend';
import { setupClerkTestingToken } from '@clerk/testing/playwright';
import { slotFor } from '@kitchensink/e2e-fixtures/testPool';
import { expect, test, type Page } from '@playwright/test';

import { isHome, isRoute, pathnameOf, route } from './utils/basePath';
import { signInWithTicket } from './utils/auth';
import { makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';

/**
 * A cook's cached recipes end with their session (ADR-0054), the web twin of mobile's `.maestro/sessionHandoff.yaml`.
 * Cook A reads their own PRIVATE recipe, signs out, and cook B signs in on the same browser; B's list must not show A's
 * recipe. On web this cannot fail first: a sign-out reloads the document, which empties the query cache by itself. It
 * guards the day a sign-out stops reloading.
 *
 * ⛔ FIXME, AND NOT RUN, until the pool gives a shard a SECOND web identity. `POOL_ROSTER.web` (`@kitchensink/e2e-fixtures`'
 * `testPool.ts`) declares one lane per shard, and borrowing another shard's lane would put two concurrent runs on one
 * user. The lane id below is a PROPOSED roster name, not an existing one; `slotFor` throws until a lane with it exists.
 * The peer sign-in below repeats `signInWithTicket`'s fresh path for a second address; it belongs in that helper as an
 * `email` option once the lane exists.
 *
 * The recipe service is the stubbed contract (`utils/recipeApi`), re-stubbed for each cook, so B's list can only show
 * A's recipe from the app's own cache.
 */
const PEER_LANE = 'webpeer01';

/**
 * Sign the peer identity in by ticket, as `signInWithTicket`'s fresh path signs the shard's own identity in.
 *
 * @param page - The page to authenticate.
 * @sideEffect Calls Clerk's Backend API and navigates.
 */
async function signInAsPeer(page: Page): Promise<void> {
    const secretKey = process.env['CLERK_SECRET_KEY'];

    if (!secretKey) {
        throw new Error('CLERK_SECRET_KEY is required for e2e auth');
    }

    const clerk = createClerkClient({ secretKey });
    const { data } = await clerk.users.getUserList({ emailAddress: [slotFor('web', PEER_LANE).email] });
    const userId = data[0]?.id;

    if (userId === undefined) {
        throw new Error(`test-pool lane ${PEER_LANE} is missing — run poolAdmin --apply`);
    }

    const { token } = await clerk.signInTokens.createSignInToken({ userId, expiresInSeconds: 600 });

    await setupClerkTestingToken({ page });
    await page.goto(`${route('/sign-in')}?__clerk_ticket=${token}`);
    await expect.poll(() => isHome(pathnameOf(page)), { timeout: 30_000 }).toBe(true);
}

test.describe('a cook’s cached recipes end with their session (ADR-0054)', () => {
    test.fixme(true, `needs a second web pool identity per shard (POOL_ROSTER.web lane '${PEER_LANE}')`);

    test('the next cook on the browser never sees the last cook’s private recipe', async ({ page }) => {
        test.slow();

        await signInWithTicket(page);
        const cookA = await readViewerAppId(page);
        await mockRecipeApi(page, {
            viewerId: cookA,
            recipes: [
                makeRecipeDetail({ id: 'rec_a', ownerId: cookA, title: 'A’s Private Lamb', visibility: 'private' }),
            ],
        });
        await page.goto(route('/recipes'));
        await expect(page.getByRole('button', { name: 'A’s Private Lamb' })).toBeVisible();

        await page.goto(route('/settings'));
        await page.getByRole('button', { name: 'Sign out of your account' }).click();
        await expect.poll(() => isRoute(pathnameOf(page), '/sign-in'), { timeout: 20_000 }).toBe(true);

        await page.unrouteAll({ behavior: 'ignoreErrors' });
        await signInAsPeer(page);
        const cookB = await readViewerAppId(page);
        await mockRecipeApi(page, { viewerId: cookB, recipes: [] });
        await page.goto(route('/recipes'));

        await expect(page.getByText('No recipes yet')).toBeVisible();
        await expect(page.getByText('A’s Private Lamb')).toHaveCount(0);
    });
});
