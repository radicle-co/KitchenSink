# Offline writes — acceptance criteria for an unbuilt surface

> **Status: NOT A TEST.** This is the executable specification for the per-item offline write UI, held here
> until the surface exists. It was written as a Playwright spec BEFORE the UI, which is the right order — but
> a spec file under `tests/e2e/` that mocks its backend is classified `isMockedSpec` and runs in the
> `integration-web-playwright` job on **every PR across six shards**. Leaving it there would redden CI for a
> feature nobody has built yet.
>
> `test.fixme` was considered and rejected: it still counts as a test and proves nothing, which is a
> cover-up wearing a marker. Deleting it outright would lose the criteria. So it lives here, and the commit
> that registers the first recipe write with the queue moves it back verbatim.

## Where the coverage went

| Assertion                                                | Covered today by                                | Gap                                  |
| -------------------------------------------------------- | ----------------------------------------------- | ------------------------------------ |
| A write resolves offline without the sender being called | `syncProvider.test.tsx` (unit)                  | No browser-level proof               |
| Reconnect drains with no user action                     | `syncProvider.test.tsx` (unit)                  | No browser-level proof               |
| A restored queue drains at mount                         | `syncProvider.test.tsx` (unit, mutation-proven) | No device proof                      |
| Failure carries its item scope                           | `itemStatus.test.ts` (unit, mutation-proven)    | Not rendered anywhere yet            |
| Error renders ON the failing item                        | —                                               | **Uncovered: the UI does not exist** |
| Whole-recipe failure renders at page level               | —                                               | **Uncovered: the UI does not exist** |
| The draft survives a failure                             | —                                               | **Uncovered: the UI does not exist** |

The last three are the honest gap. They are the owner's error-proximity requirement, and nothing asserts them
until the surface is built.

## The spec, verbatim

```ts
/**
 * Offline writes, end to end in a real browser.
 *
 * ⛔ WRITTEN BEFORE THE UI EXISTS. These assert the owner's model rather than the current markup:
 *
 * > "think of offline mode as a pause mechanism before sending everything to the remote servers … we can
 * > optimistically show the recipe filled out as mutations happen, then provide feedback if any one item or
 * > the entire thing fails without causing them to loose their context … all offline is, is just a delay in
 * > sending that data and getting the mutation results."
 *
 * ⚠️ WEB DOES NOT PERSIST (owner ruling): the queue is in-memory, so these exercise a connectivity BLIP
 * within one session — which is the case web actually supports — and never a reload.
 *
 * ⚠️ `context.setOffline(true)` must be applied AFTER the page has loaded. Setting it before a navigation
 * fails the navigation itself rather than the API call, which tests the browser instead of the app.
 */
import { expect, test } from '@playwright/test';

import { route } from './utils/basePath';
import { makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';

const RECIPE_ID = 'rec_offline';

/** Sign in and seed one recipe the viewer owns. */
async function seed(page: import('@playwright/test').Page): Promise<void> {
    await signInWithTicket(page);
    const viewerId = await readViewerAppId(page);
    await mockRecipeApi(page, {
        viewerId,
        tier: 'premium',
        recipes: [makeRecipeDetail({ id: RECIPE_ID, ownerId: viewerId, title: 'Weeknight Pasta', currentVersion: 1 })],
    });
}

test.describe('offline writes — a pause, not a mode', () => {
    /**
     * ⛔ THE CENTRAL REQUIREMENT. The cook edits with no connection and the save RESOLVES: the editor reaches
     * its saved state and their work is on screen. No error, no spinner that never ends, no "you are offline
     * so this did not happen".
     */
    test('⛔ a save while offline succeeds from the cook’s point of view', async ({ page, context }) => {
        await seed(page);
        await page.goto(route(`/recipes/${RECIPE_ID}/edit`));
        await expect(page.getByRole('textbox', { name: /title/iu })).toBeVisible();

        await context.setOffline(true);
        await page.getByRole('textbox', { name: /title/iu }).fill('Edited While Offline');
        await page.getByRole('button', { name: /save/iu }).click();

        // The edit is on screen and the surface is not reporting a failure.
        await expect(page.getByRole('textbox', { name: /title/iu })).toHaveValue('Edited While Offline');
        await expect(page.getByRole('alert')).toHaveCount(0);
    });

    /** The cook is TOLD they are offline — the one thing the model says must be visible. */
    test('⛔ tells the cook they are offline, and what has not synced', async ({ page, context }) => {
        await seed(page);
        await page.goto(route(`/recipes/${RECIPE_ID}/edit`));
        await context.setOffline(true);
        await page.getByRole('textbox', { name: /title/iu }).fill('Edited While Offline');
        await page.getByRole('button', { name: /save/iu }).click();

        await expect(page.getByText(/offline/iu)).toBeVisible();
        await expect(page.getByText(/1 change|not synced|unsynced/iu)).toBeVisible();
    });

    /**
     * ⛔ RECONNECTING DRAINS WITH NO USER ACTION. If this required a button, offline would be a mode with a
     * recovery ritual rather than a delay.
     */
    test('⛔ syncs by itself when the connection returns', async ({ page, context }) => {
        await seed(page);
        await page.goto(route(`/recipes/${RECIPE_ID}/edit`));
        await context.setOffline(true);
        await page.getByRole('textbox', { name: /title/iu }).fill('Edited While Offline');
        await page.getByRole('button', { name: /save/iu }).click();
        await expect(page.getByText(/offline/iu)).toBeVisible();

        await context.setOffline(false);

        await expect(page.getByText(/offline/iu)).toBeHidden({ timeout: 15_000 });
    });
});

test.describe('failure feedback — as close to the failed item as possible', () => {
    /**
     * ⛔ ITEM-SCOPED. A rejected ingredient renders its error ON THAT ROW with a way forward, because a page
     * banner cannot tell a cook WHICH of twelve lines to fix.
     */
    test('⛔ shows a rejected ingredient’s error on the ingredient row', async ({ page }) => {
        await seed(page);
        await page.route('**/api/v1/ingredients', async (routed) => {
            await routed.fulfill({
                status: 422,
                contentType: 'application/json',
                body: JSON.stringify({ code: 'UNPROCESSABLE', message: 'not a recognised ingredient' }),
            });
        });

        await page.goto(route(`/recipes/${RECIPE_ID}/edit`));
        await page
            .getByRole('textbox', { name: /ingredient/iu })
            .first()
            .fill('gochujang');
        await page.getByRole('button', { name: /add/iu }).first().click();

        const row = page.getByRole('listitem').filter({ hasText: 'gochujang' });
        await expect(row.getByRole('alert')).toBeVisible();
        // A terminal refusal offers a way to CHANGE it, never a Retry that would fetch the same answer.
        await expect(row.getByRole('button', { name: /retry/iu })).toHaveCount(0);
    });

    /** ENTITY-SCOPED. A whole-recipe failure has no single row to blame, so it belongs to the page. */
    test('⛔ shows a whole-recipe failure at the page level', async ({ page }) => {
        await seed(page);
        await page.route(`**/api/v1/recipes/${RECIPE_ID}`, async (routed) => {
            if (routed.request().method() === 'PATCH') {
                await routed.fulfill({ status: 500, contentType: 'application/json', body: '{"code":"INTERNAL"}' });

                return;
            }

            await routed.fallback();
        });

        await page.goto(route(`/recipes/${RECIPE_ID}/edit`));
        await page.getByRole('textbox', { name: /title/iu }).fill('Will Fail');
        await page.getByRole('button', { name: /save/iu }).click();

        await expect(page.getByRole('alert')).toBeVisible();
        // ⛔ AND THE DRAFT SURVIVES — "without causing them to lose their context".
        await expect(page.getByRole('textbox', { name: /title/iu })).toHaveValue('Will Fail');
    });
});
```
