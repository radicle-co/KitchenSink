import { expect, test } from '@playwright/test';

import { route } from './utils/basePath';
import { mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';

/**
 * Plan U9 — the ingredient PASTE-AND-REVIEW story, driven through the real Next dev server, a real Clerk
 * session and the real client hooks, with the recipe-service contract intercepted.
 *
 * ## What only this tier can prove
 *
 * The component suites render each leaf against a literal `ParseJobViewState`, and the hook suite drives a
 * stubbed client. Neither can see the three things that make this feature actually work in a browser:
 *
 *  1. **The dial reaches the surface.** `/recipes/parse` is a real route with a real auth gate, reached
 *     from a menu the FAB discloses — a chain no unit test spans.
 *  2. **The POLL actually advances the screen.** The mock answers `running` first and settles on the next
 *     poll, so this asserts the surface moves ON ITS OWN — no click, no reload. A component test can only
 *     assert that a state renders; only here can it be shown that the state CHANGES.
 *  3. **The URL carries the job.** A reload lands back on the same review, which is the whole reason the
 *     job id lives in the address and not in React state — and what makes the server's 24-hour TTL, its
 *     sweep and its `expired` state reachable at all.
 *
 * ⛔ Selectors are role/label/text only, and there is no `waitForTimeout` anywhere: every wait is on the
 * settled state itself, which is also the only honest way to assert a poll.
 */
test.describe('recipes — paste an ingredient list and review the parse (U9)', () => {
    test('pastes a list, watches it settle, and reviews the parsed lines', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, { viewerId, tier: 'premium', recipes: [] });

        await page.goto(route('/recipes'));

        // The dial DISCLOSES its destinations — U34's shape, whose stated purpose was that a second
        // destination costs a list entry. This is that second entry.
        await page.getByRole('button', { name: 'New recipe' }).click();
        await page.getByRole('menuitem', { name: 'Paste an Ingredient List' }).click();

        await expect(page.getByRole('heading', { name: 'Paste your ingredients' })).toBeVisible();

        // An empty field is the resting state: no complaint, and nothing to press.
        await expect(page.getByRole('button', { name: 'Read my ingredients' })).toBeDisabled();

        await page.getByLabel('Ingredient lines').fill('2 cups flour\n1 tsp salt');
        await expect(page.getByText('2 lines ready')).toBeVisible();

        await page.getByRole('button', { name: 'Read my ingredients' }).click();

        // ⛔ THE POLL, not a click: the mock answers `running` for the first GET and settles on the next.
        // Nothing below touches the page, so a surface that only rendered its first response fails here.
        await expect(page.getByRole('heading', { name: 'Your ingredients' })).toBeVisible();
        await expect(page.getByText('All done. Check anything marked below.')).toBeVisible();
        await expect(page.getByText('2 of 2 lines read')).toBeVisible();

        // The proposals a cook came for.
        await expect(page.getByRole('listitem', { name: 'Line 1' })).toContainText('2 cups flour');
        await expect(page.getByRole('listitem', { name: 'Line 2' })).toContainText('1 tsp salt');

        // ⛔ A settled job offers NO retry — it would provably re-drive nothing.
        await expect(page.getByRole('button', { name: 'Try the unfinished lines again' })).toHaveCount(0);
    });

    test('⛔ keeps the job at its own URL, so a reload resumes the review', async ({ page }) => {
        // This is what the server's 24-hour TTL is FOR. Holding the id in React state would discard it on a
        // refresh and make `expired` unreachable for every user.
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, { viewerId, tier: 'premium', recipes: [] });

        await page.goto(route('/recipes/parse'));
        await page.getByLabel('Ingredient lines').fill('2 cups flour');
        await page.getByRole('button', { name: 'Read my ingredients' }).click();

        await expect(page.getByRole('heading', { name: 'Your ingredients' })).toBeVisible();
        await expect(page).toHaveURL(/\/recipes\/parse\/[0-9a-f-]{36}$/);

        await page.reload();

        await expect(page.getByRole('heading', { name: 'Your ingredients' })).toBeVisible();
        await expect(page.getByRole('listitem', { name: 'Line 1' })).toContainText('2 cups flour');
    });

    test('re-drives the lines that did not go through, from a settling job', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, { viewerId, tier: 'premium', recipes: [], parseJob: { settlesAs: 'partial' } });

        await page.goto(route('/recipes/parse'));
        await page.getByLabel('Ingredient lines').fill('2 cups flour\n???');
        await page.getByRole('button', { name: 'Read my ingredients' }).click();

        // ⚠️ The settling sentence must NOT read as a flat failure: a `partial` job self-heals as its
        // in-flight messages land, so most of the time this is on screen the lines are still arriving.
        await expect(
            page.getByText('Some lines haven’t come back yet. They may still finish on their own'),
        ).toBeVisible();
        await expect(page.getByText('1 of 2 lines read')).toBeVisible();

        await page.getByRole('button', { name: 'Try the unfinished lines again' }).click();

        // The retry re-opens the work and the poll carries it the rest of the way.
        await expect(page.getByText('All done. Check anything marked below.')).toBeVisible();
        await expect(page.getByText('2 of 2 lines read')).toBeVisible();
    });

    test('edits a line and re-reads it, keeping the same job', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, { viewerId, tier: 'premium', recipes: [] });

        await page.goto(route('/recipes/parse'));
        await page.getByLabel('Ingredient lines').fill('2 cps flour');
        await page.getByRole('button', { name: 'Read my ingredients' }).click();

        await expect(page.getByRole('heading', { name: 'Your ingredients' })).toBeVisible();
        const jobUrl = page.url();

        await page.getByRole('button', { name: 'Edit line 1' }).click();
        await page.getByLabel('Corrected line').fill('2 cups flour');
        await page.getByRole('button', { name: 'Save and re-read' }).click();

        await expect(page.getByRole('listitem', { name: 'Line 1' })).toContainText('2 cups flour');
        // ⛔ The SAME job — an edit re-drives one line, it does not start over.
        expect(page.url()).toBe(jobUrl);
    });

    test('⛔ refuses an over-long line before any request, naming the line', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, { viewerId, tier: 'premium', recipes: [] });

        const created: unknown[] = [];
        page.on('request', (request) => {
            if (request.url().endsWith('/api/v1/recipe-parse-jobs') && request.method() === 'POST') {
                created.push(request.postDataJSON());
            }
        });

        await page.goto(route('/recipes/parse'));
        await page.getByLabel('Ingredient lines').fill(`2 cups flour\n${'x'.repeat(1001)}`);

        await expect(page.getByRole('alert')).toContainText('Line 2 is longer than 1000 characters');
        await expect(page.getByRole('button', { name: 'Read my ingredients' })).toBeDisabled();
        expect(created).toHaveLength(0);
    });

    test('⛔ tells a cook an expired job is over, and offers a fresh paste rather than a retry', async ({ page }) => {
        // The TTL is a day, so this is the state a cook meets after leaving the tab open overnight — the
        // exact scenario the id-in-the-URL exists to serve.
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, { viewerId, tier: 'premium', recipes: [], parseJob: { settlesAs: 'expired' } });

        await page.goto(route('/recipes/parse'));
        await page.getByLabel('Ingredient lines').fill('2 cups flour');
        await page.getByRole('button', { name: 'Read my ingredients' }).click();

        await expect(page.getByRole('alert')).toContainText('This list expired after 24 hours');
        await expect(page.getByRole('button', { name: 'Try the unfinished lines again' })).toHaveCount(0);

        await page.getByRole('button', { name: 'Start over' }).click();

        await expect(page.getByRole('heading', { name: 'Paste your ingredients' })).toBeVisible();
    });

    test('reports a job that is not the viewer’s as simply not found', async ({ page }) => {
        // The service answers `404` for a stranger's job and an absent one alike, so a `403`-shaped message
        // would confirm the id exists — exactly what that choice hides.
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, { viewerId, tier: 'premium', recipes: [] });

        await page.goto(route('/recipes/parse/00000000-0000-4000-8000-0000000000ff'));

        await expect(page.getByRole('alert')).toContainText('We couldn’t find that list.');
    });
});
