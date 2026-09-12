import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { RecipeDetail } from '@kitchensink/recipe-core';

import { route } from './utils/basePath';
import { makeRecipeDetail, mockRecipeApi, readViewerAppId, type EnrichedConflictSeed } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';

/**
 * Concurrent-edit conflict resolution (FR-007c / T070 / W7 rebuild), driven end to end through the real web
 * UI with the recipe-service contract intercepted (`utils/recipeApi`). A recipe seeded with a one-shot
 * `enrichedConflicts` entry makes the user's save lose the optimistic-concurrency race (a real `409
 * VERSION_CONFLICT`, enriched with the W8-a.5 `server`/`base` `VersionConflictSide` sides); the rebuilt
 * `RecipeConflictView` then presents the per-side banner, the changed-only diff (markers + legend), the
 * three A/B/C option cards, and — for Option C — a per-element merge panel gated on an explicit selection.
 * This is the W7 REWRITE of the pre-rebuild spec: the old "Merge field by field" / "Save merged version" flow
 * asserted a 2-way `mine`/`theirs` model and stale button copy; this rewrite asserts the CURRENT
 * `versions/messages.ts` copy verbatim and exercises Options B and C against the new UI (`RecipeEditContainer`
 * → `useRecipeEditor` → `RecipeConflictView`). Owner actions gate on the Clerk `external_id` claim, so every
 * seed is owned by the live viewer. Selectors are role/label only (repo policy); the conflict view is a plain
 * in-page section (not a modal), so no dialog scoping is needed.
 *
 * The seeded recipe starts at `servings: 4` with title `'Original Title'`; the user edits the title to `'My
 * Merged Title'` (servings untouched) while `enrichedConflicts`' `serverChanges` bumps `servings` to `8` on
 * the OTHER device. That gives two independently-attributable changed fields — title (mine only) and
 * servings (theirs only) — so the changed-only diff panel has real, distinguishable rows without ever
 * touching `description`/`prepTimeMinutes`/`cookTimeMinutes`, which the panel must NOT show.
 */

/** Enter the conflict view: sign in, seed `rec_conflict`, edit its title, and lose the version race against
 *  `enrichedConflicts`. Returns the live store so a spec can assert what the resolution ultimately persisted. */
async function enterConflict(page: Page, conflictSeed: EnrichedConflictSeed): Promise<Map<string, RecipeDetail>> {
    await signInWithTicket(page);
    const viewerId = await readViewerAppId(page);
    const seed = makeRecipeDetail({
        id: 'rec_conflict',
        ownerId: viewerId,
        title: 'Original Title',
        servings: 4,
        currentVersion: 1,
    });
    const store = await mockRecipeApi(page, {
        viewerId,
        recipes: [seed],
        enrichedConflicts: { rec_conflict: conflictSeed },
    });

    await page.goto(route('/recipes/rec_conflict/edit'));
    await page.getByLabel('Title').fill('My Merged Title');
    // Publish is the action bar's FINAL-step primary. The seed is fully valid, so jump to Review (step 4) via
    // the rail — forward navigation is ungated even with the unsaved title edit — and publish to lose the race.
    await page.getByRole('button', { name: /Review:/ }).click();
    await expect(page.getByText('Step 4 of 4')).toBeVisible();
    await page.getByRole('button', { name: 'Publish' }).click();

    await expect(page.getByRole('heading', { name: 'This recipe changed while you were editing' })).toBeVisible();

    return store;
}

test.describe('recipe concurrent-edit conflict resolution (FR-007c / W7)', () => {
    test('the conflict shows the per-side banner and the changed-only diff (markers, Server before Yours)', async ({
        page,
    }) => {
        await enterConflict(page, { serverChanges: { servings: 8 } });

        // Per-side banner (X3): server side names its version and when it saved — mine has no version of its
        // own (never persisted). The banner's trailing ` on {device}` clause went with the 2026-08-26 owner
        // ruling; the `$` anchor is what keeps it from creeping back.
        await expect(page.getByText(/^Server version \(v2\): Saved \d+ minutes? ago$/u)).toBeVisible();
        await expect(page.getByText('Your version: local unsaved changes')).toBeVisible();

        // Changed-only diff (X1/X7): title (mine changed it) and servings (theirs changed it) — Server's
        // value rendered BEFORE Yours on each row.
        const diffPanel = page.getByRole('region', { name: 'Changed fields' });

        const titleRow = diffPanel.getByRole('listitem').filter({ hasText: 'Title' });
        await expect(titleRow.getByRole('img', { name: 'changed' })).toBeVisible();
        await expect(titleRow.getByText('Was: Original Title')).toBeVisible();
        await expect(titleRow.getByText('Latest saved version: Original Title')).toBeVisible();
        await expect(titleRow.getByText('Your version: My Merged Title')).toBeVisible();

        const servingsRow = diffPanel.getByRole('listitem').filter({ hasText: 'Servings' });
        await expect(servingsRow.getByRole('img', { name: 'changed' })).toBeVisible();
        await expect(servingsRow.getByText('Was: 4')).toBeVisible();
        await expect(servingsRow.getByText('Latest saved version: 8')).toBeVisible();
        await expect(servingsRow.getByText('Your version: 4')).toBeVisible();

        // Changed-ONLY: fields neither side touched (description, prep/cook time) never get a row.
        await expect(diffPanel.getByRole('listitem').filter({ hasText: 'Description' })).toHaveCount(0);
        await expect(diffPanel.getByRole('listitem').filter({ hasText: 'Prep time' })).toHaveCount(0);
        await expect(diffPanel.getByRole('listitem').filter({ hasText: 'Cook time' })).toHaveCount(0);

        // The marker legend explaining the glyph vocabulary.
        await expect(page.getByRole('list', { name: 'Legend' })).toBeVisible();
    });

    test('renders the three A/B/C option cards', async ({ page }) => {
        await enterConflict(page, { serverChanges: { servings: 8 } });

        await expect(page.getByRole('button', { name: 'Keep server version' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Overwrite with your version' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Merge manually' })).toBeVisible();
    });

    test('[A] Keep server discards the local changes with NO write and lands on the recipe detail', async ({
        page,
    }) => {
        const store = await enterConflict(page, { serverChanges: { servings: 8 } });

        // The other device's write already landed: the store holds the server side (v2, servings 8, the
        // server's title) at conflict time. Capturing it lets us prove Keep server writes NOTHING further.
        expect(store.get('rec_conflict')?.currentVersion).toBe(2);

        await page.getByRole('button', { name: 'Keep server version' }).click();

        // Lands on the recipe detail (OQ-1 / Task-6 discarded→detail wiring) showing the SERVER's title —
        // the local 'My Merged Title' edit was discarded, never persisted.
        await expect(page.getByRole('heading', { name: 'Original Title' })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'My Merged Title' })).toHaveCount(0);

        // No write happened: the stored recipe is byte-for-byte the server version from the conflict — its
        // `currentVersion` did NOT advance past v2 (a resubmit would have bumped it to v3 via `applyUpdate`)
        // and its title stayed the server's, proving Keep server is a pure discard, not a last-write-wins save.
        const persisted = store.get('rec_conflict');
        expect(persisted?.currentVersion).toBe(2);
        expect(persisted?.title).toBe('Original Title');
        expect(persisted?.servings).toBe(8);
    });

    test('"Discard and close" exits the conflict view WITHOUT saving, back to the recipe (wireframe gap #1)', async ({
        page,
    }) => {
        const store = await enterConflict(page, { serverChanges: { servings: 8 } });

        // The other device's write already landed (v2, servings 8) — capturing it proves the discard writes
        // NOTHING further, exactly like Option A, even though this is a DIFFERENT exit (the header control,
        // not one of the three A/B/C resolutions).
        expect(store.get('rec_conflict')?.currentVersion).toBe(2);

        await page.getByRole('button', { name: 'Discard and close' }).click();

        // Lands back on the recipe detail (reuses the SAME `status: 'discarded'` → detail-route wiring Option
        // A uses) showing the SERVER's title — the local 'My Merged Title' edit was never submitted.
        await expect(page.getByRole('heading', { name: 'Original Title' })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'My Merged Title' })).toHaveCount(0);

        const persisted = store.get('rec_conflict');
        expect(persisted?.currentVersion).toBe(2);
        expect(persisted?.title).toBe('Original Title');
        expect(persisted?.servings).toBe(8);
    });

    test('[B] Overwrite resubmits the draft as-is and lands on the recipe detail', async ({ page }) => {
        const store = await enterConflict(page, { serverChanges: { servings: 8 } });

        await page.getByRole('button', { name: 'Overwrite with your version' }).click();

        // Lands on the recipe detail (OQ-1) with the user's values persisted — including that Overwrite
        // discards the OTHER device's servings change too (mine wins WHOLESALE, not merged).
        await expect(page.getByRole('heading', { name: 'My Merged Title' })).toBeVisible();

        const persisted = store.get('rec_conflict');
        expect(persisted?.title).toBe('My Merged Title');
        expect(persisted?.servings).toBe(4);
    });

    test('[C] Merge gates Save on a selection, then persists the per-field composition', async ({ page }) => {
        const store = await enterConflict(page, { serverChanges: { servings: 8 } });

        await page.getByRole('button', { name: 'Merge manually' }).click();
        await expect(page.getByRole('heading', { name: 'Merge changes field by field' })).toBeVisible();

        // Gating (X5): no selection yet → Save is disabled, with an inline hint explaining why.
        const saveButton = page.getByRole('button', { name: 'Save merged version' });
        await expect(saveButton).toBeDisabled();
        await expect(page.getByText('Choose a value for at least one field to save the merged version.')).toBeVisible();

        // Pick the server's servings for this one field; title stays unselected (defaults to mine).
        await page.getByRole('radio', { name: 'Latest saved version: 8' }).check();
        await expect(saveButton).toBeEnabled();

        await saveButton.click();

        // Lands on the recipe detail with the PER-FIELD composition — my title AND their servings, not one
        // whole side (proving this is a genuine merge, not last-write-wins).
        await expect(page.getByRole('heading', { name: 'My Merged Title' })).toBeVisible();

        const persisted = store.get('rec_conflict');
        expect(persisted?.title).toBe('My Merged Title');
        expect(persisted?.servings).toBe(8);
    });

    test('a stale base (>10 versions behind) gates Overwrite on an explicit confirm', async ({ page }) => {
        await enterConflict(page, { serverChanges: { servings: 8 }, versionsAhead: 12 });

        const warning = page.getByRole('alert').filter({ hasText: 'far ahead of the version you started from' });
        await expect(warning).toBeVisible();

        const overwriteButton = page.getByRole('button', { name: 'Overwrite with your version' });
        await expect(overwriteButton).toBeDisabled();

        await page.getByRole('checkbox', { name: 'I understand — continue anyway' }).check();
        await expect(overwriteButton).toBeEnabled();
    });
});
