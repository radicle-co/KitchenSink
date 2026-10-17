import { expect, test } from '@playwright/test';

import { mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';
import { mockFoodApi } from './utils/foodApi';
import { addStep, chooseCuisine, fillTimes, openNewRecipe, openRecipeEditor, setServings } from './utils/recipeEditor';

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
        await mockRecipeApi(page, { viewerId, paidFeatures: 'granted' });

        await openRecipeEditor(page, 'ec000000-0000-4000-8000-00000000002c');

        // The photo manager block starts empty, with an accessible "Photos" region.
        const photosRegion = page.getByRole('region', { name: 'Photos', exact: true });
        await expect(photosRegion).toBeVisible();
        await expect(photosRegion.getByText('No photo? This cover is used instead. Add one any time.')).toBeVisible();

        // Hand the file to the hidden <input type="file"> (named "Add photo"; the visible control is the
        // "Add photos" button that opens it, covered by its own case below).
        await page.getByLabel('Add photo').setInputFiles({
            name: 'ratatouille.png',
            mimeType: 'image/png',
            buffer: Buffer.from(TINY_PNG_BASE64, 'base64'),
        });

        // Busy affordance: visible for the duration of the mocked presign → S3 PUT → confirm sequence (the
        // mock delays the presign response so this is reliably observable, not a same-tick flash). The polite live
        // region has no accessible name of its own, so it is found by what it says.
        await expect(page.getByRole('status').filter({ hasText: 'Uploading photo' })).toBeVisible();

        // The confirmed photo renders (its accessible alt text carries its 1-based display order) and the
        // busy affordance clears once the sequence completes.
        await expect(page.getByRole('img', { name: 'Recipe photo 1' })).toBeVisible();
        await expect(page.getByRole('status').filter({ hasText: 'Uploading photo' })).toHaveCount(0);
    });

    /**
     * A-010 (buildSpec §7.7, SC 2.1.1): the add control is a real secondary button. It used to be a label around a
     * hidden input, which has no tab stop, so a keyboard user could not add a photo at all. This walks the page by
     * Tab until the button holds focus, opens the native file dialog with Enter, and finishes the upload through it.
     */
    test('Add photos is a button the keyboard reaches, and Enter opens the file dialog', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, { viewerId, paidFeatures: 'granted' });

        await openRecipeEditor(page, 'ec000000-0000-4000-8000-00000000002c');

        const photosRegion = page.getByRole('region', { name: 'Photos', exact: true });
        const addPhotos = photosRegion.getByRole('button', { name: 'Add photos' });
        await addPhotos.scrollIntoViewIfNeeded();
        await expect(addPhotos).toBeVisible();

        // Tab from the top of the page until the button takes focus: it is on the tab order, not only clickable.
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        let reached = false;

        for (let presses = 0; presses < 200 && !reached; presses += 1) {
            await page.keyboard.press('Tab');
            reached = await addPhotos.evaluate((element) => element === document.activeElement);
        }

        await expect(addPhotos).toBeFocused();

        const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Enter')]);
        expect(chooser.isMultiple()).toBe(true);
        await chooser.setFiles({
            name: 'ratatouille.png',
            mimeType: 'image/png',
            buffer: Buffer.from(TINY_PNG_BASE64, 'base64'),
        });

        await expect(photosRegion.getByRole('img', { name: 'Recipe photo 1' })).toBeVisible();
    });

    /**
     * A-010 / E6: the grid is two columns below 480 px of its own width, three from 480 and four from 600 (§7.7 asks for
     * three below 600: the per-tile menu now exists, but a 3-up tile at 390 is about 90 px and the layout that fits the 44 px menu button beside a failure badge is a visual check owed), and a failed tile's message
     * sits BELOW its image rather than over it. Five GIFs are rejected locally (no API is reached), so the grid has
     * five failed tiles to measure at two widths.
     */
    test('the grid has two columns narrow, three from 480 and four from 600, and a failure’s message sits under its image', async ({
        page,
    }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, { viewerId, paidFeatures: 'granted' });

        for (const width of [390, 1280]) {
            await page.setViewportSize({ width, height: 900 });
            await openRecipeEditor(page, 'ec000000-0000-4000-8000-00000000002c');

            const photosRegion = page.getByRole('region', { name: 'Photos', exact: true });
            await photosRegion.getByRole('button', { name: 'Add photos' }).scrollIntoViewIfNeeded();
            await page.getByLabel('Add photo').setInputFiles(
                ['a', 'b', 'c', 'd', 'e'].map((name) => ({
                    name: `${name}.gif`,
                    mimeType: 'image/gif',
                    buffer: Buffer.from('x'),
                })),
            );

            const tiles = photosRegion.getByRole('listitem');
            await expect(tiles).toHaveCount(5);

            const boxes = await Promise.all([0, 1, 2, 3, 4].map((index) => tiles.nth(index).boundingBox()));
            const first = boxes[0];
            const regionBox = await photosRegion.boundingBox();

            if (first === null || regionBox === null) {
                throw new Error('the photo grid has no box');
            }

            const perRow = boxes.filter((box) => box !== null && Math.abs(box.y - first.y) < 2).length;
            // Two-up below 480 px of the grid's own width (the per-tile menu that would make three-up fit is not built).
            expect(perRow).toBe(regionBox.width >= 600 ? 4 : regionBox.width >= 480 ? 3 : 2);

            // The message belongs to its tile and starts at or below the bottom of that tile's image.
            const image = tiles.first().getByRole('img');
            const message = tiles.first().getByText('That file type isn’t supported. Use a JPEG, PNG, or WebP photo.');
            const imageBox = await image.boundingBox();
            const messageBox = await message.boundingBox();

            if (imageBox === null || messageBox === null) {
                throw new Error('the failed tile has no image or message box');
            }

            expect(messageBox.y).toBeGreaterThanOrEqual(imageBox.y + imageBox.height - 1);
        }
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
        await mockRecipeApi(page, { viewerId, paidFeatures: 'granted' });

        await openRecipeEditor(page, 'ec000000-0000-4000-8000-00000000002c');

        const photosRegion = page.getByRole('region', { name: 'Photos', exact: true });
        await expect(photosRegion.getByText('No photo? This cover is used instead. Add one any time.')).toBeVisible();

        // Just over 5 MB — rejected locally without ever reaching the mocked presign endpoint.
        await page.getByLabel('Add photo').setInputFiles({
            name: 'huge.png',
            mimeType: 'image/png',
            buffer: Buffer.alloc(5 * 1024 * 1024 + 1),
        });

        // REQ-014 — the rejection names WHICH file (its own failed cell + `fileName`-scoped controls) and WHY.
        await expect(photosRegion.getByRole('alert', { name: 'Upload failed' })).toBeVisible();
        await expect(page.getByText('That photo is larger than 5 MB. Choose a smaller file.')).toBeVisible();
        await expect(photosRegion.getByRole('button', { name: 'Actions for huge.png' })).toBeVisible();

        // …and nothing was transmitted: no upload ever went in flight, and no photo was ever confirmed (the
        // confirmed grid cells are the ones with an indexed "Recipe photo N" image).
        await expect(page.getByRole('status').filter({ hasText: 'Uploading photo' })).toHaveCount(0);
        await expect(photosRegion.getByRole('img', { name: /Recipe photo/ })).toHaveCount(0);
    });

    test('a disallowed file type is rejected client-side, before any upload starts', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, { viewerId, paidFeatures: 'granted' });

        await openRecipeEditor(page, 'ec000000-0000-4000-8000-00000000002c');

        const photosRegion = page.getByRole('region', { name: 'Photos', exact: true });
        await expect(photosRegion.getByText('No photo? This cover is used instead. Add one any time.')).toBeVisible();

        await page.getByLabel('Add photo').setInputFiles({
            name: 'clip.gif',
            mimeType: 'image/gif',
            buffer: Buffer.from(TINY_PNG_BASE64, 'base64'),
        });

        await expect(photosRegion.getByRole('alert', { name: 'Upload failed' })).toBeVisible();
        await expect(page.getByText('That file type isn’t supported. Use a JPEG, PNG, or WebP photo.')).toBeVisible();
        await expect(photosRegion.getByRole('button', { name: 'Remove clip.gif' })).toBeVisible();

        await expect(page.getByRole('status').filter({ hasText: 'Uploading photo' })).toHaveCount(0);
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
        await mockRecipeApi(page, { viewerId, paidFeatures: 'granted' });

        await openRecipeEditor(page, 'ec000000-0000-4000-8000-00000000002c');

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

        await photosRegion.getByRole('button', { name: 'Actions for photo 1, the cover' }).click();
        await page.getByRole('menuitem', { name: 'Replace' }).click();

        // No file was chosen (the cancel case): the original photo is still the recipe's only photo, and the
        // replacement picker is present and empty rather than having consumed anything.
        await expect(page.getByLabel('Choose a replacement photo')).toBeAttached();
        await expect(photosRegion.getByRole('img', { name: /^Recipe photo/ })).toHaveCount(1);
        await expect(page.getByRole('img', { name: 'Recipe photo 1' })).toBeVisible();
    });

    test('picking a replacement swaps exactly one photo, once the new one is confirmed', async ({ page }) => {
        const photosRegion = await openEditorWithOnePhoto(page);
        const originalSrc = await page.getByRole('img', { name: 'Recipe photo 1' }).getAttribute('src');

        await photosRegion.getByRole('button', { name: 'Actions for photo 1, the cover' }).click();
        await page.getByRole('menuitem', { name: 'Replace' }).click();
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
 * Owner ruling 2026-10-17 (buildSpec §7.7 + Replace): each photo tile has ONE ⋯ menu button of at least 44 px (parity
 * audit G4, F3), and the menu reorders through the real `PATCH …/photos/reorder`. Measured at a phone width, where the
 * old ~24 px pills lived.
 */
test.describe('recipe photo tile menu (2026-10-17)', () => {
    async function openEditorWithTwoPhotos(page: import('@playwright/test').Page) {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, { viewerId, paidFeatures: 'granted' });
        await openRecipeEditor(page, 'ec000000-0000-4000-8000-00000000002c');

        for (const name of ['first.png', 'second.png']) {
            await page.getByLabel('Add photo').setInputFiles({
                name,
                mimeType: 'image/png',
                buffer: Buffer.from(TINY_PNG_BASE64, 'base64'),
            });
            await expect(
                page.getByRole('region', { name: 'Photos', exact: true }).getByRole('img', { name: /^Recipe photo/ }),
            ).toHaveCount(name === 'first.png' ? 1 : 2);
        }

        return page.getByRole('region', { name: 'Photos', exact: true });
    }

    test('the menu button is at least 44 px square at a phone width', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 900 });
        const photosRegion = await openEditorWithTwoPhotos(page);

        const box = await photosRegion.getByRole('button', { name: 'Actions for photo 2' }).boundingBox();

        expect(box?.width).toBeGreaterThanOrEqual(44);
        expect(box?.height).toBeGreaterThanOrEqual(44);
    });

    test('Move earlier puts the second photo first, making it the cover', async ({ page }) => {
        const photosRegion = await openEditorWithTwoPhotos(page);
        const secondSrc = await photosRegion.getByRole('img', { name: 'Recipe photo 2' }).getAttribute('src');

        await photosRegion.getByRole('button', { name: 'Actions for photo 2' }).click();
        await page.getByRole('menuitem', { name: 'Move earlier' }).click();

        await expect(photosRegion.getByRole('img', { name: 'Recipe photo 1' })).toHaveAttribute(
            'src',
            secondSrc as string,
        );
        await expect(photosRegion.getByRole('button', { name: 'Actions for photo 1, the cover' })).toBeVisible();
    });

    test('the cover cannot move earlier and the last photo cannot move later', async ({ page }) => {
        const photosRegion = await openEditorWithTwoPhotos(page);

        await photosRegion.getByRole('button', { name: 'Actions for photo 1, the cover' }).click();
        await expect(page.getByRole('menuitem', { name: 'Move earlier' })).toHaveAttribute('aria-disabled', 'true');
        await expect(page.getByRole('menuitem', { name: 'Set as cover' })).toHaveAttribute('aria-disabled', 'true');
        await page.keyboard.press('Escape');

        await photosRegion.getByRole('button', { name: 'Actions for photo 2' }).click();
        await expect(page.getByRole('menuitem', { name: 'Move later' })).toHaveAttribute('aria-disabled', 'true');
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

        // The checkpoint created the recipe: the URL names it (the new route's `?draft=` moves from the local ref to the
        // server id, through Next's own shallow update), and the manager is there.
        await expect(page).toHaveURL(/\/recipes\/new\?draft=(?!local)[^&#]+/u);
        await expect(photosRegion).toBeVisible();

        return photosRegion;
    }

    test('a photo added once the checkpoint has created the recipe is stored against its id, and it publishes', async ({
        page,
    }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, { viewerId, paidFeatures: 'granted' });
        await mockFoodApi(page);

        const photosRegion = await createByCheckpoint(page);
        // Once created, the new route's `?draft=` names the server id.
        const createdId = new URL(page.url()).searchParams.get('draft') ?? '';

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
        // Cuisine is required to publish (2026-10-13).
        await chooseCuisine(page);
        await page.getByRole('button', { name: 'Publish', exact: true }).click();

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
        await mockRecipeApi(page, { viewerId, paidFeatures: 'granted', failPhotoUploads: Number.MAX_SAFE_INTEGER });
        await mockFoodApi(page);

        await createByCheckpoint(page);
        await page.getByLabel('Add photo').setInputFiles({
            name: 'handover.png',
            mimeType: 'image/png',
            buffer: Buffer.from(TINY_PNG_BASE64, 'base64'),
        });

        await expect(page.getByRole('alert', { name: 'Upload failed' })).toBeVisible();
        await expect(page.getByRole('button', { name: /Retry upload of handover\.png/ })).toBeVisible();
        await expect(page).toHaveURL(/\/recipes\/new\?draft=(?!local)[^&#]+/u);
    });
});
