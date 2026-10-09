import { expect, test } from '@playwright/test';

import { mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';
import { mockFoodApi } from './utils/foodApi';
import { addStep, fillTimes, openNewRecipe, openRecipeEditor, setServings } from './utils/recipeEditor';

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
 * Slice 7: the edit route opens the one-page editor, whose "Photos & publish" section holds the photo manager. The
 * manager's own region is named "Photos", so it is matched exactly: the section's name contains the same word.
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

        await openRecipeEditor(page, 'rec_seed');

        // The photo manager block starts empty, with an accessible "Photos" region.
        const photosRegion = page.getByRole('region', { name: 'Photos', exact: true });
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

        await openRecipeEditor(page, 'rec_seed');

        const photosRegion = page.getByRole('region', { name: 'Photos', exact: true });
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

        await openRecipeEditor(page, 'rec_seed');

        const photosRegion = page.getByRole('region', { name: 'Photos', exact: true });
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
    /** Open the seeded recipe's editor and add one photo, returning the photo region. */
    async function openEditorWithOnePhoto(page: import('@playwright/test').Page) {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, { viewerId, tier: 'premium' });

        await openRecipeEditor(page, 'rec_seed');

        await page.getByLabel('Add photo').setInputFiles({
            name: 'original.png',
            mimeType: 'image/png',
            buffer: Buffer.from(TINY_PNG_BASE64, 'base64'),
        });
        await expect(page.getByRole('img', { name: 'Recipe photo 1' })).toBeVisible();

        return page.getByRole('region', { name: 'Photos', exact: true });
    }

    test('pressing Replace opens the picker but deletes nothing on its own', async ({ page }) => {
        const photosRegion = await openEditorWithOnePhoto(page);

        await photosRegion.getByRole('button', { name: 'Replace photo 1' }).click();

        // No file was chosen (the cancel case): the original photo is still the recipe's only photo, and the
        // replacement picker is present and empty rather than having consumed anything.
        await expect(page.getByLabel('Choose a replacement photo')).toBeAttached();
        await expect(photosRegion.getByRole('img', { name: /^Recipe photo/ })).toHaveCount(1);
        await expect(page.getByRole('img', { name: 'Recipe photo 1' })).toBeVisible();
    });

    test('picking a replacement swaps exactly one photo, once the new one is confirmed', async ({ page }) => {
        const photosRegion = await openEditorWithOnePhoto(page);
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
 * Photos on a NEW recipe (slice 7). REWRITTEN: the U33 handover (a pick held in draft state, flushed when Publish
 * minted an id, a "Recipe saved." notice and "Finish without the remaining photos") is retired. A photo's bytes cannot
 * live in the device draft (ADR-0057), so the photo manager appears once the recipe exists on the server, which is
 * its first checkpoint (a title, then a section change), and every upload goes against that real id.
 *
 * What the two cases below pin:
 *   - before the server create there is no photo manager, and after the checkpoint there is one;
 *   - a photo added then is stored against the MINTED id (re-opening the editor reads it back), and the recipe
 *     publishes with it;
 *   - an upload that cannot succeed is defined and surfaced, a per-file failure with its own Retry, and it does not
 *     move the cook off the editor.
 */
test.describe('recipe photo upload on a NEW recipe (slice 7)', () => {
    /** Open a new recipe, title it, and jump to Photos & publish: the checkpoint that creates it. */
    async function createByCheckpoint(page: import('@playwright/test').Page) {
        await page.setViewportSize({ width: 1280, height: 800 });
        await openNewRecipe(page);

        const photosRegion = page.getByRole('region', { name: 'Photos', exact: true });
        // ⛔ No recipe on the server yet, so nothing to upload against.
        await expect(photosRegion).toHaveCount(0);

        await page.getByLabel('Title').fill('Handover Ratatouille');
        await setServings(page, 4);
        await fillTimes(page, { prepMinutes: 15, cookMinutes: 30 });
        await page
            .getByRole('navigation', { name: 'Recipe sections' })
            .getByRole('link', { name: 'Photos & publish' })
            .click();

        // The checkpoint created the recipe: the URL is its edit address, and the manager is there.
        await expect(page).toHaveURL(/\/recipes\/[^/]+\/edit/u);
        await expect(photosRegion).toBeVisible();

        return photosRegion;
    }

    test('a photo added once the checkpoint has created the recipe is stored against its id, and it publishes', async ({
        page,
    }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, { viewerId, tier: 'premium' });
        await mockFoodApi(page);

        const photosRegion = await createByCheckpoint(page);
        const createdId = new URL(page.url()).pathname.split('/recipes/')[1]?.split('/')[0] ?? '';

        await page.getByLabel('Add photo').setInputFiles({
            name: 'handover.png',
            mimeType: 'image/png',
            buffer: Buffer.from(TINY_PNG_BASE64, 'base64'),
        });
        await expect(photosRegion.getByRole('img', { name: 'Recipe photo 1' })).toBeVisible();

        await page.getByRole('combobox', { name: 'Add an ingredient' }).fill('salt');
        await page
            .getByRole('group', { name: 'Food catalog' })
            .getByRole('option', { name: 'Salt', exact: true })
            .click();
        await addStep(page, 'Roast the vegetables.');
        await page.getByRole('button', { name: 'Publish' }).click();

        await expect(page).toHaveURL(new RegExp(`/recipes/${createdId}(?:\\?|$)`, 'u'));
        await expect(page.getByRole('heading', { name: 'Handover Ratatouille' })).toBeVisible();

        // …and the bytes really landed against the minted id: re-opening the editor reads the photo list back.
        await openRecipeEditor(page, createdId);
        await expect(
            page.getByRole('region', { name: 'Photos', exact: true }).getByRole('img', { name: 'Recipe photo 1' }),
        ).toBeVisible();
    });

    test('an upload that cannot succeed says so by name, offers Retry, and leaves the cook on the editor', async ({
        page,
    }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        // Every presign fails, so the upload can never be made to succeed — the state this case is about.
        await mockRecipeApi(page, { viewerId, tier: 'premium', failPhotoUploads: Number.MAX_SAFE_INTEGER });
        await mockFoodApi(page);

        await createByCheckpoint(page);
        await page.getByLabel('Add photo').setInputFiles({
            name: 'handover.png',
            mimeType: 'image/png',
            buffer: Buffer.from(TINY_PNG_BASE64, 'base64'),
        });

        await expect(page.getByRole('alert', { name: 'Upload failed' })).toBeVisible();
        await expect(page.getByRole('button', { name: /Retry upload of handover\.png/ })).toBeVisible();
        await expect(page).toHaveURL(/\/recipes\/[^/]+\/edit/u);
    });
});
