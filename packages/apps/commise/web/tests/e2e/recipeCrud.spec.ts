import { expect, test } from '@playwright/test';

import { route } from './utils/basePath';
import { mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';
import { mockFoodApi } from './utils/foodApi';
import { addStep, fillTimes, openRecipeEditor, setServings } from './utils/recipeEditor';

/**
 * Recipe CRUD happy path (T079): create → view → edit → delete, driven through the real web UI (Next dev server +
 * Clerk session + client hooks + routing) with the recipe-service HTTP contract intercepted (`utils/recipeApi`). The
 * real backend is covered separately by the recipe-service's own e2e + k6. Owner actions (edit/delete) gate on the
 * Clerk `external_id` claim, so the mock seeds recipes owned by the live viewer (see `readViewerAppId`). Selectors are
 * role/label only (per repo policy). Serial (Clerk-authed).
 *
 * REWRITTEN for slice 7: the four-step wizard walk is gone. Create fills the one-page editor (Details, Ingredients,
 * Steps) and publishes from the action bar. The recipe is then PUBLISHED, so the edit path ends with `Save changes`
 * (owner decision D1: a published recipe writes only there), and a difficulty is cleared by pressing the chosen chip
 * again, since the chip row has no "Not stated" option. The editor's own structure is `recipeEditor.spec.ts`'s.
 */
test.describe('recipe CRUD (T079)', () => {
    test('create → view → edit → delete a recipe', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, { viewerId, tier: 'premium' });
        await mockFoodApi(page);

        // The list surface renders with its chrome.
        await page.goto(route('/recipes'));
        await expect(page.getByRole('heading', { name: 'Recipes' })).toBeVisible();

        // CREATE — this spec runs against the mock's DEFAULT seed, so the library is POPULATED, and L1 says
        // exactly one create control exists per state: the pinned FAB ("New recipe"). The empty-state CTA
        // belongs to the first-run library and must NOT be here.
        //
        // Asserted state-specifically on purpose. This used to be a permissive
        // `/New recipe|Create your first recipe/` alternation, which passes in EITHER state and so could not
        // report which one the page was in — that tolerance is part of why a first-run library rendering a
        // permanent skeleton reached a human. The first-run state has its own spec now
        // (`recipeListEmptyStates.spec.ts`); this one pins the populated state it actually exercises.
        await expect(page.getByRole('article', { name: 'Seed Recipe' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Add your first recipe' })).toHaveCount(0);
        await page.getByRole('button', { name: 'New recipe' }).click();
        await expect(page).toHaveURL(/\/recipes\/new/);

        // Details.
        await page.getByLabel('Title').fill('E2E Ratatouille');
        await page.getByLabel('Description').fill('A rustic roasted vegetable stew.');
        await page.getByLabel('Cuisine').selectOption('French');
        await setServings(page, 4);
        await fillTimes(page, { prepMinutes: 15, cookMinutes: 30 });
        // State a difficulty (FR-001b) — the picker is a chip row of radios; select Hard.
        await page.getByRole('radio', { name: 'Hard' }).click();

        // Ingredients.
        await page.getByRole('combobox', { name: 'Add an ingredient' }).fill('salt');
        // The catalog's own option (exact 'Salt'), not the "Use “salt” as written" fallback a substring match on 'Salt'
        // would also hit. Picking it admits the food and appends the line.
        await page
            .getByRole('group', { name: 'Food catalog' })
            .getByRole('option', { name: 'Salt', exact: true })
            .click();

        // Steps.
        await addStep(page, 'Roast the vegetables.');

        // Publish, from the action bar.
        await page.getByRole('button', { name: 'Publish' }).click();

        // VIEW — landed on the new recipe's detail.
        await expect(page.getByRole('heading', { name: 'E2E Ratatouille' })).toBeVisible();
        const createdId = new URL(page.url()).pathname.split('/recipes/')[1]?.split('/')[0];
        expect(createdId).toBeTruthy();

        // C1 wireframe parity — an in-app Back control returns to the recipe list without relying on the
        // browser's own back button.
        await expect(page.getByRole('link', { name: 'My recipes' })).toHaveAttribute('href', /\/recipes$/);

        // W2/D1 — the detail is no longer a dead end: the owner's version-history entry point is reachable,
        // behind the "More" overflow menu (C4 — Edit stays the sole primary header control).
        await page.getByRole('button', { name: /^More actions for /u }).click();
        await expect(page.getByRole('menuitem', { name: 'Version history' })).toBeVisible();
        await page.keyboard.press('Escape');
        // W2/D5 — ingredient checkboxes are real, trackable controls (not decorative).
        const saltCheckbox = page.getByRole('checkbox', { name: /Salt/ });
        await saltCheckbox.click();
        await expect(saltCheckbox).toBeChecked();

        // §S15 — the nutrition note is two sentences, each with its own condition. This recipe's only line ("Salt")
        // is a catalog food, so the source sentence and its Data sources link render and the custom-ingredient
        // sentence does not (`recipeIngredientDetail.spec.ts` has the recipe that shows both).
        const nutrition = page.getByRole('region', { name: 'Nutrition (per serving)' });
        await expect(nutrition).toContainText('Nutrition comes from public food databases.');
        const sources = nutrition.getByRole('link', { name: 'Data sources' });
        await expect(sources).toBeVisible();
        await expect(sources).toHaveAttribute('href', /\/legal\/sources$/u);
        await expect(nutrition).not.toContainText('Custom ingredients count only the nutrition you entered for them.');

        // EDIT — reach the editor through the RESTORED Edit entry point (W2/D1), not a raw URL. The difficulty stated at
        // create round-tripped, so Hard is pre-selected. Change the title and CLEAR the difficulty (press Hard again),
        // then Save changes — the recipe is published, so that is its only write (D1). The three-state update sends an
        // explicit clear, not an omit.
        await page.getByRole('link', { name: 'Edit recipe' }).click();
        await expect(page).toHaveURL(new RegExp(`/recipes/${createdId}/edit`));
        await expect(page.getByRole('radio', { name: 'Hard' })).toBeChecked();
        await page.getByLabel('Title').fill('E2E Ratatouille (edited)');
        await page.getByRole('radio', { name: 'Hard' }).click();
        await expect(page.getByRole('radio', { name: 'Hard' })).not.toBeChecked();
        await page.getByRole('button', { name: 'Save changes' }).click();
        await expect(page.getByRole('heading', { name: 'E2E Ratatouille (edited)' })).toBeVisible();

        // The clear persisted: re-opening the editor shows no difficulty chosen, never the stale Hard.
        await openRecipeEditor(page, createdId ?? '');
        const difficulty = page.getByRole('radiogroup', { name: 'Difficulty' });
        await expect(difficulty.getByRole('radio')).toHaveCount(3);

        for (const level of ['Easy', 'Medium', 'Hard']) {
            await expect(difficulty.getByRole('radio', { name: level })).not.toBeChecked();
        }

        // DELETE — the delete affordance lives on the recipe's detail page, not the editor, so return to it
        // first; it is behind the ⋯ "More actions" overflow (C4). Confirm the destructive dialog, then land back
        // on the list without the recipe.
        await page.goto(route(`/recipes/${createdId}`));
        await page.getByRole('button', { name: /^More actions for /u }).click();
        await page.getByRole('menuitem', { name: 'Delete recipe' }).click();
        // The dialog's confirm repeats the trigger's verb (spec §6.5), so it is found inside the dialog.
        await page
            .getByRole('alertdialog', { name: 'Delete this recipe?' })
            .getByRole('button', { name: 'Delete recipe' })
            .click();
        await expect(page).toHaveURL(/\/recipes(?:\?|$)/);
        await expect(page.getByRole('heading', { name: 'E2E Ratatouille (edited)' })).toHaveCount(0);
    });
});
