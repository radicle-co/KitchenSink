import { expect, test } from '@playwright/test';

import { route } from './utils/basePath';
import { makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';

/**
 * Concurrent-edit conflict resolution — the field-by-field MERGE path (T070 / FR-007c option c), driven end
 * to end through the real web UI with the recipe-service contract intercepted (`utils/recipeApi`). A recipe
 * seeded with a one-shot `concurrentEdit` makes the user's first save lose the optimistic-concurrency race
 * (a real `409 VERSION_CONFLICT`); the UI then presents both versions and the three FR-007c choices. This
 * spec exercises the third — merge — keeping the user's new title while pulling the other device's servings,
 * and asserts the server persisted that per-field composition (NOT last-write-wins) after a resubmit against
 * the fresh version. The keep-mine / use-theirs paths are covered by the container component tests. Owner
 * actions gate on the Clerk `external_id` claim, so the seed is owned by the live viewer. Selectors are
 * role/label only (repo policy).
 */
test.describe('recipe concurrent-edit merge (T070 / FR-007c)', () => {
    test('a 409 conflict resolves by merging field-by-field and re-submitting against the fresh version', async ({
        page,
    }) => {
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
            // Another device saves first (title + servings), bumping the recipe to v2 before the user's write.
            concurrentEdits: { rec_conflict: { title: 'Their Title', servings: 8 } },
        });

        // Load the edit form and change the title (the user's in-progress edit).
        await page.goto(route('/recipes/rec_conflict/edit'));
        await page.getByLabel('Title').fill('My Merged Title');

        // Saving loses the optimistic-concurrency race → the conflict view replaces the form.
        await page.getByRole('button', { name: 'Save changes' }).click();
        await expect(page.getByRole('heading', { name: 'This recipe changed while you were editing' })).toBeVisible();

        // Merge field-by-field: keep my title (default), pull the latest saved servings.
        await page.getByRole('button', { name: 'Merge field by field' }).click();
        await page.getByRole('radio', { name: 'Latest saved version: 8' }).check();
        await expect(page.getByRole('radio', { name: 'Your version: My Merged Title' })).toBeChecked();
        await page.getByRole('button', { name: 'Save merged version' }).click();

        // The merged write succeeds against the fresh version and navigates back to the detail.
        await expect(page.getByRole('heading', { name: 'My Merged Title' })).toBeVisible();

        // The server persisted the field-by-field merge — my title AND their servings, not one whole side.
        const persisted = store.get('rec_conflict');
        expect(persisted?.title).toBe('My Merged Title');
        expect(persisted?.servings).toBe(8);
    });
});
