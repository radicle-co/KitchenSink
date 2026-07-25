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
 * — `mockRecipeApi` stubs the presign (`POST /v1/recipes/:id/photos/upload-url`), the direct-to-S3 `PUT`,
 * and the confirm (`POST /v1/recipes/:id/photos/confirm`) the hook drives in sequence, plus the photo list
 * (`GET /v1/recipes/:id/photos`) the container reads from. The real service + S3 integration is covered
 * separately by the recipe-service's own e2e/k6 tiers; this spec verifies the full UI integration: picking a
 * file drives the busy affordance for the duration of the (artificially delayed) presign call, then the
 * confirmed photo renders and the busy state resolves. Playwright IS this user story's integration test
 * (CLAUDE.md testing policy); the mobile equivalent is `.maestro/recipes/photos.yaml`.
 *
 * Selectors are role/label only (repo policy). Like its sibling specs, this authenticates through a real
 * Clerk session (`signInWithTicket`), so it needs `CLERK_SECRET_KEY` + the sandbox Clerk instance — it runs
 * in CI; whether it also runs locally depends on those secrets being present in the environment.
 *
 * w3/e8: the edit route now opens the 4-step wizard at step 1 (Basic); Photos is step 4, reached via the
 * step rail (forward navigation is never gated, only backward navigation while dirty is) rather than being
 * immediately on screen as it was on the old single-scroll form.
 *
 * Two further specs cover client-side pre-validation (REQ-011 size, REQ-012 MIME allowlist): an oversized
 * file and a disallowed MIME type are both rejected LOCALLY, before any presign call — the busy affordance
 * never appears and the grid stays on its empty state, proving the mocked API was never reached.
 */
test.describe('recipe photo upload (CP-6/P3)', () => {
    test('pick a photo → busy affordance → uploaded photo appears', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, { viewerId, tier: 'premium' });

        await page.goto(route('/recipes/rec_seed/edit'));
        // Jump straight to step 4 (Photos) via the rail.
        await page.getByRole('button', { name: /Photos:/ }).click();
        await expect(page.getByText('Step 4 of 4')).toBeVisible();

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
        await page.getByRole('button', { name: /Photos:/ }).click();
        await expect(page.getByText('Step 4 of 4')).toBeVisible();

        const photosRegion = page.getByRole('region', { name: 'Photos' });
        await expect(photosRegion.getByText('No photos yet.')).toBeVisible();

        // Just over 5 MB — rejected locally without ever reaching the mocked presign endpoint.
        await page.getByLabel('Add photo').setInputFiles({
            name: 'huge.png',
            mimeType: 'image/png',
            buffer: Buffer.alloc(5 * 1024 * 1024 + 1),
        });

        await expect(page.getByText('That photo is larger than 5 MB. Choose a smaller file.')).toBeVisible();
        await expect(page.getByRole('status', { name: 'Uploading photo' })).toHaveCount(0);
        await expect(photosRegion.getByText('No photos yet.')).toBeVisible();
    });

    test('a disallowed file type is rejected client-side, before any upload starts', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, { viewerId, tier: 'premium' });

        await page.goto(route('/recipes/rec_seed/edit'));
        await page.getByRole('button', { name: /Photos:/ }).click();
        await expect(page.getByText('Step 4 of 4')).toBeVisible();

        const photosRegion = page.getByRole('region', { name: 'Photos' });
        await expect(photosRegion.getByText('No photos yet.')).toBeVisible();

        await page.getByLabel('Add photo').setInputFiles({
            name: 'clip.gif',
            mimeType: 'image/gif',
            buffer: Buffer.from(TINY_PNG_BASE64, 'base64'),
        });

        await expect(page.getByText('That file type isn’t supported. Use a JPEG, PNG, or WebP photo.')).toBeVisible();
        await expect(page.getByRole('status', { name: 'Uploading photo' })).toHaveCount(0);
        await expect(photosRegion.getByText('No photos yet.')).toBeVisible();
    });
});
