import { expect, test } from '@playwright/test';

import { route } from './utils/basePath';
import { simulateOutage } from './utils/outage';
import { makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';

/**
 * A minimal, valid 1×1 transparent PNG — inlined so the spec needs no binary fixture file on disk (mirrors
 * `recipePhotos.spec.ts`'s fixture).
 */
const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function pngFile(name: string) {
    return { name, mimeType: 'image/png', buffer: Buffer.from(TINY_PNG_BASE64, 'base64') };
}

/**
 * Wizard-specific stories (w3/e8) NOT covered by the CRUD/conflict happy-path specs: Save-Draft-then-return
 * (a draft persists without publishing and is visible back on the list), Publish being blocked while a
 * NON-CURRENT step is still invalid (the rail flags the offending step, nothing is submitted), the discard
 * guard (Cancel with unsaved edits asks for confirmation before losing them), a failed background refetch of the
 * recipe leaving the wizard and its draft in place, and per-file photo upload
 * status (a queued/uploading pair rendered concurrently, plus a failed upload's Retry recovering it). Driven
 * through the real web UI with the recipe-service contract intercepted (`utils/recipeApi`); selectors are
 * role/label only (repo policy).
 */
test.describe('recipe edit wizard (w3/e8)', () => {
    test('Save Draft persists without publishing, and the draft is visible back on the list', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, { viewerId, tier: 'premium' });

        await page.goto(route('/recipes/new'));
        // Rail-scoped for the same reason `recipePhotos.spec.ts` is: a direct `goto` into this route can
        // briefly hold both the server-rendered wizard and its hydrated replacement, so a bare
        // `getByText('Step 1 of 4')` has two matches (one hidden) and trips strict mode. `getByRole` reads
        // the accessibility tree and cannot see the hidden copy.
        await expect(page.getByRole('navigation', { name: 'Recipe wizard steps' })).toContainText('Step 1 of 4');

        // Save Draft's floor is step 1 only (title/servings/times) — no ingredients/steps needed.
        //
        // ⚠️ REWRITTEN (this run): U32 PROMOTED Save Draft back out of the "More actions" overflow menu and
        // into the pinned action bar, at every width — the point of that ruling was that a phone user should
        // not have to go looking for it. `recipeWizardActionBar.spec.ts` asserts the other half (the menu
        // carries Cancel and NOT a second Save Draft), so driving it through the menu here would have been
        // asserting a control that must no longer exist.
        await page.getByLabel('Title').fill('E2E Weeknight Draft');
        await page.getByRole('button', { name: 'Save Draft' }).click();

        // A successful save (draft or publish) navigates to the new recipe's detail, same as Publish.
        await expect(page.getByRole('heading', { name: 'E2E Weeknight Draft' })).toBeVisible();

        // Back on the list, the recipe shows with its Draft badge — never silently published.
        await page.goto(route('/recipes'));
        const card = page.getByRole('article', { name: 'E2E Weeknight Draft' });
        await expect(card).toBeVisible();
        // `exact` so the status badge is matched, not the recipe title "E2E Weeknight Draft"
        // (which also contains "Draft" and would make this a strict-mode 2-element violation).
        await expect(card.getByText('Draft', { exact: true })).toBeVisible();
    });

    test('Publish is blocked while a non-current step is invalid; the rail flags it and nothing is submitted', async ({
        page,
    }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        const seed = makeRecipeDetail({
            id: 'rec_incomplete',
            ownerId: viewerId,
            title: 'Incomplete Recipe',
            ingredients: [],
            currentVersion: 1,
        });
        const store = await mockRecipeApi(page, { viewerId, recipes: [seed] });

        // The edit wizard opens at step 1 (Details), which is valid; step 2 (Ingredients) is empty/invalid.
        await page.goto(route('/recipes/rec_incomplete/edit'));
        await expect(page.getByText('Step 1 of 4')).toBeVisible();

        // Publish is the footer's FINAL-step primary (U6: no longer a top-bar action live on every step). Jump
        // to Review (step 4) via the rail — FORWARD navigation is ungated even with an invalid earlier step —
        // and attempt to publish from there.
        await page.getByRole('button', { name: /Review:/ }).click();
        await expect(page.getByText('Step 4 of 4')).toBeVisible();
        await page.getByRole('button', { name: 'Publish' }).click();

        // The rail flags the OTHER (non-current) invalid step; the blocked Publish neither navigated away from
        // the final step nor persisted anything — the version stays at its seeded value.
        await expect(page.getByRole('button', { name: /Ingredients: needs attention/ })).toBeVisible();
        await expect(page.getByText('Step 4 of 4')).toBeVisible();
        await expect(page).toHaveURL(/\/recipes\/rec_incomplete\/edit/);
        expect(store.get('rec_incomplete')?.currentVersion).toBe(1);
    });

    test('Cancel with unsaved edits asks for confirmation; discarding returns to the detail, unsaved', async ({
        page,
    }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, { viewerId, tier: 'premium' });

        await page.goto(route('/recipes/rec_seed/edit'));
        await page.getByLabel('Title').fill('An Unsaved Edit');

        // U6 chrome demoted Cancel off the header into the "More actions" overflow menu; it still routes through
        // the discard guard.
        await page.getByRole('button', { name: 'More actions' }).click();
        await page.getByRole('menuitem', { name: 'Cancel' }).click();
        await expect(page.getByRole('alertdialog', { name: 'Discard unsaved changes?' })).toBeVisible();

        await page.getByRole('button', { name: 'Discard changes' }).click();

        // Landed back on the detail, showing the ORIGINAL seeded title — the edit was never persisted.
        await expect(page).toHaveURL(/\/recipes\/rec_seed(?:\?|$)/);
        await expect(page.getByRole('heading', { name: 'Seed Recipe' })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'An Unsaved Edit' })).toHaveCount(0);
    });

    // ⛔ THE EDITOR SURVIVES A FAILED BACKGROUND REFETCH. The editor reads the recipe through a suspense boundary, and a
    // boundary that took a failed refetch for a failed load would swap the wizard for "We couldn’t load this recipe."
    // and throw the cook's draft away. The component suite forces the refetch by hand with retries off; only a browser
    // runs the path a cook takes: the tab regains focus, TanStack refetches the stale recipe, and the 503 exhausts the
    // real retry policy before the query settles in error over the data it already holds.
    test('a failed focus refetch of the recipe keeps the wizard and the draft, with no load error', async ({
        page,
    }) => {
        // Installed before navigation. The detail read is 30 s fresh and a focus refetch only runs for a stale query, so
        // the spec jumps the clock; time otherwise flows normally, which the 1 s + 2 s + 4 s retry backoff needs.
        await page.clock.install();
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, { viewerId, tier: 'premium' });
        const detailRead = /\/api\/v1\/recipes\/rec_seed(?:\?|$)/u;
        let failedDetailReads = 0;
        page.on('response', (response) => {
            if (response.request().method() === 'GET' && detailRead.test(response.url()) && response.status() >= 500) {
                failedDetailReads += 1;
            }
        });

        await page.goto(route('/recipes/rec_seed/edit'));
        await page.getByLabel('Title').fill('A Draft Kept Through An Outage');

        // Only the detail read fails; the photo read shares the prefix but not the path.
        await simulateOutage(page, detailRead);
        await page.clock.fastForward('00:31');
        // What a browser fires when the tab becomes visible again; TanStack's focus manager listens on `window`.
        await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));

        // The refetch plus three retries: the query has now settled in error, which is the state a wrong boundary
        // would render. Counting the responses is what proves the failure happened, since the page must show nothing.
        await expect.poll(() => failedDetailReads, { timeout: 15_000 }).toBe(4);

        // Nothing on this page appears on a refetch failure, so the absence needs an anchor: a rail jump makes React
        // render the wizard again AFTER the error reached the cache, rather than asserting before it could.
        //
        // ⛔ FORWARD only. A jump back to Details while the title is edited is backward navigation while dirty, which
        // the wizard's discard guard deliberately holds behind the modal "Discard unsaved changes?" dialog
        // (`Wizard.tsx` `guardIfBackward`, asserted by `Wizard.test.tsx`). The modal takes the rail out of the
        // accessibility tree, so a round trip back to step 1 fails on the guard, not on the boundary. Review is step 4
        // and reads the same draft, so it proves the draft survived without leaving the forward path.
        const rail = page.getByRole('navigation', { name: 'Recipe wizard steps' });
        await page.getByRole('button', { name: /Review:/ }).click();
        await expect(rail).toContainText('Step 4 of 4');

        const review = page.getByRole('region', { name: 'Review' });
        await expect(review.getByText('A Draft Kept Through An Outage', { exact: true })).toBeVisible();
        // Next's route announcer is also `role="alert"`, so the load error is named by its copy.
        await expect(page.getByRole('alert').filter({ hasText: 'We couldn’t load this recipe.' })).toHaveCount(0);
        await expect(page.getByRole('status', { name: 'Loading recipe' })).toHaveCount(0);
    });

    test('per-file photo status: a failed upload shows Retry and recovers; concurrent files show Queued + Uploading', async ({
        page,
    }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        // The FIRST presign call fails (one-shot) — the retry, and every upload after it, succeeds.
        await mockRecipeApi(page, { viewerId, tier: 'premium', failPhotoUploads: 1 });

        await page.goto(route('/recipes/rec_seed/edit'));
        // Jump to step 1 (Details) via the rail — photos are a FIELD of Details now, not a step (U33).
        await page.getByRole('button', { name: /Details:/ }).click();
        await expect(page.getByText('Step 1 of 4')).toBeVisible();

        const photosRegion = page.getByRole('region', { name: 'Photos' });
        await expect(photosRegion).toBeVisible();
        await expect(photosRegion.getByText('No photos yet.')).toBeVisible();

        // Pick one file — its upload fails (the one-shot budget), surfacing a per-file failed badge + Retry.
        await page.getByLabel('Add photo').setInputFiles(pngFile('failing-first.png'));
        await expect(page.getByRole('alert', { name: 'Upload failed' })).toBeVisible();
        const retry = page.getByRole('button', { name: /Retry upload of failing-first\.png/ });
        await expect(retry).toBeVisible();

        // Retry re-attempts the SAME file; the failure budget is exhausted, so it now succeeds and folds
        // into the confirmed photo grid.
        await retry.click();
        await expect(page.getByRole('img', { name: 'Recipe photo 1' })).toBeVisible();
        await expect(page.getByRole('alert', { name: 'Upload failed' })).toHaveCount(0);
        await expect(retry).toHaveCount(0);

        // Pick two more files in ONE selection: the queue drives uploads sequentially (single-flight), so
        // one shows Uploading… while the other is still Queued — both visible at once, proving the grid
        // renders per-file status rather than one coarse busy flag.
        await page.getByLabel('Add photo').setInputFiles([pngFile('second.png'), pngFile('third.png')]);
        await expect(page.getByRole('status', { name: 'Uploading…' })).toBeVisible();
        await expect(page.getByRole('status', { name: 'Queued' })).toBeVisible();

        // Both eventually confirm — three photos total (the recovered retry, plus these two).
        await expect(page.getByRole('img', { name: 'Recipe photo 2' })).toBeVisible();
        await expect(page.getByRole('img', { name: 'Recipe photo 3' })).toBeVisible();
        await expect(page.getByRole('status', { name: 'Queued' })).toHaveCount(0);
        await expect(page.getByRole('status', { name: 'Uploading…' })).toHaveCount(0);
    });
});
