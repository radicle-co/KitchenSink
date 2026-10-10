import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { RecipeSnapshot } from '@kitchensink/recipe-core';
import { role, roleDark } from '@commise/ui/colors';

import { route } from './utils/basePath';
import { simulateOutage } from './utils/outage';
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
const RECIPE_ID = 'ec000000-0000-4000-8000-000000000019';

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
    createdAt: '2026-01-02T00:00:00.000Z',
});
const v3 = makeRecipeVersion({
    id: 'ver_3',
    recipeId: RECIPE_ID,
    versionNumber: 3,
    snapshot: v3Snapshot,
    editorHandle: 'chef_e2e',
    createdAt: '2026-01-03T00:00:00.000Z',
});

/** Choose an entry from a version row's ⋯ menu. */
async function chooseRowAction(page: Page, version: number, label: string): Promise<void> {
    await page.getByRole('button', { name: `More actions for version ${String(version)}` }).click();
    await page.getByRole('menuitem', { name: label }).click();
}

/** Seed the mock with the recipe (`currentVersion: 3`, consistent with `v3`) and its 3-version history. */
async function seedVersionHistory(page: Page): Promise<void> {
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
}

/** Seed the recipe and its versions, navigate to its version-history route, and wait for the history. */
async function openVersionHistory(page: Page): Promise<void> {
    await seedVersionHistory(page);
    await page.goto(route(`/recipes/${RECIPE_ID}/versions`));
    await expect(page.getByRole('heading', { name: 'Version history' })).toBeVisible();
}

test.describe('recipe version history (W6 Task 6)', () => {
    test('lists versions newest attribution-first, marks the current version, and shows each row’s changed-fields summary', async ({
        page,
    }) => {
        await signInWithTicket(page);
        await openVersionHistory(page);

        // v3 is the current version — marked, with no ⋯ menu: nothing to restore or compare.
        await expect(page.getByText('Current version')).toBeVisible();
        await expect(page.getByRole('button', { name: 'More actions for version 3' })).toHaveCount(0);

        // v2's row: `by @{handle}` attribution, plus the changed-fields summary versus its immediately-prior
        // sibling (v1) — only the title differs between v1 and v2.
        //
        // ⚠️ REWRITTEN (this run), and the reason is the point. The ` (from {device})` half of the old
        // assertion went with the 2026-08-26 owner ruling that deleted device attribution — but that suffix
        // was also the only thing making each row's attribution text UNIQUE, so an unscoped
        // `getByText('by @chef_e2e')` became a 3-element strict-mode violation the moment it was dropped.
        // Scoping each claim to the row it is about is what the assertion always meant; it was passing on an
        // accident of the copy. Per-row scoping also makes this STRONGER than before — "Changed: Title" is
        // now pinned to v2 rather than to "somewhere on the page", so a summary rendered against the wrong
        // sibling would fail here instead of passing.

        // Scoped by the row's OWN title line ("Version 2 · Edited …"), anchored at its start so version 1 never
        // matches version 12.
        const rowFor = (version: number) =>
            page.getByRole('listitem').filter({ has: page.getByText(new RegExp(`^Version ${version} · Edited`, 'u')) });

        // All three rows carry the attribution — the property the old single assertion could only sample.
        await expect(page.getByText('by @chef_e2e')).toHaveCount(3);

        await expect(rowFor(2).getByText('by @chef_e2e')).toBeVisible();
        await expect(rowFor(2).getByText('Changed: Title')).toBeVisible();

        // v1 is the earliest version — nothing to diff against, so it gets the initial-version note and no
        // changed-fields summary at all.
        await expect(rowFor(1).getByText('Initial version')).toBeVisible();
        await expect(rowFor(1).getByText(/^Changed: /u)).toHaveCount(0);
    });

    test('previews a past version’s content and its changed-from-current summary', async ({ page }) => {
        await signInWithTicket(page);
        await openVersionHistory(page);

        await chooseRowAction(page, 1, 'Preview');

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

    test('compares a version with the current one, listing only what changed', async ({ page }) => {
        await signInWithTicket(page);
        await openVersionHistory(page);

        await chooseRowAction(page, 2, 'Compare with current');

        const dialog = page.getByRole('dialog', { name: 'Version 2 and the current version' });
        await expect(dialog).toBeVisible();
        // v2 -> v3 changed the description and the olive oil line; servings never differs, so it is absent.
        await expect(dialog.getByText('Description', { exact: true })).toBeVisible();
        await expect(dialog.getByText('Servings', { exact: true })).toHaveCount(0);

        await dialog.getByRole('button', { name: 'Close compare' }).click();
        await expect(page.getByRole('dialog')).toHaveCount(0);
    });

    test('restores a past version and the current version advances', async ({ page }) => {
        await signInWithTicket(page);
        await openVersionHistory(page);

        // Before restoring, v3 is current — no menu.
        await expect(page.getByRole('button', { name: 'More actions for version 3' })).toHaveCount(0);

        await chooseRowAction(page, 1, 'Restore this version');

        // A restore makes a new version, so it asks nothing and says so, with Undo (§6.6).
        await expect(page.getByText('Restored version 1.')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
        // It records a NEW, higher-numbered version and advances `currentVersion` past 3 — observable as v3 losing
        // its current status and gaining a menu, once the post-restore refetch of the version list lands.
        await expect(page.getByRole('button', { name: 'More actions for version 3' })).toBeVisible();
    });

    // The history suspends under ONE boundary, so its retry must reset the boundary AND the failed query and
    // issue a real second request. The wait is real: a `503` is what the shared retry policy retries (about
    // 7 s of TanStack's default backoff) before the boundary sees it.
    test('recovers from a failed history read when Try again succeeds', async ({ page }) => {
        await signInWithTicket(page);
        await seedVersionHistory(page);
        const outage = await simulateOutage(page, new RegExp(`/api/v1/recipes/${RECIPE_ID}/versions(?:\\?|$)`));

        await page.goto(route(`/recipes/${RECIPE_ID}/versions`));
        const loadError = page.getByRole('alert').filter({ hasText: 'We couldn’t load the version history.' });
        await expect(loadError).toBeVisible({ timeout: 15_000 });

        outage.end();
        await page.getByRole('button', { name: 'Try again' }).click();

        await expect(page.getByRole('heading', { name: 'Version history' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'More actions for version 1' })).toBeVisible();
    });
});

/**
 * Curated U15 (`docs/design/ingredientSpecialization.md` §S1): the version preview shows a variant-bound line's root
 * name with the dotted line under it, from the parts the version froze, and a root-bound line's name alone. The screen
 * never shows the parts as a comma-joined label; the cook's own comma-joined words on another line are the control.
 */
test.describe('version preview — a variant-bound line (curated U15)', () => {
    const BRISKET_RECIPE_ID = 'db000000-0000-4000-8000-0000000000c1';
    const line = (over: Partial<RecipeSnapshot['ingredients'][number]>) => ({
        ...oliveOil,
        recipeId: BRISKET_RECIPE_ID,
        ...over,
    });
    const brisketV1: RecipeSnapshot = {
        ...v1Snapshot,
        title: 'Braised Brisket',
        ingredients: [
            line({ id: 'ri_root', quantity: { kind: 'exact', value: 1 }, unit: 'lb', ingredientName: 'beef brisket' }),
            line({
                id: 'ri_variant',
                ingredientId: 'db000000-0000-4000-8000-0000000000c2',
                sortOrder: 2,
                quantity: { kind: 'exact', value: 2 },
                unit: 'lb',
                ingredientName: 'beef brisket',
                variantParts: [
                    { attribute: 'cut', text: 'flat half' },
                    { attribute: 'grade', text: 'select' },
                    { attribute: 'cookingMethod', text: 'braised' },
                ],
            }),
            line({
                id: 'ri_control',
                ingredientId: 'db000000-0000-4000-8000-0000000000c3',
                sortOrder: 3,
                displayText: 'flat half, select',
            }),
        ],
    };
    const brisketV2: RecipeSnapshot = { ...brisketV1, version: 2, description: 'Slow and low.' };

    test('previews the root name with the dotted line under it, and never a comma-joined label', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, {
            viewerId,
            recipes: [
                makeRecipeDetail({
                    id: BRISKET_RECIPE_ID,
                    ownerId: viewerId,
                    title: 'Braised Brisket',
                    currentVersion: 2,
                }),
            ],
            recipeVersions: {
                [BRISKET_RECIPE_ID]: [
                    makeRecipeVersion({
                        id: 'ver_b1',
                        recipeId: BRISKET_RECIPE_ID,
                        versionNumber: 1,
                        snapshot: brisketV1,
                    }),
                    makeRecipeVersion({
                        id: 'ver_b2',
                        recipeId: BRISKET_RECIPE_ID,
                        versionNumber: 2,
                        snapshot: brisketV2,
                    }),
                ],
            },
        });

        await page.goto(route(`/recipes/${BRISKET_RECIPE_ID}/versions`));
        await chooseRowAction(page, 1, 'Preview');

        const lines = page.getByRole('dialog').getByRole('listitem');
        const variant = lines.filter({ hasText: '2 lb beef brisket' });
        const root = lines.filter({ hasText: '1 lb beef brisket' });

        for (const part of ['flat half', 'select', 'braised']) {
            await expect(variant).toContainText(part);
        }

        await expect(variant).toContainText('flat half ·');
        await expect(variant).not.toContainText('flat half, select');
        await expect(root).not.toContainText('·');
        await expect(lines.filter({ hasText: 'Olive oil' })).toContainText('flat half, select');
    });
});

/** `#RRGGBB` → the `rgb(r, g, b)` spelling a computed style uses. */
function rgb(hex: string): string {
    const [r, g, b] = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));

    return `rgb(${r}, ${g}, ${b})`;
}

for (const [scheme, colors] of [
    ['light', role],
    ['dark', roleDark],
] as const) {
    test.describe(`the version history in the ${scheme} theme (D15)`, () => {
        test.use({ colorScheme: scheme });

        test('paints the page and its rows from the scheme’s roles', async ({ page }) => {
            await signInWithTicket(page);
            await openVersionHistory(page);

            const title = page.getByText(/^Version 2 · Edited/u);
            expect(await page.locator('body').evaluate((body) => getComputedStyle(body).backgroundColor)).toBe(
                rgb(colors.canvas),
            );
            expect(await title.evaluate((element) => getComputedStyle(element).color)).toBe(rgb(colors.ink));
        });
    });
}
