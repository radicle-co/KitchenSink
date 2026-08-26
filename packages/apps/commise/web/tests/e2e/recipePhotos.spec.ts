import { expect, test } from '@playwright/test';

import { route } from './utils/basePath';
import { mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';

/**
 * A minimal, valid 1×1 transparent PNG — inlined so the spec needs no binary fixture file on disk.
 * Playwright's `setInputFiles` accepts an in-memory `{ name, mimeType, buffer }` payload directly.
 */
const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

/**
 * Recipe photo upload happy path (CP-6/P3 photo-upload user story; the tier the `useRecipePhotoUpload`
 * headless hook + web `RecipePhotoUploaderContainer` were missing) driven through the real web UI (Next dev
 * server + Clerk session + client hooks + TanStack Query) with the recipe-service HTTP contract intercepted
 * — `mockRecipeApi` stubs the presign (`POST /api/v1/recipes/:id/photos/upload-url`), the direct-to-S3 `PUT`,
 * and the confirm (`POST /api/v1/recipes/:id/photos/confirm`) the hook drives in sequence, plus the photo list
 * (`GET /api/v1/recipes/:id/photos`) the container reads from. The real service + S3 integration is covered
 * separately by the recipe-service's own e2e/k6 tiers; this spec verifies the full UI integration: picking a
 * file drives the busy affordance for the duration of the (artificially delayed) presign call, then the
 * confirmed photo renders and the busy state resolves. Playwright IS this user story's integration test
 * (CLAUDE.md testing policy); the mobile equivalent is `.maestro/recipes/photos.yaml`.
 *
 * Selectors are role/label only (repo policy). Like its sibling specs, this authenticates through a real
 * Clerk session (`signInWithTicket`), so it needs `CLERK_SECRET_KEY` + the sandbox Clerk instance — it runs
 * in CI; whether it also runs locally depends on those secrets being present in the environment.
 *
 * w3/e8: the edit route opens the 4-step wizard at step 1 (Details), where the photo manager lives (U33) — reached via the
 * step rail (forward navigation is never gated, only backward navigation while dirty is) rather than being
 * immediately on screen as it was on the old single-scroll form.
 *
 * Two further specs cover client-side pre-validation (REQ-011 size, REQ-012 MIME allowlist): an oversized
 * file and a disallowed MIME type are both rejected LOCALLY, before any presign call. The rejected file is
 * ADMITTED STRAIGHT INTO the grid's `failed` state rather than vanishing — a deliberate design decision
 * documented in `useRecipePhotoUploadQueue` (validation is admission control: the item never transitions
 * through `queued`/`uploading`, so its bytes are never transmitted, while REQ-014 still gets to name WHICH
 * file failed and WHY). "The API was never reached" is therefore asserted by what did NOT happen — no
 * upload-in-flight affordance and no confirmed photo — not by the grid staying on its empty state.
 */
test.describe('recipe photo upload (CP-6/P3)', () => {
    test('pick a photo → busy affordance → uploaded photo appears', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, { viewerId, tier: 'premium' });

        await page.goto(route('/recipes/rec_seed/edit'));
        // Jump to step 1 (Details) via the rail — photos are a FIELD of Details now, not a step (U33).
        await page.getByRole('button', { name: /Details:/ }).click();
        await expect(page.getByText('Step 1 of 4')).toBeVisible();

        // The photo manager block starts empty, with an accessible "Photos" region.
        const photosRegion = page.getByRole('region', { name: 'Photos' });
        await expect(photosRegion).toBeVisible();
        await expect(photosRegion.getByText('No photos yet.')).toBeVisible();

        // Pick a file through the accessible "Add photo" control (a hidden <input type="file"> wrapped by
        // its visible label — getByLabel resolves it the same way a screen reader would).
        await page.getByLabel('Add photo').setInputFiles({
            name: 'ratatouille.png',
            mimeType: 'image/png',
            buffer: Buffer.from(TINY_PNG_BASE64, 'base64'),
        });

        // Busy affordance: visible for the duration of the mocked presign → S3 PUT → confirm sequence (the
        // mock delays the presign response so this is reliably observable, not a same-tick flash).
        await expect(page.getByRole('status', { name: 'Uploading photo' })).toBeVisible();

        // The confirmed photo renders (its accessible alt text carries its 1-based display order) and the
        // busy affordance clears once the sequence completes.
        await expect(page.getByRole('img', { name: 'Recipe photo 1' })).toBeVisible();
        await expect(page.getByRole('status', { name: 'Uploading photo' })).toHaveCount(0);
    });

    /**
     * Client-side pre-validation (REQ-011 size, REQ-012 MIME allowlist) — the guard `useRecipePhotoUploadQueue`
     * runs BEFORE a picked file ever reaches presign. Both cases below never touch the mocked recipe-service
     * API at all (no presign, no S3 PUT, no confirm): the busy affordance never appears and the photo grid
     * stays empty, because the file is rejected locally.
     */
    test('an oversized file is rejected client-side, before any upload starts', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, { viewerId, tier: 'premium' });

        await page.goto(route('/recipes/rec_seed/edit'));
        await page.getByRole('button', { name: /Details:/ }).click();
        await expect(page.getByText('Step 1 of 4')).toBeVisible();

        const photosRegion = page.getByRole('region', { name: 'Photos' });
        await expect(photosRegion.getByText('No photos yet.')).toBeVisible();

        // Just over 5 MB — rejected locally without ever reaching the mocked presign endpoint.
        await page.getByLabel('Add photo').setInputFiles({
            name: 'huge.png',
            mimeType: 'image/png',
            buffer: Buffer.alloc(5 * 1024 * 1024 + 1),
        });

        // REQ-014 — the rejection names WHICH file (its own failed cell + `fileName`-scoped controls) and WHY.
        await expect(photosRegion.getByRole('alert', { name: 'Upload failed' })).toBeVisible();
        await expect(page.getByText('That photo is larger than 5 MB. Choose a smaller file.')).toBeVisible();
        await expect(photosRegion.getByRole('button', { name: 'Remove huge.png' })).toBeVisible();

        // …and nothing was transmitted: no upload ever went in flight, and no photo was ever confirmed (the
        // confirmed grid cells are the ones with an indexed "Recipe photo N" image).
        await expect(page.getByRole('status', { name: 'Uploading photo' })).toHaveCount(0);
        await expect(photosRegion.getByRole('img', { name: /Recipe photo/ })).toHaveCount(0);
    });

    test('a disallowed file type is rejected client-side, before any upload starts', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, { viewerId, tier: 'premium' });

        await page.goto(route('/recipes/rec_seed/edit'));
        await page.getByRole('button', { name: /Details:/ }).click();
        await expect(page.getByText('Step 1 of 4')).toBeVisible();

        const photosRegion = page.getByRole('region', { name: 'Photos' });
        await expect(photosRegion.getByText('No photos yet.')).toBeVisible();

        await page.getByLabel('Add photo').setInputFiles({
            name: 'clip.gif',
            mimeType: 'image/gif',
            buffer: Buffer.from(TINY_PNG_BASE64, 'base64'),
        });

        await expect(photosRegion.getByRole('alert', { name: 'Upload failed' })).toBeVisible();
        await expect(page.getByText('That file type isn’t supported. Use a JPEG, PNG, or WebP photo.')).toBeVisible();
        await expect(photosRegion.getByRole('button', { name: 'Remove clip.gif' })).toBeVisible();

        await expect(page.getByRole('status', { name: 'Uploading photo' })).toHaveCount(0);
        await expect(photosRegion.getByRole('img', { name: /Recipe photo/ })).toHaveCount(0);
    });
});

/**
 * U6 "Replace", in a real browser: the control is upload-FIRST, so the photo being replaced survives until
 * its replacement has been confirmed. The two cases here are the pair that only an E2E can prove — that the
 * dedicated hidden replacement input is genuinely reachable from the Replace button, and that a Replace the
 * user does not follow through on leaves the original photo untouched (the old remove-then-add wiring
 * deleted it the moment Replace was pressed, so a cancelled picker destroyed it).
 *
 * The mobile equivalent lives in `.maestro/recipes/photos.yaml` (emulator/CI only).
 */
test.describe('recipe photo replace (U6)', () => {
    /** Open the wizard's Details step for the seeded recipe and add one photo, returning the photo region. */
    async function openDetailsStepWithOnePhoto(page: import('@playwright/test').Page) {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, { viewerId, tier: 'premium' });

        await page.goto(route('/recipes/rec_seed/edit'));
        await page.getByRole('button', { name: /Details:/ }).click();
        await expect(page.getByText('Step 1 of 4')).toBeVisible();

        await page.getByLabel('Add photo').setInputFiles({
            name: 'original.png',
            mimeType: 'image/png',
            buffer: Buffer.from(TINY_PNG_BASE64, 'base64'),
        });
        await expect(page.getByRole('img', { name: 'Recipe photo 1' })).toBeVisible();

        return page.getByRole('region', { name: 'Photos' });
    }

    test('pressing Replace opens the picker but deletes nothing on its own', async ({ page }) => {
        const photosRegion = await openDetailsStepWithOnePhoto(page);

        await photosRegion.getByRole('button', { name: 'Replace photo 1' }).click();

        // No file was chosen (the cancel case): the original photo is still the recipe's only photo, and the
        // replacement picker is present and empty rather than having consumed anything.
        await expect(page.getByLabel('Choose a replacement photo')).toBeAttached();
        await expect(photosRegion.getByRole('img', { name: /^Recipe photo/ })).toHaveCount(1);
        await expect(page.getByRole('img', { name: 'Recipe photo 1' })).toBeVisible();
    });

    test('picking a replacement swaps exactly one photo, once the new one is confirmed', async ({ page }) => {
        const photosRegion = await openDetailsStepWithOnePhoto(page);
        const originalSrc = await page.getByRole('img', { name: 'Recipe photo 1' }).getAttribute('src');

        await photosRegion.getByRole('button', { name: 'Replace photo 1' }).click();
        await page.getByLabel('Choose a replacement photo').setInputFiles({
            name: 'replacement.png',
            mimeType: 'image/png',
            buffer: Buffer.from(TINY_PNG_BASE64, 'base64'),
        });

        // The recipe still holds exactly ONE photo — but a different one: the replacement was confirmed
        // first, and only then was the original deleted.
        await expect(photosRegion.getByRole('img', { name: /^Recipe photo/ })).toHaveCount(1);
        await expect(page.getByRole('img', { name: 'Recipe photo 1' })).not.toHaveAttribute(
            'src',
            originalSrc as string,
        );
    });
});

/**
 * U33's actual NEW behaviour: picking a photo while the recipe does not exist yet, and the create→upload
 * handover that follows (owner ruling 2026-08-25).
 *
 * ⛔ **This block is ADDED coverage, not a rewrite — and its absence was a real gap.** Every case above drives
 * `/recipes/rec_seed/edit`, where the recipe already has an id, so the flush `RecipeCreateContainer` was built
 * for is degenerate there (it happens on the first render and is unobservable). The behaviour U33 actually
 * introduced — a pick recorded in DRAFT state, flushed the moment the create mutation returns an id — had no
 * browser-tier test at all, which is how the whole step-4 → step-1 move landed with a green unit suite.
 *
 * What the two cases below pin, straight from `RecipeCreateContainer`'s own contract:
 *   - the create path renders a real photo manager on step 1, NOT the old "Save this recipe first" notice;
 *   - a successful create does NOT navigate while a pick is still in flight — navigating would unmount the
 *     queue and lose the upload silently, which is the failure the seam exists to design away;
 *   - the cook is TOLD the recipe is already saved while that happens (`role="status"`);
 *   - when an upload cannot be made to succeed, the state is defined and surfaced — a per-file failure with
 *     its own Retry — and leaving is an explicit DECISION the cook takes, never an outcome handed to them.
 */
test.describe('recipe photo upload on the CREATE path (U33 handover)', () => {
    /** Fill the create wizard's four steps with a publishable recipe plus one photo, stopping on Review. */
    async function fillCreateWizardToReview(page: import('@playwright/test').Page): Promise<void> {
        await page.goto(route('/recipes/new'));

        // ⚠️ Scoped to the rail LANDMARK, not a bare `getByText`. On a direct `goto` into this route (rather
        // than the client-side navigation every other create spec uses) the server-rendered wizard and its
        // hydrated replacement briefly coexist, so for a few frames there are TWO `Step 1 of 4` paragraphs —
        // one of them hidden. `getByText` sees both and raises a strict-mode violation; `getByRole` reads the
        // accessibility tree, which excludes the hidden copy, so anchoring on the nav makes this
        // deterministic. Observed as a real flake on this exact line before it was scoped.
        await expect(page.getByRole('navigation', { name: 'Recipe wizard steps' })).toContainText('Step 1 of 4');
        await page.getByLabel('Title').fill('Handover Ratatouille');
        await page.getByLabel('Servings').fill('4');
        await page.getByLabel('Prep time (minutes)').fill('15');
        await page.getByLabel('Cook time (minutes)').fill('30');

        // ⛔ THE PRECONDITION THIS WHOLE BLOCK EXISTS FOR. Before U33 the create path rendered "Save this
        // recipe first — you can add photos from its edit page" where the manager should have been.
        const photosRegion = page.getByRole('region', { name: 'Photos' });
        await expect(photosRegion).toBeVisible();

        await page.getByLabel('Add photo').setInputFiles({
            name: 'handover.png',
            mimeType: 'image/png',
            buffer: Buffer.from(TINY_PNG_BASE64, 'base64'),
        });
        // The pick is held in DRAFT state — shown as queued, with nothing uploaded and nothing confirmed,
        // because there is no recipe id to upload it against yet.
        await expect(photosRegion.getByRole('status', { name: 'Queued' })).toBeVisible();
        await expect(photosRegion.getByRole('img', { name: /Recipe photo/ })).toHaveCount(0);

        await page.getByRole('button', { name: 'Next: Ingredients' }).click();
        await expect(page.getByText('Step 2 of 4')).toBeVisible();
        await page.getByRole('searchbox', { name: 'Search ingredients' }).fill('salt');
        await page.getByRole('button', { name: 'Salt', exact: true }).click();

        await page.getByRole('button', { name: 'Next: Instructions' }).click();
        await expect(page.getByText('Step 3 of 4')).toBeVisible();
        await page.getByRole('button', { name: 'Add step' }).click();
        await page.getByLabel('Step 1 instruction').fill('Roast the vegetables.');

        await page.getByRole('button', { name: 'Next: Review' }).click();
        await expect(page.getByText('Step 4 of 4')).toBeVisible();
    }

    test('a photo picked before the recipe exists is flushed once Publish mints an id', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, { viewerId, tier: 'premium' });

        await fillCreateWizardToReview(page);
        await page.getByRole('button', { name: 'Publish' }).click();

        // The recipe is already saved, and the cook is TOLD so while the upload finishes — the create does
        // not navigate out from under a queue that is still running. Observable rather than a same-tick
        // flash because the mock delays the presign by 200ms.
        await expect(page.getByRole('status').filter({ hasText: 'Recipe saved.' })).toBeVisible();

        // Navigation then happens on its own — and ONLY once nothing is left in flight. A queue item leaves
        // `visibleQueueItems` solely by reaching `ok`, so arriving here is itself proof the upload succeeded
        // rather than being abandoned (the sibling case below pins the failing half of that same gate).
        await expect(page).toHaveURL(/\/recipes\/[^/]+$/);
        await expect(page.getByRole('heading', { name: 'Handover Ratatouille' })).toBeVisible();

        // …and the bytes really landed against the MINTED id, not against the empty-string placeholder the
        // queue is constructed with before the create returns: re-opening the editor reads the recipe's photo
        // list back from the service and finds the confirmed photo.
        const createdId = new URL(page.url()).pathname.split('/recipes/')[1] as string;

        await page.goto(route(`/recipes/${createdId}/edit`));
        await expect(
            page.getByRole('region', { name: 'Photos' }).getByRole('img', { name: 'Recipe photo 1' }),
        ).toBeVisible();
    });

    test('a create that succeeds while its upload fails offers Retry and an explicit way to leave', async ({
        page,
    }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        // Every presign fails, so the upload can never be made to succeed — the state this case is about.
        await mockRecipeApi(page, { viewerId, tier: 'premium', failPhotoUploads: Number.MAX_SAFE_INTEGER });

        await fillCreateWizardToReview(page);
        await page.getByRole('button', { name: 'Publish' }).click();

        // DEFINED AND SURFACED: the recipe is saved, the cook is told so, the file that did not land says so
        // by name, and it can be retried. The half-state is never silent, and never presented as a failed save.
        await expect(page.getByRole('status').filter({ hasText: 'Recipe saved.' })).toBeVisible();
        await expect(page.getByRole('alert', { name: 'Upload failed' })).toBeVisible();
        await expect(page.getByRole('button', { name: /Retry upload of handover\.png/ })).toBeVisible();

        // ⛔ It has NOT navigated away — leaving with a photo unresolved has to be the cook's decision.
        await expect(page).toHaveURL(/\/recipes\/new/);

        await page.getByRole('button', { name: 'Finish without the remaining photos' }).click();

        await expect(page).toHaveURL(/\/recipes\/[^/]+$/);
        await expect(page.getByRole('heading', { name: 'Handover Ratatouille' })).toBeVisible();
    });
});
