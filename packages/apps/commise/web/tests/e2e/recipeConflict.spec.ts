import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { IngredientVariant, RecipeDetail } from '@kitchensink/recipe-core';

import {
    E2E_INGREDIENT_IDS,
    makeRecipeDetail,
    mockRecipeApi,
    readViewerAppId,
    type EnrichedConflictSeed,
} from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';
import { openRecipeEditor } from './utils/recipeEditor';

/**
 * Concurrent-edit conflict resolution (FR-007c / T070 / W7 rebuild), driven end to end through the real web
 * UI with the recipe-service contract intercepted (`utils/recipeApi`). A recipe seeded with a one-shot
 * `enrichedConflicts` entry makes the user's save lose the optimistic-concurrency race (a real `409
 * VERSION_CONFLICT`, enriched with the W8-a.5 `server`/`base` `VersionConflictSide` sides); the rebuilt
 * `RecipeConflictView` then presents the per-side banner, the changed-only diff (markers + legend), the
 * three A/B/C option cards, and — for Option C — a per-element merge panel gated on an explicit selection.
 * This is the W7 REWRITE of the pre-rebuild spec: the old "Merge field by field" / "Save merged version" flow
 * asserted a 2-way `mine`/`theirs` model and stale button copy; this rewrite asserts the CURRENT
 * `versions/messages.ts` copy verbatim and exercises Options B and C against the new UI (`RecipeEditorContainer`
 * → `useRecipeEditor` → `RecipeConflictView`). The seed is PUBLISHED, so the losing write is Save changes (slice 7, D1). Owner actions gate on the Clerk `external_id` claim, so every
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
 *  `enrichedConflicts`. Returns the live store so a spec can assert what the resolution ultimately persisted.
 *  `seedOver` overrides the seeded recipe, for a spec that needs particular lines. */
async function enterConflict(
    page: Page,
    conflictSeed: EnrichedConflictSeed,
    seedOver: Partial<RecipeDetail> = {},
): Promise<Map<string, RecipeDetail>> {
    await signInWithTicket(page);
    const viewerId = await readViewerAppId(page);
    const seed = makeRecipeDetail({
        id: 'rec_conflict',
        ownerId: viewerId,
        title: 'Original Title',
        servings: 4,
        currentVersion: 1,
        ...seedOver,
    });
    const store = await mockRecipeApi(page, {
        viewerId,
        recipes: [seed],
        enrichedConflicts: { rec_conflict: conflictSeed },
    });

    await openRecipeEditor(page, 'rec_conflict');
    await page.getByLabel('Title').fill('My Merged Title');
    // The seed is published, so its one write is the action bar's Save changes (D1); saving loses the race.
    await page.getByRole('button', { name: 'Save changes' }).click();

    await expect(page.getByRole('heading', { name: 'This recipe changed while you were editing' })).toBeVisible();

    return store;
}

test.describe('recipe concurrent-edit conflict resolution (FR-007c / W7)', () => {
    // ⛔ THE LOST UPDATE, through the real UI. The unit suite pins which version the editor sends; only a browser
    // proves the whole path a cook takes: the tab regains focus, TanStack refetches the recipe, and the cache now holds
    // the OTHER device's version. A save that sent the cache's version would be accepted and overwrite their change.
    test("a save after the other device's change was REFETCHED still names the version it edited, and overwrites nothing", async ({
        page,
    }) => {
        await page.clock.install();
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        const seed = makeRecipeDetail({
            id: 'rec_conflict',
            ownerId: viewerId,
            title: 'Original Title',
            servings: 4,
            currentVersion: 1,
        });
        const store = await mockRecipeApi(page, { viewerId, recipes: [seed] });
        const detailRead = (request: { method(): string; url(): string }): boolean =>
            request.method() === 'GET' && /\/api\/v1\/recipes\/rec_conflict(?:\?|$)/u.test(request.url());

        await openRecipeEditor(page, 'rec_conflict');
        await page.getByLabel('Title').fill('My Edit');

        // The other device saves: servings 8, version 2.
        store.set('rec_conflict', { ...seed, servings: 8, currentVersion: 2 });

        // The detail read is 30 s fresh; jump past it, then refocus the tab so the editor's cache refetches v2.
        const refetched = page.waitForRequest(detailRead);
        await page.clock.fastForward('00:31');
        await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
        await refetched;

        const save = page.waitForRequest(
            (request) =>
                request.method() === 'PATCH' && /\/api\/v1\/recipes\/rec_conflict(?:\?|$)/u.test(request.url()),
        );
        await page.getByRole('button', { name: 'Save changes' }).click();

        expect((await save).postDataJSON()).toMatchObject({ expectedVersion: 1 });
        // The refusal reached the cook as the conflict view. Without it, a mock that answered a bare 409 with no
        // enriched sides would pass this test while the cook saw an unresolvable error.
        await expect(page.getByRole('heading', { name: 'This recipe changed while you were editing' })).toBeVisible();
        // The server refused the stale write, so the other device's change stands.
        expect(store.get('rec_conflict')).toMatchObject({ currentVersion: 2, servings: 8 });
    });

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

    /**
     * Curated U15 (`docs/design/ingredientSpecialization.md` §S1, R25, R27). The other device re-picked the brisket's
     * variant. A variant is part of the line's binding, so the merge shows two rows whose text reads the same, and only
     * each side's dotted line tells them apart. The olive oil line's own words hold a comma-joined phrase, and the
     * other device changed its amount, so its row is on screen: the control for the comma-joined negative.
     */
    test('a variant re-pick shows each side its own dotted line, in the diff and the merge panel', async ({ page }) => {
        const brisket = (ingredientId: string, variant: IngredientVariant) => ({
            ingredientId,
            name: 'beef brisket',
            foodId: 'food_beef_brisket',
            variant,
            quantity: { kind: 'exact', value: 2 } as const,
            unit: 'lb',
            isUserEntered: false,
            resolutionStatus: 'RESOLVED' as const,
        });
        const oliveOil = (value: number) => ({
            ingredientId: E2E_INGREDIENT_IDS.oliveOil,
            name: 'Olive oil',
            foodId: 'food_olive_oil',
            notes: 'flat half, select',
            quantity: { kind: 'exact', value } as const,
            unit: 'tbsp',
            isUserEntered: false,
            resolutionStatus: 'RESOLVED' as const,
        });
        const flatHalf = brisket('66666666-6666-4666-8666-6666666666a1', {
            id: 'var_brisket_flat',
            parts: [
                { attribute: 'cut', text: 'flat half' },
                { attribute: 'grade', text: 'select' },
            ],
        });
        const pointHalf = brisket('66666666-6666-4666-8666-6666666666a2', {
            id: 'var_brisket_point',
            parts: [
                { attribute: 'cut', text: 'point half' },
                { attribute: 'grade', text: 'choice' },
            ],
        });

        await enterConflict(
            page,
            { serverChanges: { ingredients: [pointHalf, oliveOil(3)] } },
            { ingredients: [flatHalf, oliveOil(1)] },
        );

        const diffPanel = page.getByRole('region', { name: 'Changed fields' });
        const flatRow = diffPanel.getByRole('listitem').filter({ hasText: 'Was: 2 lb beef brisket' });
        const pointRow = diffPanel.getByRole('listitem').filter({ hasText: 'point half' });

        // Both rows read "2 lb beef brisket"; the dotted line under each side is what tells them apart.
        await expect(flatRow).toContainText('Your version: 2 lb beef brisket');
        await expect(flatRow).toContainText('flat half ·');
        await expect(flatRow).not.toContainText('point half');
        await expect(pointRow).toContainText('Latest saved version: 2 lb beef brisket');
        await expect(pointRow).toContainText('point half ·');
        await expect(pointRow).not.toContainText('flat half');
        // Never a comma-joined label; the cook's own comma-joined words on the olive oil row prove the check can see one.
        await expect(flatRow).not.toContainText('flat half, select');
        await expect(pointRow).not.toContainText('point half, choice');
        await expect(diffPanel.getByRole('listitem').filter({ hasText: 'Olive oil' }).first()).toContainText(
            'flat half, select',
        );

        await page.getByRole('button', { name: 'Merge manually' }).click();

        // The names carry the parts for a screen reader (R27); the visible text shows them as the dotted line.
        const flatGroup = page.getByRole('radiogroup', { name: 'Ingredient: 2 lb beef brisket, flat half, select' });
        const pointGroup = page.getByRole('radiogroup', { name: 'Ingredient: 2 lb beef brisket, point half, choice' });

        await expect(
            flatGroup.getByRole('radio', { name: 'Your version: 2 lb beef brisket, flat half, select' }),
        ).toBeVisible();
        await expect(
            pointGroup.getByRole('radio', { name: 'Latest saved version: 2 lb beef brisket, point half, choice' }),
        ).toBeVisible();
        await expect(flatGroup).toContainText('flat half ·');
        await expect(pointGroup).toContainText('point half ·');
        await expect(pointGroup).not.toContainText('point half, choice');
    });
});
