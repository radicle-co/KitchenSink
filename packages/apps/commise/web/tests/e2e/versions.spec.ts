import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { RecipeSnapshot } from '@kitchensink/recipe-core';

import { route } from './utils/basePath';
import {
    E2E_INGREDIENT_IDS,
    makeRecipeDetail,
    makeRecipeVersion,
    mockRecipeApi,
    readViewerAppId,
} from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';

/**
 * Recipe version-history happy paths (W6 Task 6, FR-007b) — preview, compare, and restore — driven through
 * the real web UI (Next dev server + Clerk session + `RecipeVersionsContainer`'s `useRecipeVersions`/
 * `useRecipe`/`useRestoreRecipeVersion` wiring) with the recipe-service HTTP contract intercepted
 * (`utils/recipeApi`, extended here to serve `GET .../versions`, `GET .../versions/{n}`, and
 * `POST .../versions/{n}/restore`). The real backend is covered separately by the recipe-service's own e2e +
 * k6 tiers. Selectors are role/label only (repo policy); no `data-testid`, no `waitForTimeout` — Preview and
 * Compare are Radix modal dialogs that `aria-hide` the page behind them, so every in-dialog assertion below
 * is scoped to `page.getByRole('dialog')`.
 *
 * Three seeded versions (newest-first in the DIFF sense, oldest-first in id order) give every assertion real
 * signal: v2 changes v1's TITLE only; v3 (current) changes v2's DESCRIPTION and an INGREDIENT (a quantity
 * bump on the same `ingredientId` — a modification, not an add/remove) — `servings`/times/steps stay IDENTICAL
 * across all three, so "Servings" never appears as a changed field and its absence is a real assertion, not
 * an accident of a sparse fixture.
 *
 * Requirement → test:
 * - The version list + row attribution/changed-fields summary (T069, W6 Task 2) → "lists versions newest
 *   attribution-first, marks the current version, and shows each row's changed-fields summary"
 * - FR-007b Preview (W6 Task 3) → "previews a past version's content and its changed-from-current summary"
 * - FR-007b Compare (W6 Task 4) → "compares two versions with the Diff Summary and changed-only fields"
 * - Restore (T069, W6 Task 5) → "restores a past version and the current version advances"
 */
const RECIPE_ID = 'rec_pasta';

const oliveOil = {
    id: 'ri_1',
    recipeId: RECIPE_ID,
    ingredientId: E2E_INGREDIENT_IDS.oliveOil,
    quantity: { kind: 'exact', value: 2 } as const,
    unit: 'tbsp',
    sortOrder: 1,
    ingredientName: 'Olive oil',
    isUserEntered: false,
};

const v1Snapshot: RecipeSnapshot = {
    version: 1,
    title: 'Weeknight Pasta',
    description: 'A fast pasta dinner.',
    steps: [{ id: 'step_1', recipeId: RECIPE_ID, stepNumber: 1, instruction: 'Boil water.' }],
    ingredients: [oliveOil],
    servings: 4,
    prepTimeMinutes: 10,
    cookTimeMinutes: 20,
};

// v2 changes v1's TITLE only — every other field (including the ingredient) is untouched.
const v2Snapshot: RecipeSnapshot = { ...v1Snapshot, version: 2, title: 'Weeknight Pasta with Garlic' };

// v3 (the current version) changes v2's DESCRIPTION and bumps the olive oil quantity — a MODIFIED ingredient
// (same `ingredientId`), not an add/remove — so Compare's Diff Summary reports Modified, never Added/Removed.
const v3Snapshot: RecipeSnapshot = {
    ...v2Snapshot,
    version: 3,
    description: 'A fast, comforting pasta dinner with roasted garlic.',
    ingredients: [{ ...oliveOil, quantity: { kind: 'exact', value: 3 } }],
};

const v1 = makeRecipeVersion({
    id: 'ver_1',
    recipeId: RECIPE_ID,
    versionNumber: 1,
    snapshot: v1Snapshot,
    editorHandle: 'chef_e2e',
    createdAt: '2026-01-01T00:00:00.000Z',
});
const v2 = makeRecipeVersion({
    id: 'ver_2',
    recipeId: RECIPE_ID,
    versionNumber: 2,
    snapshot: v2Snapshot,
    editorHandle: 'chef_e2e',
    deviceLabel: 'iPhone 15',
    createdAt: '2026-01-02T00:00:00.000Z',
});
const v3 = makeRecipeVersion({
    id: 'ver_3',
    recipeId: RECIPE_ID,
    versionNumber: 3,
    snapshot: v3Snapshot,
    editorHandle: 'chef_e2e',
    deviceLabel: 'MacBook Pro',
    createdAt: '2026-01-03T00:00:00.000Z',
});

/** Seed the mock with the recipe (`currentVersion: 3`, consistent with `v3`) and its 3-version history, and
 *  navigate to its version-history route. */
async function openVersionHistory(page: Page): Promise<void> {
    const viewerId = await readViewerAppId(page);
    const recipe = makeRecipeDetail({
        id: RECIPE_ID,
        ownerId: viewerId,
        title: v3Snapshot.title,
        description: v3Snapshot.description,
        servings: v3Snapshot.servings,
        prepTimeMinutes: v3Snapshot.prepTimeMinutes,
        cookTimeMinutes: v3Snapshot.cookTimeMinutes,
        totalTimeMinutes: v3Snapshot.prepTimeMinutes + v3Snapshot.cookTimeMinutes,
        currentVersion: 3,
    });
    await mockRecipeApi(page, {
        viewerId,
        recipes: [recipe],
        recipeVersions: { [RECIPE_ID]: [v1, v2, v3] },
    });

    await page.goto(route(`/recipes/${RECIPE_ID}/versions`));
    await expect(page.getByRole('heading', { name: 'Version history' })).toBeVisible();
}

test.describe('recipe version history (W6 Task 6)', () => {
    test('lists versions newest attribution-first, marks the current version, and shows each row’s changed-fields summary', async ({
        page,
    }) => {
        await signInWithTicket(page);
        await openVersionHistory(page);

        // v3 is the current version — marked, and not restorable.
        await expect(page.getByText('Current version')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Restore version 3' })).toHaveCount(0);

        // v2's row: `by @{handle} (from {device})` attribution, plus the changed-fields summary versus its
        // immediately-prior sibling (v1) — only the title differs between v1 and v2.
        await expect(page.getByText('by @chef_e2e (from iPhone 15)')).toBeVisible();
        await expect(page.getByText('Changed: Title')).toBeVisible();

        // v1 is the earliest version — nothing to diff against.
        await expect(page.getByText('Initial version')).toBeVisible();
    });

    test('previews a past version’s content and its changed-from-current summary', async ({ page }) => {
        await signInWithTicket(page);
        await openVersionHistory(page);

        await page.getByRole('button', { name: 'Preview version 1' }).click();

        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await expect(dialog.getByText('Version 1 Preview: Weeknight Pasta')).toBeVisible();
        await expect(dialog.getByText('A fast pasta dinner.', { exact: true })).toBeVisible();
        await expect(dialog.getByText('4', { exact: true })).toBeVisible();

        // v1 vs the CURRENT version (v3): the ingredient quantity differs (1 modified, singular "1
        // ingredient"), steps are identical (0, plural "0 steps").
        await expect(dialog.getByText('Changed from current: 1 ingredient, 0 steps')).toBeVisible();

        await page.getByRole('button', { name: 'Keep current version' }).click();
        await expect(page.getByRole('dialog')).toHaveCount(0);
    });

    test('compares two versions with the Diff Summary and changed-only fields', async ({ page }) => {
        await signInWithTicket(page);
        await openVersionHistory(page);

        await page.getByRole('checkbox', { name: 'Select version 2 to compare' }).click();
        await page.getByRole('checkbox', { name: 'Select version 3 to compare' }).click();

        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        // Newer (v3) vs older (v2) — the heading always reads "Compare v{newer} vs v{older}".
        await expect(dialog.getByText('Compare v3 vs v2')).toBeVisible();

        // v2 -> v3 changed the description (1 scalar) and modified the olive oil line (1) — no adds/removes.
        const diffSummary = dialog.getByRole('region', { name: 'Diff Summary' });
        await expect(diffSummary.getByText('Added: 0')).toBeVisible();
        await expect(diffSummary.getByText('Removed: 0')).toBeVisible();
        await expect(diffSummary.getByText('Modified: 2')).toBeVisible();

        // Changed-only fields render...
        await expect(dialog.getByText('Description', { exact: true })).toBeVisible();
        await expect(dialog.getByText('Ingredients', { exact: true })).toBeVisible();
        // ...and an UNCHANGED field (servings never differs across v1/v2/v3) is absent, not merely unhighlighted.
        await expect(dialog.getByText('Servings', { exact: true })).toHaveCount(0);

        await page.getByRole('button', { name: 'Close compare' }).click();
        await expect(page.getByRole('dialog')).toHaveCount(0);
    });

    test('restores a past version and the current version advances', async ({ page }) => {
        await signInWithTicket(page);
        await openVersionHistory(page);

        // Before restoring, v3 is current — not restorable.
        await expect(page.getByRole('button', { name: 'Restore version 3' })).toHaveCount(0);

        await page.getByRole('button', { name: 'Restore version 1' }).click();

        // A successful restore records a NEW, higher-numbered version and advances `currentVersion` past 3 —
        // observable as v3 losing its current status and becoming restorable again, once the container's
        // post-restore refetch of the version list lands.
        await expect(page.getByRole('button', { name: 'Restore version 3' })).toBeVisible();
    });
});
